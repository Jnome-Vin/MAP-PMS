// อ่านข้อมูลจากรูปบัตรประชาชนไทย หรือ Passport (OCR ในเครื่อง ฟรี — ใช้ตัวอ่านเดียวกับสลิป)
//  บัตรประชาชน: เลข 13 หลัก (ตรวจเลขตรวจสอบ) ชื่อไทย/อังกฤษ วันเกิด ที่อยู่
//  Passport: อ่านแถบ MRZ 2 บรรทัดล่าง (P<THA...) → ชื่อ เลขพาสปอร์ต สัญชาติ วันเกิด วันหมดอายุ
// ผลอ่านเป็นข้อเสนอให้ผู้ใช้ตรวจทาน ไม่ใช่ข้อมูลยืนยันตัวตน
import { ocrLocal, parseSlipText } from './slip.js';

export function validThaiId(id) {
  const d = String(id).replace(/\D/g, '');
  if (d.length !== 13) return false;
  const sum = [...d.slice(0, 12)].reduce((a, c, i) => a + +c * (13 - i), 0);
  return (11 - (sum % 11)) % 10 === +d[12];
}
export const formatThaiId = id => { const d = String(id).replace(/\D/g, ''); return d.length === 13 ? `${d[0]} ${d.slice(1, 5)} ${d.slice(5, 10)} ${d.slice(10, 12)} ${d[12]}` : id; };

const line = (t, re) => { const m = t.match(re); return m ? m[1].replace(/\s+/g, ' ').trim() : ''; };

export function parseThaiIdCard(raw) {
  const t = String(raw || '').replace(/ํา/g, 'ำ').replace(/[ \t]+/g, ' ');
  const out = { type: 'thai-id', idNo: '', nameTh: '', nameEn: '', birthDate: '', address: '' };
  // เลข 13 หลัก (มีเว้นวรรคหรือขีดคั่นได้) — เลือกชุดที่ผ่านเลขตรวจสอบก่อน
  const cands = [...t.matchAll(/\d(?:[\s-]?\d){12}/g)].map(m => m[0].replace(/\D/g, ''));
  const id = cands.find(validThaiId) || cands[0];
  if (id) out.idNo = formatThaiId(id);
  out.nameTh = line(t, /ชื่อตัวและชื่อสกุล\s*[:.]?\s*([^\n]+)/);
  const first = line(t, /\bName\s*[:.]?\s*([A-Za-z .'-]+)/), last = line(t, /Last\s*name\s*[:.]?\s*([A-Za-z .'-]+)/i);
  out.nameEn = [first, last].filter(Boolean).join(' ');
  out.birthDate = parseSlipText(line(t, /Date\s*of\s*Birth\s*[:.]?\s*([^\n]+)/i)).date || parseSlipText(line(t, /เกิดวันที่\s*([^\n]+)/)).date;
  // "ที่อยู่" — OCR มักตกไม้เอก ("ทีอยู่") จึงไม่บังคับวรรณยุกต์
  const addr = t.match(/ที[่]?อยู[่]?\s*[:.]?\s*([\s\S]+?)(?:\n\s*(?:วันออกบัตร|Date of Issue|เจ้าพนักงาน|\d{1,2}\s*[ก-ฮ]\.[ก-ฮ]\.?\s*\d{4}\s*\n)|$)/);
  if (addr) out.address = addr[1].replace(/\s*\n\s*/g, ' ').trim().slice(0, 200);
  return out;
}

// MRZ ของ Passport (TD3: 2 บรรทัด x 44 ตัว)
export function parseMRZ(raw) {
  const lines = String(raw || '').toUpperCase().split(/\n/).map(s => s.replace(/\s+/g, '').replace(/[«‹(]/g, '<')).filter(s => s.length >= 30 && (s.match(/</g) || []).length >= 3);
  const i = lines.findIndex(s => /^P[A-Z<]/.test(s));
  if (i < 0 || !lines[i + 1]) return null;
  const l1 = lines[i], l2 = lines[i + 1];
  // ตัวเติม '<' ท้ายชื่อมักถูก OCR อ่านเป็น K/L — ตัดช่วงตัวเติมยาว ๆ ทิ้ง
  const namePart = l1.slice(5).replace(/[KL<]{4,}.*$/, '');
  let [sur, given = ''] = namePart.split('<<');
  given = given.replace(/(<[KL]?)+$/, '');
  const yymmdd = (s, future) => { if (!/^\d{6}$/.test(s)) return ''; let y = +s.slice(0, 2); const cy = new Date().getFullYear() % 100;
    y += future ? 2000 : (y > cy ? 1900 : 2000); return `${y}-${s.slice(2, 4)}-${s.slice(4, 6)}`; };
  return { type: 'passport', idNo: l2.slice(0, 9).replace(/</g, ''), nationality: l2.slice(10, 13).replace(/</g, ''), country: l1.slice(2, 5).replace(/</g, ''),
    nameEn: `${given.replace(/</g, ' ').trim()} ${sur.replace(/</g, ' ').trim()}`.trim(), birthDate: yymmdd(l2.slice(13, 19), false), expiry: yymmdd(l2.slice(21, 27), true), address: '' };
}

// อ่านรูป → { type, idNo, name, birthDate, address, ... } หรือ null ถ้าไม่พบข้อมูล
export async function readIdDocument(dataUrl, onProgress) {
  const text = await ocrLocal(dataUrl, onProgress);
  const mrz = parseMRZ(text);
  if (mrz?.idNo) return { ...mrz, name: mrz.nameEn };
  const th = parseThaiIdCard(text);
  if (!th.idNo && !th.nameTh && !th.nameEn) return null;
  return { ...th, name: th.nameTh || th.nameEn, validId: th.idNo ? validThaiId(th.idNo) : false };
}

// ผู้พักร่วม: รูปแบบเดิมเป็นข้อความชื่อ → รูปแบบใหม่ { name, idNo, photo }
export const occ = o => (typeof o === 'string' ? { name: o, idNo: '', photo: null } : { name: '', idNo: '', photo: null, ...o });
export const occName = o => occ(o).name;
