// ฐานข้อมูลในเครื่อง (IndexedDB) — ทำงานได้แม้ไม่มีอินเทอร์เน็ต
// ข้อมูลทั้งหมดโหลดเข้าหน่วยความจำตอนเริ่ม (ข้อมูลอพาร์ทเม้นท์มีขนาดเล็ก) เพื่อให้โมดูลอ่านแบบ sync ได้
// ทุกการแก้ไขในคอลเลกชันที่ซิงก์ จะถูกเข้าคิว outbox รออัปโหลดขึ้น Google Sheets

const DB_NAME = 'map-pms';
const DB_VER = 1;
export const SYNC_COLS = ['rooms', 'tenants', 'slots', 'bills', 'settings', 'lineLinks'];
const LOCAL_COLS = ['users'];               // ใช้เฉพาะโหมด local (ยังไม่เชื่อม Google)
const STORES = [...SYNC_COLS, ...LOCAL_COLS, 'photos', 'outbox', 'meta'];

let idb;
const mem = {};                              // col -> Map(id -> record)
const listeners = new Set();
export let actor = 'system';
export const setActor = a => { actor = a; };

function req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
function tx(store, mode = 'readonly') { return idb.transaction(store, mode).objectStore(store); }

export async function open() {
  idb = await new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      for (const s of STORES) if (!d.objectStoreNames.contains(s)) {
        d.createObjectStore(s, s === 'outbox' ? { keyPath: 'seq', autoIncrement: true } : { keyPath: s === 'meta' ? 'key' : 'id' });
      }
    };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  for (const c of [...SYNC_COLS, ...LOCAL_COLS]) {
    mem[c] = new Map((await req(tx(c).getAll())).map(o => [o.id, o]));
  }
}

export const isEmpty = () => SYNC_COLS.every(c => mem[c].size === 0);
export const all = (col, { withDeleted = false } = {}) => [...mem[col].values()].filter(o => withDeleted || !o.deleted);
export const get = (col, id) => { const o = mem[col].get(String(id)); return o && !o.deleted ? o : null; };
export const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = col => listeners.forEach(fn => fn(col));

// บันทึก 1 รายการ: silent = ไม่เข้าคิวอัปโหลด (ใช้ตอนรับข้อมูลจาก server หรือ seed)
export async function put(col, obj, { silent = false, keepStamp = false } = {}) {
  const rec = { ...obj, id: String(obj.id) };
  if (!keepStamp) { rec.updatedAt = new Date().toISOString(); rec.updatedBy = actor; }
  mem[col].set(rec.id, rec);
  await req(tx(col, 'readwrite').put(rec));
  if (!silent && SYNC_COLS.includes(col)) await queue({ kind: 'put', col, id: rec.id });
  emit(col);
  return rec;
}

export async function putMany(col, list, opts = { silent: true, keepStamp: true }) {
  const store = idb.transaction(col, 'readwrite').objectStore(col);
  for (const o of list) {
    const rec = { ...o, id: String(o.id) };
    if (!opts.keepStamp) { rec.updatedAt = new Date().toISOString(); rec.updatedBy = actor; }
    mem[col].set(rec.id, rec); store.put(rec);
    if (!opts.silent) await queue({ kind: 'put', col, id: rec.id });
  }
  await new Promise(r => { store.transaction.oncomplete = r; });
  emit(col);
}

// ลบแบบ soft delete เพื่อให้การลบซิงก์ไปเครื่องอื่นได้
export async function remove(col, id) {
  const o = mem[col].get(String(id)); if (!o) return;
  await put(col, { ...o, deleted: true });
}
export async function hardRemove(col, id) { mem[col]?.delete(String(id)); await req(tx(col, 'readwrite').delete(String(id))); emit(col); }

// ---------- meta (ค่าภายในเครื่อง) ----------
export async function meta(key, val) {
  if (val === undefined) return (await req(tx('meta').get(key)))?.val;
  await req(tx('meta', 'readwrite').put({ key, val }));
}

// ---------- รูปภาพ (บัตรประชาชน) เก็บเป็น dataURL ----------
export async function putPhoto(rec) { await req(tx('photos', 'readwrite').put(rec)); }
export async function getPhoto(id) { return id ? req(tx('photos').get(id)) : null; }

// ---------- outbox (คิวรออัปโหลด) ----------
export async function queue(entry) {
  // รวมรายการ put ซ้ำของ record เดียวกันไว้รายการเดียว
  if (entry.kind === 'put') {
    const dup = (await outbox()).find(e => e.kind === 'put' && e.col === entry.col && e.id === entry.id);
    if (dup) return;
  }
  await req(tx('outbox', 'readwrite').add({ ...entry, at: new Date().toISOString(), by: actor }));
  emit('outbox');
}
export async function queueMany(entries) {
  const have = new Set((await outbox()).filter(e => e.kind === 'put').map(e => e.col + '|' + e.id));
  const store = idb.transaction('outbox', 'readwrite').objectStore('outbox'), at = new Date().toISOString();
  for (const e of entries) if (!(e.kind === 'put' && have.has(e.col + '|' + e.id))) store.add({ ...e, at, by: actor });
  await new Promise(r => { store.transaction.oncomplete = r; });
  emit('outbox');
}
export const outbox = () => req(tx('outbox').getAll());
export async function unqueue(seq) { await req(tx('outbox', 'readwrite').delete(seq)); emit('outbox'); }
export async function updateQueued(e) { await req(tx('outbox', 'readwrite').put(e)); emit('outbox'); }
