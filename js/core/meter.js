// อ่านเลขมิเตอร์ไฟ / น้ำ จากรูป
//  1) ปกติ: อ่านในเครื่องด้วย Tesseract (ฟรี)
//  2) ทางเลือก: Claude ผ่าน Apps Script เมื่อผู้ใช้กดเอง (แม่นกว่า · มีค่าใช้จ่ายเล็กน้อยต่อรูป · ต้องเปิด "อ่านด้วย Claude" ในตั้งค่า)
// ผลที่ได้เป็นค่าเริ่มต้นให้ผู้ใช้ตรวจ/แก้เสมอ ห้ามถือเป็นค่าสุดท้าย
import * as api from './api.js';
import { isServerMode } from './config.js';
import { loadTesseract } from './slip.js';

const toInt = s => { const d = String(s || '').replace(/\D/g, ''); return d ? String(Number(d)) : ''; };

let digitWorker;
async function readLocal(dataUrl) {
  const T = await loadTesseract();
  if (!digitWorker) digitWorker = (async () => {
    const w = await T.createWorker('eng', 1);
    await w.setParameters({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: '11' });
    return w;
  })();
  const w = await digitWorker;
  // ขยาย + ขาวดำ + เพิ่มความคมชัด ช่วยให้อ่านตัวเลขบนหน้าปัดได้ดีขึ้น
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl; });
  const k = 1600 / Math.max(img.width, img.height), c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  const g = c.getContext('2d'); g.drawImage(img, 0, 0, c.width, c.height);
  // หลักทศนิยมบนมิเตอร์มักเป็นช่องสีแดง → ระบายพื้นแดงเป็นขาว ตัวเลขในช่องนั้นจะหายไป ไม่ถูกอ่านรวม
  const px = g.getImageData(0, 0, c.width, c.height), d = px.data;
  for (let i = 0; i < d.length; i += 4) if (d[i] - Math.max(d[i + 1], d[i + 2]) > 40) d[i] = d[i + 1] = d[i + 2] = 255;
  g.putImageData(px, 0, 0);
  g.filter = 'grayscale(1) contrast(1.6)'; g.drawImage(c, 0, 0);
  // วงล้อตัวเลขมักเป็นเลขขาวบนพื้นดำ → อ่านทั้งภาพปกติและภาพกลับสี แล้วเลือกผลที่ดีที่สุด
  const inv = document.createElement('canvas'); inv.width = c.width; inv.height = c.height;
  const gi = inv.getContext('2d'); gi.filter = 'invert(1)'; gi.drawImage(c, 0, 0);
  const words = [];
  for (const src of [c, inv]) {
    const { data } = await w.recognize(src.toDataURL('image/png'), {}, { blocks: true });
    for (const x of data.words || []) words.push({ t: x.text.replace(/\D/g, ''), h: x.bbox.y1 - x.bbox.y0, conf: x.confidence });
  }
  // เลือกกลุ่มตัวเลข 4–8 หลักที่ตัวใหญ่ที่สุด (เลขหน่วยบนมิเตอร์มักใหญ่กว่าเลขเครื่อง/ปีผลิต) · ตัวใหญ่ใกล้กันให้ดูความมั่นใจ
  // (ค่าความมั่นใจของ Tesseract ใช้ไม่ได้เมื่อจำกัดเฉพาะตัวเลข → ใช้ขนาดตัวอักษร แล้วเลือกผลที่อ่านได้ตรงกันบ่อยที่สุด)
  const cand = words.filter(x => x.t.length >= 4 && x.t.length <= 8);
  const maxH = Math.max(0, ...cand.map(x => x.h)), big = cand.filter(x => x.h >= maxH * 0.8);
  const votes = big.reduce((m, x) => (m[x.t] = (m[x.t] || 0) + 1, m), {});
  const best = big.sort((a, b) => votes[b.t] - votes[a.t] || b.h - a.h)[0];
  return { reading: best ? toInt(best.t) : '', unclear: true, by: 'local' };
}

// kind: 'electric' | 'water' · ค่าเริ่มต้นใช้ตัวอ่านฟรีในเครื่อง · ai = true เฉพาะเมื่อผู้ใช้กดให้ Claude อ่าน (มีค่าใช้จ่าย)
export const canUseClaude = () => isServerMode() && navigator.onLine;
export async function readMeter(dataUrl, kind, { ai = false } = {}) {
  if (!ai) return readLocal(dataUrl);
  if (!canUseClaude()) throw new Error('ต้องเชื่อม Google และต่ออินเทอร์เน็ตก่อน');
  const r = (await api.call('readMeter', { dataUrl, kind })).meter;
  if (!r.is_meter) return { reading: '', notMeter: true, by: 'claude' };
  return { reading: toInt(r.reading), unclear: !!r.unclear, by: 'claude' };
}
