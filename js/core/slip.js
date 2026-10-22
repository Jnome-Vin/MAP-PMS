// อ่านสลิปโอนเงินแบบฟรี
//  1) QR บนสลิป (มาตรฐานตรวจสอบสลิปของธนาคารไทย) → รหัสธนาคารผู้โอน + เลขอ้างอิงรายการ — ทำในเครื่อง ใช้ได้ตอน offline
//  2) ข้อความจาก OCR (Google Drive ผ่าน Apps Script) → ยอดเงิน วันที่ เวลา เลขอ้างอิง
//  3) กันสลิปซ้ำ: เทียบเลขอ้างอิงและลายนิ้วมือของรูปกับการรับชำระที่บันทึกไว้แล้ว
// หมายเหตุ: QR บนสลิปไม่มียอดเงิน — ยอดมาจาก OCR หรือกรอกเอง
import * as db from './db.js';

export const BANKS = { '002': 'กรุงเทพ', '004': 'กสิกรไทย', '006': 'กรุงไทย', '011': 'ทหารไทยธนชาต', '014': 'ไทยพาณิชย์', '022': 'ซีไอเอ็มบี', '024': 'ยูโอบี',
  '025': 'กรุงศรีอยุธยา', '030': 'ออมสิน', '033': 'อาคารสงเคราะห์', '034': 'ธ.ก.ส.', '066': 'อิสลาม', '067': 'ทิสโก้', '069': 'เกียรตินาคินภัทร', '073': 'แลนด์ แอนด์ เฮ้าส์' };

// ---------- QR ----------
function tlv(s) {   // แยกข้อมูลรูปแบบ [รหัส 2 หลัก][ความยาว 2 หลัก][ค่า]
  const out = {}; let i = 0;
  while (i + 4 <= s.length) { const id = s.slice(i, i + 2), n = +s.slice(i + 2, i + 4); if (isNaN(n)) break; out[id] = s.slice(i + 4, i + 4 + n); i += 4 + n; }
  return out;
}
export function parseSlipQR(payload) {
  const top = tlv(String(payload || '').trim()), api = top['00'] && tlv(top['00']);
  if (!api || !api['02'] || top['51'] !== 'TH') return null;   // ไม่ใช่ QR ของสลิป (เช่นเป็น QR พร้อมเพย์สำหรับจ่ายเงิน)
  return { bankCode: api['01'] || '', bank: BANKS[api['01']] || (api['01'] ? 'ธนาคารรหัส ' + api['01'] : ''), ref: api['02'] };
}

let jsQRLoading;
const loadJsQR = () => jsQRLoading ||= new Promise((res, rej) => {
  if (window.jsQR) return res(window.jsQR);
  const s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
  s.onload = () => res(window.jsQR); s.onerror = () => { jsQRLoading = null; rej(new Error('โหลดตัวอ่าน QR ไม่ได้')); };
  document.head.appendChild(s);
});
// คืนข้อความใน QR หรือ '' ถ้าไม่พบ
export async function decodeQR(dataUrl) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl; });
  if ('BarcodeDetector' in window) {
    try { const r = await new window.BarcodeDetector({ formats: ['qr_code'] }).detect(img); if (r[0]) return r[0].rawValue; } catch {}
  }
  const jsQR = await loadJsQR();
  for (const max of [1200, 800, 1600]) {   // ลองหลายขนาด เพิ่มโอกาสอ่านเจอ
    const k = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    const g = c.getContext('2d'); g.drawImage(img, 0, 0, c.width, c.height);
    const r = jsQR(g.getImageData(0, 0, c.width, c.height).data, c.width, c.height, { inversionAttempts: 'attemptBoth' });
    if (r?.data) return r.data;
  }
  return '';
}

// ---------- ข้อความ OCR ----------
const TH_MON = { 'ม.ค': 1, 'ก.พ': 2, 'มี.ค': 3, 'เม.ย': 4, 'พ.ค': 5, 'มิ.ย': 6, 'ก.ค': 7, 'ส.ค': 8, 'ก.ย': 9, 'ต.ค': 10, 'พ.ย': 11, 'ธ.ค': 12,
  'มกราคม': 1, 'กุมภาพันธ์': 2, 'มีนาคม': 3, 'เมษายน': 4, 'พฤษภาคม': 5, 'มิถุนายน': 6, 'กรกฎาคม': 7, 'สิงหาคม': 8, 'กันยายน': 9, 'ตุลาคม': 10, 'พฤศจิกายน': 11, 'ธันวาคม': 12 };
const EN_MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const toYear = y => { y = +y; if (y < 100) y += y > 50 ? 2500 : 2000; if (y > 2400) y -= 543; return y; };   // 69 → 2569 → 2026
const iso = (y, m, d) => `${toYear(y)}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const money = s => Number(String(s).replace(/,/g, ''));

// เดือนย่อแบบทนต่อ OCR: พยัญชนะต้น + พยัญชนะท้าย (OCR มักใส่จุด/วรรณยุกต์ผิด เช่น "ต.ุค,")
const ABBR = { 'มค': 1, 'กพ': 2, 'มีค': 3, 'เมย': 4, 'พค': 5, 'มิย': 6, 'กค': 7, 'สค': 8, 'กย': 9, 'ตค': 10, 'พย': 11, 'ธค': 12 };
export function parseSlipText(raw) {
  const t = String(raw || '').replace(/ /g, ' ').replace(/ํา/g, 'ำ').replace(/[ \t]+/g, ' ');
  const r = { amount: 0, date: '', time: '', reference: '' };

  // ยอดเงิน: หลังคำว่า จำนวน/จำนวนเงิน/Amount หรือ ตัวเลขที่ตามด้วย บาท/THB
  const am = t.match(/(?:จำนวน(?:เงิน)?|ยอด(?:เงิน|โอน)?|amount)\s*[:：]?\s*(?:฿|THB)?\s*([\d,]+\.\d{2})/i)
    || t.match(/([\d,]+\.\d{2})\s*(?:บาท|THB|฿)/i) || t.match(/(?:฿|THB)\s*([\d,]+\.\d{2})/i);
  if (am) r.amount = money(am[1]);
  else { const all = [...t.matchAll(/\b\d{1,3}(?:,\d{3})*\.\d{2}\b/g)].map(x => money(x[0])).filter(x => x > 0); if (all.length) r.amount = Math.max(...all); }

  // วันที่: 21 ต.ค. 69 / 21 ตุลาคม 2569 / 21/10/2569 / 21 Oct 2026
  let d = t.match(/(\d{1,2})\s*(ม\.ค|ก\.พ|มี\.ค|เม\.ย|พ\.ค|มิ\.ย|ก\.ค|ส\.ค|ก\.ย|ต\.ค|พ\.ย|ธ\.ค)\.?\s*(\d{2,4})/)
    || t.match(/(\d{1,2})\s*(มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม)\s*(\d{2,4})/);
  if (d) r.date = iso(d[3], TH_MON[d[2]], d[1]);
  else if ((d = t.replace(/[ุู็-์]/g, '').match(/(\d{1,2})\s*(มี|มิ|เม|[มกพสตธ])[.,\s]{0,3}([คพย])[.,]{0,2}\s*(\d{2,4})/)) && ABBR[d[2] + d[3]])
    r.date = iso(d[4], ABBR[d[2] + d[3]], d[1]);
  else if ((d = t.match(/(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s*(\d{2,4})/i))) r.date = iso(d[3], EN_MON[d[2].toLowerCase()], d[1]);
  else if ((d = t.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/))) r.date = iso(d[3], d[2], d[1]);

  const tm = t.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)(?:[:.][0-5]\d)?\s*(?:น\.?)?/);
  if (tm) r.time = `${tm[1].padStart(2, '0')}:${tm[2]}`;

  const ref = t.match(/(?:เลขที่รายการ|รหัสอ้างอิง|เลขอ้างอิง|หมายเลขอ้างอิง|รหัสรายการ|Ref(?:erence)?(?:\s*No\.?)?|Transaction\s*(?:ID|No\.?))\s*[:：]?\s*([A-Za-z0-9]{8,})/i);
  if (ref) r.reference = ref[1];
  return r;
}

// ---------- OCR ในเครื่อง (ฟรี, Tesseract.js) — โหลดครั้งแรกจากอินเทอร์เน็ต แล้วใช้ offline ได้ ----------
let tessWorker;
const loadTesseract = () => new Promise((res, rej) => {
  if (window.Tesseract) return res(window.Tesseract);
  const s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  s.onload = () => res(window.Tesseract); s.onerror = () => rej(new Error('โหลดตัวอ่านข้อความไม่ได้ (ต้องต่ออินเทอร์เน็ตครั้งแรก)'));
  document.head.appendChild(s);
});
export async function ocrLocal(dataUrl, onProgress) {
  const T = await loadTesseract();
  if (!tessWorker) tessWorker = T.createWorker('tha+eng', 1, { logger: m => m.status === 'recognizing text' && onProgress?.(Math.round(m.progress * 100)) });
  const w = await tessWorker;
  return (await w.recognize(dataUrl)).data.text;
}

// ---------- ตรวจสลิปเทียบกับบิล ----------
// read: { amount, date } จากสลิป · pay: { amount, date } ที่จะบันทึก · window: model.payWindow() (+ expected = ยอดที่ต้องชำระ)
// คืนรายการผลตรวจ [{ level: ok|warn|bad, key, text }] — bad = ต้องยืนยันก่อนบันทึก
export function verifySlip(read, pay, window) {
  const out = [], f = n => (Number(n) || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 });
  if (read.amount > 0) {
    const diff = Math.round((pay.amount - read.amount) * 100) / 100;
    out.push(diff === 0 ? { level: 'ok', key: 'amount', text: `ยอดในสลิป ฿${f(read.amount)} ตรงกับยอดที่บันทึก` }
      : { level: 'bad', key: 'amount', text: `ยอดในสลิป ฿${f(read.amount)} ไม่ตรงกับยอดที่บันทึก ฿${f(pay.amount)} (ต่าง ฿${f(Math.abs(diff))})` });
    const exp = window.expected ?? window.balance, d2 = Math.round((read.amount - exp) * 100) / 100;
    if (exp > 0) out.push(d2 === 0 ? { level: 'ok', key: 'due', text: `ยอดในสลิปตรงกับยอดที่ต้องชำระ ฿${f(exp)}` }
      : { level: 'bad', key: 'due', text: `ยอดในสลิป ฿${f(read.amount)} ไม่ตรงกับยอดที่ต้องชำระ ฿${f(exp)} — ${d2 < 0 ? 'ชำระขาด' : 'ชำระเกิน'} ฿${f(Math.abs(d2))}` });
  } else out.push({ level: 'warn', key: 'amount', text: 'อ่านยอดจากสลิปไม่ได้ — กรุณาตรวจด้วยตา' });

  if (read.date) {
    if (pay.date && read.date !== pay.date) out.push({ level: 'warn', key: 'paydate', text: `วันที่ในสลิป ${read.date} ไม่ตรงกับวันที่ชำระที่บันทึก ${pay.date}` });
    if (read.date < window.start) out.push({ level: 'bad', key: 'period', text: `โอนก่อนรอบบิลนี้ (${read.date} ก่อน ${window.start}) — อาจเป็นสลิปของงวดก่อน` });
    else if (read.date > window.late) out.push({ level: 'bad', key: 'period', text: `โอนหลังครบกำหนดนานเกินไป (${read.date}) — อาจเป็นสลิปของงวดอื่น` });
    else if (read.date > window.due) {
      const days = Math.round((new Date(read.date) - new Date(window.due)) / 864e5);
      out.push({ level: 'warn', key: 'period', text: `อยู่ในงวดนี้ แต่ชำระหลังกำหนด ${days} วัน (ครบกำหนด ${window.due})` });
    } else out.push({ level: 'ok', key: 'period', text: `วันที่โอน ${read.date} อยู่ในงวดและไม่เกินกำหนดชำระ` });
  } else out.push({ level: 'warn', key: 'period', text: 'อ่านวันที่จากสลิปไม่ได้ — กรุณาตรวจด้วยตา' });
  return out;
}
export const slipIssues = checks => (checks || []).filter(c => c.level === 'bad');

// ---------- กันสลิปซ้ำ ----------
export async function imageHash(dataUrl) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(dataUrl));
  return [...new Uint8Array(b)].slice(0, 16).map(x => x.toString(16).padStart(2, '0')).join('');
}
// คืนรายการชำระเดิมที่ใช้สลิปเดียวกัน (เลขอ้างอิงหรือรูปเดียวกัน) หรือ null
export function findDuplicate({ ref, hash }) {
  const norm = s => String(s || '').replace(/\s+/g, '').toUpperCase();
  for (const b of db.all('bills')) for (const p of b.payments || []) {
    if ((ref && norm(p.slipRef) === norm(ref)) || (hash && p.slipHash === hash)) return { bill: b, payment: p };
  }
  return null;
}
