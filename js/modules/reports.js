// รายงาน (ตามเมนู 1.8 ของโปรแกรมเดิม + รายงานสรุปน้ำ-ไฟ) — ดูบนจอ / พิมพ์-PDF / ส่งออก Excel
import * as db from '../core/db.js';
import * as M from '../core/model.js';
import { $, esc, fmt, periodLabel, periodOf, thDate, downloadCsv } from '../core/ui.js';
import { printInFrame } from '../core/printframe.js';

let kind = 'income', period = null, year = null;   // ตั้งค่าตอนเปิดหน้าแรก (ฐานข้อมูลยังไม่พร้อมตอนโหลดไฟล์)
let from = new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10), to = new Date().toISOString().slice(0, 10);

const KINDS = {
  income:  '1. สรุปยอดรายได้ประจำเดือน',
  unpaid:  '2. สรุปยอดค้างชำระ',
  daily:   '3. สรุปยอดรับเงินรายวัน',
  partial: '4. สรุปยอดชำระบางส่วน',
  byRoom:  '5. สรุปรายรับแต่ละห้อง ประจำปี',
  byMonth: '6. สรุปรายรับแต่ละเดือน ประจำปี',
  meter:   '7. รายงานสรุปน้ำ-ไฟ',
  history: '8. ประวัติการเช่าห้อง (เข้าพัก – ย้ายออก)',
};
let hRoom = '', hQ = '';
const issuedBills = () => db.all('bills').filter(b => b.status !== 'draft');
const sum = (rows, i) => rows.reduce((a, r) => a + (Number(r[i]) || 0), 0);
const otherOf = (b, c) => (Number(b.fridge) || 0) + (Number(b.parking) || 0) + c.other;

// คืน { head, rows, foot, numCols, subtitle }
function build() {
  if (kind === 'history') {
    const list = M.stays(hRoom).filter(t => !hQ || [t.room, t.name, t.phone, t.idNo, ...(t.occupants || []).flatMap(o => typeof o === 'string' ? [o] : [o.name, o.idNo])].join(' ').toLowerCase().includes(hQ.toLowerCase()));
    const rows = list.map((t, i) => [i + 1, t.room, t.name, thDate(t.since), t.active ? 'ยังพักอยู่' : thDate(t.moveOut), M.stayText(t.since, t.active ? null : t.moveOut),
      t.active ? 'ปัจจุบัน' : 'ย้ายออกแล้ว', Number(t.deposit) || 0, t.moveOutDoc ? t.moveOutDoc.refund : '', t.phone || '', t.note || '']);
    return { subtitle: `${hRoom ? 'ห้อง ' + hRoom : 'ทุกห้อง'} · ${rows.length} รายการ`, head: ['No.', 'ห้อง', 'ชื่อผู้เช่า', 'เข้าพัก', 'ย้ายออก', 'ระยะเวลา', 'สถานะ', 'เงินประกัน', 'คืนเงิน', 'โทร', 'หมายเหตุ'],
      rows, foot: ['', 'รวม', `${rows.length} ราย`, '', '', '', `ปัจจุบัน ${list.filter(t => t.active).length}`, '', '', '', ''], num: [7, 8] };
  }
  if (kind === 'income') {
    const bs = M.billsOf(period).filter(b => b.status !== 'draft').sort((a, b) => a.room.localeCompare(b.room));
    const rows = bs.map((b, i) => { const c = M.calcBill(b); return [i + 1, b.room, b.tenantName, b.rent, c.water, c.elec, b.phone || 0, otherOf(b, c), c.total, c.paid]; });
    return { subtitle: periodLabel(period), head: ['No.', 'ห้อง', 'ผู้เช่า', 'ค่าเช่า', 'ค่าน้ำ', 'ค่าไฟ', 'ค่าโทรศัพท์', 'อื่นๆ', 'รวม', 'รับแล้ว'],
      rows, foot: ['', 'รวมทั้งหมด', '', ...[3, 4, 5, 6, 7, 8, 9].map(i => sum(rows, i))], num: [3, 4, 5, 6, 7, 8, 9] };
  }
  if (kind === 'unpaid' || kind === 'partial') {
    const bs = issuedBills().filter(b => b.period <= period).filter(b => { const s = M.billState(b); return kind === 'partial' ? s === 'partial' : ['due', 'late', 'partial'].includes(s); })
      .sort((a, b) => a.room.localeCompare(b.room) || a.period.localeCompare(b.period));
    const rows = bs.map((b, i) => { const c = M.calcBill(b); return [i + 1, b.room, b.tenantName, periodLabel(b.period, true), b.invoiceNo || '', c.total, c.paid, c.balance, M.BILL_TXT[M.billState(b)][0]]; });
    return { subtitle: `ถึง ${periodLabel(period)}`, head: ['No.', 'ห้อง', 'ผู้เช่า', 'เดือน', 'เลขที่', 'ยอดบิล', 'ชำระแล้ว', 'คงค้าง', 'สถานะ'],
      rows, foot: ['', 'รวม', '', '', '', sum(rows, 5), sum(rows, 6), sum(rows, 7), ''], num: [5, 6, 7] };
  }
  if (kind === 'daily') {
    const rows = [];
    issuedBills().forEach(b => (b.payments || []).forEach(p => { if (p.date && p.date >= from && p.date <= to) rows.push([p.date, b.room, b.tenantName, periodLabel(b.period, true), p.receiptNo || '', p.method || '', Number(p.amount) || 0]); }));
    rows.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
    rows.forEach(r => r[0] = thDate(r[0]));
    return { subtitle: `${thDate(from)} – ${thDate(to)}`, head: ['วันที่', 'ห้อง', 'ผู้เช่า', 'บิลเดือน', 'ใบเสร็จ', 'ช่องทาง', 'จำนวนเงิน'],
      rows, foot: ['รวม', '', '', '', '', '', sum(rows, 6)], num: [6] };
  }
  if (kind === 'byRoom') {
    const bs = issuedBills().filter(b => b.period.startsWith(year + '-'));
    const rooms = [...new Set(bs.map(b => b.room))].sort();
    const rows = rooms.map(r => { const m = Array(12).fill(0); bs.filter(b => b.room === r).forEach(b => m[+b.period.slice(5) - 1] += M.calcBill(b).total); return [r, ...m, m.reduce((a, x) => a + x, 0)]; });
    return { subtitle: `ปี ${year + 543}`, head: ['ห้อง', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.', 'รวม'],
      rows, foot: ['รวม', ...Array.from({ length: 13 }, (_, i) => sum(rows, i + 1))], num: Array.from({ length: 13 }, (_, i) => i + 1) };
  }
  if (kind === 'byMonth') {
    const rows = Array.from({ length: 12 }, (_, i) => {
      const p = `${year}-${String(i + 1).padStart(2, '0')}`, bs = M.billsOf(p).filter(b => b.status !== 'draft');
      const t = [0, 0, 0, 0, 0, 0]; bs.forEach(b => { const c = M.calcBill(b); t[0] += +b.rent || 0; t[1] += c.water; t[2] += c.elec; t[3] += otherOf(b, c) + (+b.phone || 0); t[4] += c.total; t[5] += c.paid; });
      return [periodLabel(p), bs.length, ...t];
    }).filter(r => r[1]);
    return { subtitle: `ปี ${year + 543}`, head: ['เดือน', 'จำนวนห้อง', 'ค่าเช่า', 'ค่าน้ำ', 'ค่าไฟ', 'อื่นๆ', 'รวม', 'รับแล้ว'],
      rows, foot: ['รวม', '', ...[2, 3, 4, 5, 6, 7].map(i => sum(rows, i))], num: [2, 3, 4, 5, 6, 7] };
  }
  // meter
  const bs = M.billsOf(period).filter(b => b.wCur != null || b.eCur != null).sort((a, b) => a.room.localeCompare(b.room));
  const rows = bs.map((b, i) => { const c = M.calcBill(b); return [i + 1, b.room, `${b.wPrev ?? ''} - ${b.wCur ?? ''}`, c.wu ?? '', b.wRate, c.water, `${b.ePrev ?? ''} - ${b.eCur ?? ''}`, c.eu ?? '', b.eRate, c.elec]; });
  return { subtitle: `บิล${periodLabel(period)} (มิเตอร์ที่จด ${thDate(bs[0]?.meterDate)})`, head: ['No.', 'ห้อง', 'มิเตอร์น้ำ', 'หน่วยน้ำ', 'น้ำ/หน่วย', 'ค่าน้ำ', 'มิเตอร์ไฟ', 'หน่วยไฟ', 'ไฟ/หน่วย', 'ค่าไฟ'],
    rows, foot: ['รวม', '', '', sum(rows, 3), '', sum(rows, 5), '', sum(rows, 7), '', sum(rows, 9)], num: [3, 5, 7, 9] };
}

function tableHtml(r, cls = 'tbl') {
  const cell = (v, i) => `<td class="${r.num.includes(i) ? 'n' : ''}">${r.num.includes(i) && v !== '' ? fmt(v) : esc(v)}</td>`;
  return `<table class="${cls}"><thead><tr>${r.head.map((h, i) => `<th class="${r.num.includes(i) ? 'n' : ''}">${h}</th>`).join('')}</tr></thead>
    <tbody>${r.rows.map(row => `<tr>${row.map(cell).join('')}</tr>`).join('') || `<tr><td colspan="${r.head.length}" class="empty">ไม่มีข้อมูล</td></tr>`}</tbody>
    ${r.rows.length ? `<tfoot><tr style="font-weight:700;background:#f0f3f6">${r.foot.map(cell).join('')}</tr></tfoot>` : ''}</table>`;
}

export default {
  id: 'reports', title: 'รายงาน', icon: '📈',
  render(el, nav) {
    if (!period) { period = M.latestPeriod() || periodOf(); year = +period.slice(0, 4); }
    const r = build(), p = M.property();
    const years = [...new Set(M.periods().map(x => +x.slice(0, 4)))];
    const ctl = kind === 'history'
      ? `<select class="input" id="hroom"><option value="">ทุกห้อง</option>${M.rooms().map(r => `<option ${r.id === hRoom ? 'selected' : ''}>${r.id}</option>`).join('')}</select>
         <input class="search" id="hq" placeholder="ค้นหาชื่อ / เบอร์ / เลขบัตร" value="${esc(hQ)}">`
      : kind === 'daily'
      ? `<label class="note">จาก</label><input class="input" type="date" id="from" value="${from}"><label class="note">ถึง</label><input class="input" type="date" id="to" value="${to}">`
      : (kind === 'byRoom' || kind === 'byMonth')
        ? `<select class="input" id="year">${years.map(y => `<option value="${y}" ${y === year ? 'selected' : ''}>ปี ${y + 543}</option>`).join('')}</select>`
        : `<select class="input" id="per">${M.periods().map(x => `<option value="${x}" ${x === period ? 'selected' : ''}>${periodLabel(x)}</option>`).join('')}</select>`;
    el.innerHTML = `
    <div class="top"><h2>รายงาน</h2><div class="toolbar">
      <button class="btn" id="xls">⬇ Excel</button><button class="btn pri" id="pdf">🖨️ พิมพ์ / PDF</button></div></div>
    <div class="toolbar" style="margin-bottom:12px">
      <select class="input" id="kind">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}" ${k === kind ? 'selected' : ''}>${v}</option>`).join('')}</select>${ctl}</div>
    <div class="card" style="padding:0"><div style="padding:12px 16px"><b>${esc(p.name)}</b> · ${KINDS[kind].replace(/^\d+\.\s*/, '')} · ${r.subtitle}</div>
      <div class="scroll" style="border:0;border-top:1px solid var(--line);border-radius:0 0 12px 12px">${tableHtml(r)}</div></div>`;
    const re = () => this.render(el, nav);
    el.querySelector('#kind').onchange = e => { kind = e.target.value; re(); };
    el.querySelector('#per')?.addEventListener('change', e => { period = e.target.value; re(); });
    el.querySelector('#hroom')?.addEventListener('change', e => { hRoom = e.target.value; re(); });
    el.querySelector('#hq')?.addEventListener('input', e => { hQ = e.target.value; re(); const n = el.querySelector('#hq'); n.focus(); n.setSelectionRange(hQ.length, hQ.length); });
    el.querySelector('#year')?.addEventListener('change', e => { year = +e.target.value; re(); });
    el.querySelector('#from')?.addEventListener('change', e => { from = e.target.value; re(); });
    el.querySelector('#to')?.addEventListener('change', e => { to = e.target.value; re(); });
    el.querySelector('#xls').onclick = () => downloadCsv(`${KINDS[kind].replace(/^\d+\.\s*/, '')}-${r.subtitle}.csv`.replace(/[\\/:*?"<>|]/g, '-'),
      [[p.name], [KINDS[kind], r.subtitle], [], r.head, ...r.rows, r.foot]);
    el.querySelector('#pdf').onclick = () => {
      printInFrame(`<div class="page" style="font-family:'IBM Plex Sans Thai',sans-serif"><div style="display:flex;justify-content:space-between">
        <div><b style="color:#1b2a6b">${esc(p.name)}</b><br>${KINDS[kind].replace(/^\d+\.\s*/, '')} ${r.subtitle}</div><div>${thDate(new Date().toISOString())}</div></div><br>${tableHtml(r, 'rep')}</div>`);
    };
  },
};
