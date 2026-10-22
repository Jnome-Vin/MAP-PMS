// ซิงก์ข้อมูลระหว่างเครื่องกับ Google Sheets
// ทำงานแบบ offline-first: บันทึกลงเครื่องก่อน → เข้าคิว → อัปโหลดเมื่อมีสัญญาณ (อัตโนมัติ หรือกดเอง)
import { isServerMode } from './config.js';
import * as db from './db.js';
import * as api from './api.js';
import * as M from './model.js';
import * as docs from './docs.js';

const state = { online: navigator.onLine, pending: 0, syncing: false, lastSync: null, error: '', needAuth: false };
const subs = new Set();
export const status = () => ({ ...state, server: isServerMode() });
export const onStatus = fn => { subs.add(fn); fn(status()); return () => subs.delete(fn); };
const emit = () => subs.forEach(fn => fn(status()));

export async function autoUpload(v) {
  if (v === undefined) return (await db.meta('autoUpload')) ?? true;
  await db.meta('autoUpload', !!v);
}

async function refreshPending() { state.pending = (await db.outbox()).length; emit(); }

let timer;
export async function init() {
  state.lastSync = await db.meta('lastSync') || null;
  await refreshPending();
  addEventListener('online', async () => { state.online = true; emit(); if (await autoUpload()) run(); });
  addEventListener('offline', () => { state.online = false; emit(); });
  db.onChange(col => {
    if (col !== 'outbox') return;
    refreshPending();
    clearTimeout(timer);
    timer = setTimeout(async () => { if (await autoUpload()) run(); }, 4000);
  });
  setInterval(() => { if (state.online && isServerMode()) run({ pullOnly: false }); }, 5 * 60e3);
  if (state.online && isServerMode()) run();
}

export const tokenReady = () => { state.needAuth = false; emit(); };

export async function run() {
  if (!isServerMode() || state.syncing) return;
  if (!navigator.onLine) { state.online = false; emit(); return; }
  state.syncing = true; state.error = ''; emit();
  try {
    // เครื่องที่ยังไม่เคยซิงก์ (เพิ่งเชื่อม Google): ดึงข้อมูลจาก server ก่อน และให้ข้อมูล server ชนะของในเครื่อง
    // กันข้อมูลตั้งต้นของเครื่องใหม่ (ห้อง/ที่จอดจาก seed) ทับข้อมูลจริงบน server
    if (!await db.meta('lastSync')) {
      const r = await api.call('sync', { changes: [], since: '' });
      const fromServer = new Set((r.changes || []).map(c => c.col + '|' + c.rec.id));
      for (const e of (await db.outbox()).filter(e => e.kind === 'put' && fromServer.has(e.col + '|' + e.id))) await db.unqueue(e.seq);
      await applyIncoming(r.changes || [], { serverWins: true });
      if (r.serverTime) await db.meta('lastSync', r.serverTime);
    }
    const entries = (await db.outbox()).sort((a, b) => a.seq - b.seq);

    // 1) รูปบัตรประชาชน → Google Drive
    for (const e of entries.filter(e => e.kind === 'photo')) {
      const p = await db.getPhoto(e.photoId);
      if (p && !p.driveId) {
        const r = await api.call('uploadPhoto', { id: p.id, dataUrl: p.dataUrl, name: p.name, folder: e.folder || 'idcard' });
        await db.putPhoto({ ...p, driveId: r.fileId });
      }
      await db.unqueue(e.seq);
    }

    // 2) ข้อมูล → Google Sheets (ส่งของเรา + รับของเครื่องอื่นกลับมา)
    const puts = entries.filter(e => e.kind === 'put');
    const since = await db.meta('lastSync') || '';
    const changes = puts.map(e => ({ col: e.col, rec: db.all(e.col, { withDeleted: true }).find(o => o.id === e.id) })).filter(c => c.rec);
    for (let i = 0; i < Math.max(changes.length, 1); i += 200) {
      const chunk = changes.slice(i, i + 200);
      const r = await api.call('sync', { changes: chunk, since: i === 0 ? since : null });
      for (const e of puts.filter(p => chunk.some(c => c.col === p.col && c.rec.id === p.id))) await db.unqueue(e.seq);
      if (r.changes) await applyIncoming(r.changes);
      if (r.rejected?.length) state.error = `server ไม่รับ ${r.rejected.length} รายการ: ${r.rejected[0].reason}`;
      if (r.serverTime && i === 0) await db.meta('lastSync', r.serverTime);
    }

    // 3) ส่งบิลเข้า LINE OA (หลังจากบิลขึ้น server แล้ว)
    for (const e of entries.filter(e => e.kind === 'line')) {
      const b = db.get('bills', e.billId);
      if (!b) { await db.unqueue(e.seq); continue; }
      // ส่งหน้าบิลที่แอปสร้าง (หน้าตาเดียวกับที่พิมพ์) ให้ server ทำ PDF + การ์ด LINE
      const lang = M.langOf(b), c = M.calcBill(b);
      let pdf = '';
      try { pdf = await docs.docPdf(b, { lang }); } catch (e) { console.warn('สร้าง PDF ในเครื่องไม่ได้ ใช้ PDF จาก server แทน', e); }
      const r = await api.call('sendBill', { billId: b.id, html: await docs.docPage(b, { lang }), pdf, lang,
        card: { title: M.property()[lang === 'en' ? 'nameEn' : 'name'] || M.property().name, room: b.room, period: b.period, invoiceNo: b.invoiceNo,
          lines: M.billLines(b, lang).map(l => ({ label: [l.label, l.sub].filter(Boolean).join(' '), amount: l.amount })), total: c.total, balance: c.balance, dueDate: b.dueDate } });
      if (b) await db.put('bills', { ...b, lineStatus: r.sent ? 'sent' : 'no-link', lineSentAt: r.sent ? new Date().toISOString() : '', pdfUrl: r.pdfUrl || b.pdfUrl || '' });
      await db.unqueue(e.seq);
    }

    state.lastSync = await db.meta('lastSync');
    state.needAuth = false;
    if (state.error) throw new Error(state.error);
  } catch (e) {
    if (e.code === 'AUTH') state.needAuth = true;
    state.error = e.message;
  } finally {
    state.syncing = false;
    await refreshPending();
  }
  // คิวที่เกิดขึ้นระหว่างซิงก์ (เช่นสถานะ LINE) ให้ส่งรอบถัดไป
  if (!state.error && state.pending && await autoUpload()) setTimeout(run, 1500);
}

async function applyIncoming(list, { serverWins = false } = {}) {
  const pending = new Set((await db.outbox()).filter(e => e.kind === 'put').map(e => e.col + '|' + e.id));
  const byCol = {};
  for (const { col, rec } of list) {
    if (!db.SYNC_COLS.includes(col) || pending.has(col + '|' + rec.id)) continue;   // ของในเครื่องที่ยังไม่อัปโหลดชนะ
    const local = db.all(col, { withDeleted: true }).find(o => o.id === String(rec.id));
    if (!serverWins && local && local.updatedAt >= rec.updatedAt) continue;
    (byCol[col] = byCol[col] || []).push(rec);
  }
  for (const col in byCol) await db.putMany(col, byCol[col]);
}

// อัปโหลดข้อมูลทั้งหมดในเครื่องขึ้น server (ใช้ครั้งแรกหลังเชื่อม Google)
export async function queueEverything() {
  await db.queueMany(db.SYNC_COLS.flatMap(col => db.all(col, { withDeleted: true }).map(o => ({ kind: 'put', col, id: o.id }))));
}
