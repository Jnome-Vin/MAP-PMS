// กฎธุรกิจที่หลายโมดูลใช้ร่วมกัน (ห้อง ผู้เช่า ที่จอด บิล) — ตามกติกาโปรแกรมเดิม BuildingSystem
// รอบบิล: บิลเดือน M = ค่าเช่าเดือน M + ค่าน้ำไฟจากมิเตอร์ที่จดปลายเดือน M-1, ครบกำหนดชำระวันที่ 5 ของเดือน M
import * as db from './db.js';
import { stripTitle } from './ui.js';

export const rates = () => ({ water: 15, elec: 6, dueDay: 5, parkingFee: 300, fridgeFee: 250,
  minOn: true, minWaterUnits: 1, minWaterAmount: 15, minElecUnits: 1, minElecAmount: 6, ...(db.get('settings', 'rates') || {}) });
export const property = () => db.get('settings', 'property') || { name: 'มีชัย อพาร์ทเม้นท์', nameEn: 'MEECHAI APARTMENT' };

export const rooms = () => db.all('rooms').sort((a, b) => a.id.localeCompare(b.id));
export const tenantOf = roomId => db.all('tenants').find(t => t.active && t.room === roomId) || null;
export const pastTenantsOf = roomId => db.all('tenants').filter(t => !t.active && t.room === roomId).sort((a, b) => String(b.moveOut).localeCompare(String(a.moveOut)));
export const slotsOf = roomId => db.all('slots').filter(s => s.room === roomId).sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
// อัตราค่าน้ำ/ไฟต่อหน่วย: ตามสัญญาผู้เช่า → อัตราเฉพาะห้อง → อัตรามาตรฐาน (ตั้งค่า)
const rateNum = v => (v === '' || v == null || isNaN(v) ? null : Number(v));
export const roomRates = (r, t = r ? tenantOf(r.id) : null) => ({
  water: rateNum(t?.wRate) ?? rateNum(r?.wRate) ?? rates().water,
  elec: rateNum(t?.eRate) ?? rateNum(r?.eRate) ?? rates().elec });
export const lineName = roomId => { const t = tenantOf(roomId); return `${roomId}-${stripTitle(t?.name)}`; };
export const lineLinkOf = roomId => db.all('lineLinks').find(l => l.room === roomId && l.active !== false) || null;
export const langOf = b => (b.lang || db.get('tenants', b.tenantId)?.lang || tenantOf(b.room)?.lang || 'th');

export const billId = (period, room) => `${period}-${room}`;
export const billsOf = period => db.all('bills').filter(b => b.period === period);
export const periods = () => [...new Set(db.all('bills').map(b => b.period))].sort().reverse();
export const latestPeriod = () => periods()[0] || null;

// เลขมิเตอร์ครั้งก่อน = เลขล่าสุดของบิลเดือนก่อนหน้า
// เลขมิเตอร์ทั้งหมดของห้อง: จากบิล (วันที่จด) และจากการย้ายออก (จดตอนผู้เช่าออก) — เรียงจากใหม่ไปเก่า
export function readings(roomId, before = '9999-12-31') {
  const list = [];
  for (const b of db.all('bills')) if (b.room === roomId && b.wCur != null && b.eCur != null)
    list.push({ w: b.wCur, e: b.eCur, date: b.meterDate || `${shiftP(b.period, -1)}-25`, from: 'bill', period: b.period });
  for (const t of db.all('tenants')) if (t.room === roomId && !t.active && t.moveOutMeter?.w != null)
    list.push({ w: t.moveOutMeter.w, e: t.moveOutMeter.e, date: t.moveOut, from: 'moveout', tenant: t.name });
  return list.filter(r => r.date < before).sort((a, b) => b.date.localeCompare(a.date) || (a.from === 'moveout' ? -1 : 1));
}
const shiftP = (p, n) => { const [y, m] = p.split('-').map(Number), d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

// เลขมิเตอร์ครั้งก่อนสำหรับบิลเดือน period = เลขล่าสุดที่จดก่อนต้นเดือนนั้น
// (ถ้ามีผู้เช่าย้ายออกหลังจดมิเตอร์ครั้งล่าสุด ผู้เช่าใหม่จะเริ่มนับจากเลขตอนย้ายออก)
export function prevMeters(roomId, period) {
  const bills = db.all('bills').filter(x => x.room === roomId && x.period < period);
  const r = readings(roomId, `${period}-01`).find(x => x.from === 'moveout' || bills.some(b => b.period === x.period));
  return r ? { w: r.w, e: r.e, from: r.from === 'moveout' ? 'ย้ายออก ' + r.date : r.period } : { w: null, e: null, from: null };
}

// ค่าน้ำ/ไฟ พร้อมขั้นต่ำ: ใช้น้อยกว่าขั้นต่ำ (ค่าเริ่มต้น 1 หน่วย รวมกรณีไม่ได้ใช้เลย) คิดเท่าขั้นต่ำ × อัตราตามสัญญา — ยกเว้นห้องที่ตั้ง noMin
export const minUnits = kind => Math.max(0, Number(rates()[kind === 'w' ? 'minWaterUnits' : 'minElecUnits'] ?? 1));
function utility(units, rate, min, applyMin) {
  if (units == null) return { amount: 0, billed: null, min: false };
  if (applyMin && units < min) return { amount: min * rate, billed: min, min: true };
  return { amount: units * rate, billed: units, min: false };
}
export function calcBill(b) {
  const r = rates(), room = db.get('rooms', b.room);
  const wu = b.wCur != null && b.wPrev != null ? b.wCur - b.wPrev : null;
  const eu = b.eCur != null && b.ePrev != null ? b.eCur - b.ePrev : null;
  const applyMin = r.minOn && !room?.noMin;
  const wx = utility(wu, Number(b.wRate) || 0, minUnits('w'), applyMin), ex = utility(eu, Number(b.eRate) || 0, minUnits('e'), applyMin);
  // บิลที่นำเข้าจากโปรแกรมเดิมใช้ยอดที่โปรแกรมเดิมคำนวณไว้
  const legacyW = b.legacy && b.water != null, legacyE = b.legacy && b.elec != null;
  const water = legacyW ? b.water : wx.amount;
  const elec = legacyE ? b.elec : ex.amount;
  const items = (b.items || b.others || []).map(o => ({ ...o, amount: o.qty != null && o.price != null && !b.legacy ? o.qty * o.price : Number(o.amount) || 0 }));
  const other = items.reduce((a, o) => a + o.amount, 0);
  const total = round((Number(b.rent) || 0) + water + elec + (Number(b.fridge) || 0) + (Number(b.parking) || 0) + (Number(b.phone) || 0) + other);
  const paid = round((b.payments || []).reduce((a, p) => a + (Number(p.amount) || 0), 0));
  return { wu, eu, water: round(water), elec: round(elec), items, other, total, paid, balance: round(total - paid), ready: wu != null && eu != null,
    wMin: !legacyW && wx.min, eMin: !legacyE && ex.min, wBilled: wx.billed, eBilled: ex.billed };
}
const round = n => Math.round(n * 100) / 100;

// บรรทัดในบิล (ใช้ทั้งพิมพ์ จอ และ LINE)
export function billLines(b, lang = langOf(b)) {
  const c = calcBill(b), en = lang === 'en', L = [];
  const m = b.period.split('-');
  if (b.rent) L.push({ label: en ? 'Room Rental' : 'ค่าเช่าห้อง', sub: `${m[1]}/${m[0]}`, amount: b.rent });
  const minTxt = en ? ' min.' : ' ขั้นต่ำ';
  if (c.eu != null) L.push({ label: en ? 'Electricity' : 'ค่าไฟฟ้า', sub: `( ${b.ePrev} - ${b.eCur} )${c.eMin ? minTxt : ''}`, qty: c.eMin ? c.eBilled : c.eu, price: b.eRate, amount: c.elec });
  if (c.wu != null) L.push({ label: en ? 'Water' : 'ค่าน้ำประปา', sub: `( ${b.wPrev} - ${b.wCur} )${c.wMin ? minTxt : ''}`, qty: c.wMin ? c.wBilled : c.wu, price: b.wRate, amount: c.water });
  if (b.fridge) L.push({ label: en ? 'Refrigerator' : 'ค่าเช่าตู้เย็น', amount: b.fridge });
  if (b.parking) L.push({ label: en ? 'Parking' : 'ค่าที่จอดรถ', sub: slotsOf(b.room).map(s => s.id).join(', '), amount: b.parking });
  if (b.phone) L.push({ label: en ? 'Telephone' : 'ค่าโทรศัพท์', amount: b.phone });
  c.items.forEach(o => L.push({ label: o.name || (en ? 'Other' : 'อื่นๆ'), qty: o.qty !== 1 ? o.qty : null, price: o.qty !== 1 ? o.price : null, amount: o.amount }));
  return L;
}

export function dueDate(period) { return `${period}-${String(rates().dueDay || 5).padStart(2, '0')}`; }

// เลขที่ใบแจ้งหนี้แบบเดิม: ปปดด-ลำดับ เช่น 6910-5 (ลำดับต่อเดือน)
export function nextInvoiceNo(period, prefix = '') {
  const [y, m] = period.split('-'), head = prefix + String(+y + 543).slice(2) + m + '-';
  // ใบแจ้งหนี้: เลขอยู่ที่บิล / ใบเสร็จ (prefix R): เลขอยู่ที่รายการชำระแต่ละครั้ง
  const nums = prefix
    ? db.all('bills', { withDeleted: true }).flatMap(b => (b.payments || []).map(p => p.receiptNo))
    : db.all('bills', { withDeleted: true }).filter(b => b.period === period).map(b => b.invoiceNo);
  const max = nums.filter(x => String(x || '').startsWith(head)).reduce((a, x) => Math.max(a, Number(String(x).slice(head.length)) || 0), 0);
  return head + (max + 1);
}

// สถานะบิล: draft / due (รอชำระ) / late (เกินกำหนด) / partial (ชำระบางส่วน) / paid
// ช่วงเวลาที่การโอนถือว่า "อยู่ในงวด" ของบิล: ตั้งแต่ออกบิล (เผื่อ 5 วัน) ถึงครบกำหนด · หลังครบกำหนดเกิน 45 วันถือว่าน่าจะเป็นงวดอื่น
export function payWindow(b, excludePayment = null) {
  const addDays = (d, n) => new Date(new Date(d).getTime() + n * 864e5).toISOString().slice(0, 10);
  const issued = String(b.issuedAt || '').slice(0, 10) || `${shiftP(b.period, -1)}-20`;
  const due = b.dueDate || dueDate(b.period);
  const c = calcBill({ ...b, payments: (b.payments || []).filter(p => p !== excludePayment) });
  return { start: addDays(issued, -5), due, late: addDays(due, 45), balance: c.balance };
}

// ห้องที่ไม่มีผู้เช่าเก็บเงิน (สำนักงาน 101) จดมิเตอร์ไว้ดูการใช้น้ำไฟเท่านั้น — ไม่นับเป็นยอดค้างชำระ
// ข้อมูลผู้เช่าที่ยังขาด (บันทึกได้ แต่แสดง ⚠️ เตือนให้ตามเก็บ)
export function missingInfo(t) {
  if (!t || t.active === false) return [];
  const m = [];
  if (!t.idPhoto) m.push('รูปบัตร');
  if (!String(t.phone || '').trim()) m.push('เบอร์โทร');
  if (!String(t.idNo || '').trim()) m.push('เลขบัตร');
  if (!t.birthDate && !t.company) m.push('วันเกิด');
  if (!String(t.address || '').trim()) m.push('ที่อยู่');
  return m;
}
export const missingText = t => { const m = missingInfo(t); return !m.length ? '' : m.length === 1 && m[0] === 'รูปบัตร' ? 'ยังไม่มีรูปบัตร' : 'ข้อมูลไม่ครบ: ' + m.join(', '); };

// เงินประกันที่ถูกหักไปชำระบิล (ช่องทาง "หักเงินประกัน") และยอดคงเหลือ — คำนวณจากรายการชำระ จึงถูกต้องเสมอเมื่อแก้/ลบรายการ
export const DEPOSIT_METHOD = 'หักเงินประกัน';
export const depositUsed = (t, excludePayment) => !t ? 0 : db.all('bills').filter(b => b.tenantId === t.id)
  .reduce((a, b) => a + (b.payments || []).filter(p => p.method === DEPOSIT_METHOD && p !== excludePayment).reduce((s, p) => s + (Number(p.amount) || 0), 0), 0);
export const depositLeft = (t, excludePayment) => Math.max(0, Math.round(((Number(t?.deposit) || 0) - depositUsed(t, excludePayment)) * 100) / 100);
export const isInternalRoom =roomId => db.get('rooms', roomId)?.kind === 'office' && !tenantOf(roomId);

export function billState(b) {
  if (!b) return 'none';
  if (b.status !== 'paid' && isInternalRoom(b.room)) return 'internal';
  if (b.status === 'draft') return 'draft';
  const c = calcBill(b);
  if (b.status === 'paid' || (c.paid > 0 && c.balance <= 0)) return 'paid';
  if (c.paid > 0) return 'partial';
  return new Date().toISOString().slice(0, 10) > (b.dueDate || dueDate(b.period)) ? 'late' : 'due';
}
export const BILL_TXT = { internal: ['ส่วนกลาง', 'idle'], paid: ['ชำระแล้ว', 'ok'], due: ['รอชำระ', 'warn'], late: ['ค้างชำระ', 'bad'], partial: ['ชำระบางส่วน', 'warn'], draft: ['ร่าง', 'idle'], none: ['ยังไม่มีบิล', 'idle'] };

// สถานะห้องสำหรับผัง: ใช้บิลล่าสุดของห้อง
export function roomState(r) {
  if (r.kind === 'office' && !tenantOf(r.id)) return 'common';
  if (!tenantOf(r.id) && r.kind === 'room') return 'vac';
  const b = db.all('bills').filter(x => x.room === r.id).sort((a, c) => c.period.localeCompare(a.period))[0];
  const s = billState(b);
  return s === 'late' ? 'late' : (s === 'due' || s === 'partial') ? 'due' : 'ok';
}
export const ROOM_TXT = { ok: ['ไม่มีค้าง', 'ok', 's-ok'], due: ['รอชำระ', 'warn', 's-due'], late: ['ค้างชำระ', 'bad', 's-late'], vac: ['ห้องว่าง', 'idle', 's-vac'], common: ['ส่วนกลาง', 'idle', 's-vac'] };

// ระยะเวลาเข้าพัก เช่น "2 ปี 3 เดือน" (ถ้ายังพักอยู่นับถึงวันนี้)
export function stayText(since, end) {
  if (!since) return '-';
  const a = new Date(since), b = end ? new Date(end) : new Date();
  if (isNaN(a) || isNaN(b) || b < a) return '-';
  let m = (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth() - (b.getDate() < a.getDate() ? 1 : 0);
  if (m < 1) return `${Math.max(1, Math.round((b - a) / 864e5))} วัน`;
  const y = Math.floor(m / 12); m %= 12;
  return [y && `${y} ปี`, m && `${m} เดือน`].filter(Boolean).join(' ');
}

// ประวัติการเช่าทั้งหมด (ผู้เช่าปัจจุบัน + ย้ายออกแล้ว) เรียงตามห้อง แล้วตามวันเข้าพักล่าสุดก่อน
export function stays(roomId = '') {
  return db.all('tenants').filter(t => !roomId || t.room === roomId)
    .sort((a, b) => a.room.localeCompare(b.room) || (b.active - a.active) || String(b.since || '').localeCompare(String(a.since || '')));
}

// ปรับข้อมูลเก่าในเครื่องให้ตรงรุ่นปัจจุบัน (เรียกตอนเปิดแอปและหลังนำเข้าไฟล์)
export async function migrateData() {
  // v0.3.0: ที่จอดรถยนต์เปลี่ยนชื่อจาก CA-n เป็น CAR-n
  for (const s of db.all('slots').filter(s => s.zone === 'CA')) {
    const id = s.id.replace(/^CA-/, 'CAR-');
    if (!db.get('slots', id)) await db.put('slots', { ...s, id, zone: 'CAR' });
    await db.remove('slots', s.id);
  }
  // v0.3.2: ยกเลิกช่อง B-16 (ลบเฉพาะถ้ายังไม่มีห้องใช้)
  const b16 = db.get('slots', 'B-16');
  if (b16 && !b16.room) await db.remove('slots', 'B-16');
  // v0.3.4: ช่องรถยนต์ด้านซ้าย (CAR-5 เดิม) เปลี่ยนเป็น CAR-6 และช่องใหม่ใต้ CAR-4 (SPARE เดิม) เป็น CAR-5
  // ข้อมูลรุ่นเก่าคือข้อมูลที่ยังไม่มี CAR-6
  const old5 = db.get('slots', 'CAR-5');
  if (old5 && !db.get('slots', 'CAR-6')) {
    const spare = db.get('slots', 'SPARE');
    await db.put('slots', { ...old5, id: 'CAR-6', zone: 'CAR' });
    await db.put('slots', { room: '', plate: '', vehicle: '', ...(spare || {}), id: 'CAR-5', zone: 'CAR' });
    if (spare) await db.remove('slots', 'SPARE');
  }
}

// งวดบิลที่ควรทำตอนนี้: หลังวันที่ 20 = เดือนหน้า
export function workingPeriod(d = new Date()) {
  const x = new Date(d.getFullYear(), d.getMonth() + (d.getDate() >= 20 ? 1 : 0), 1);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`;
}
