// สัญญาเช่า (ไทย / อังกฤษ สำหรับผู้เช่าต่างชาติ) ตามแบบสัญญาเดิมของอาคาร — ดูแบบที่ mockup/contract_mockup.html
// เนื้อหาเขียนไว้ที่เดียวเป็น "บล็อก" แล้วแปลงเป็น 2 แบบ: หน้า A4 (พิมพ์ / PDF) และไฟล์ Word (.docx)
// สีตัวอักษรตามไฟล์ต้นฉบับ: น้ำเงิน = ข้อมูลผู้เช่า · แดง = ห้อง/ค่าเช่า/ยอดรวม · ฟ้า = เดือน/มิเตอร์น้ำ · ส้ม = มิเตอร์ไฟ
// ช่องที่ยังไม่มีข้อมูลแสดงเป็นเส้นไข่ปลาไว้เขียนมือ
import * as db from './db.js';
import * as M from './model.js';
import * as api from './api.js';
import { isServerMode } from './config.js';
import { esc, bahtText } from './ui.js';
import { asset, pdfLibs } from './docs.js';
import { printInFrame } from './printframe.js';
import { zip, dataUrlBytes } from './zip.js';

const COLOR = { blue: '0070C0', red: 'EE0000', lblue: '4472C4', orange: 'ED7D31', head: '1F4E79', gray: '7A8A9A' };
const TH_M = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const EN_M = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const fDate = (iso, en) => { if (!iso) return ''; const [y, m, d] = String(iso).split('-').map(Number); return y ? (en ? `${d} ${EN_M[m - 1]} ${y}` : `${d} ${TH_M[m - 1]} ${y + 543}`) : ''; };
export const fMonth = (ym, en) => { if (!ym) return ''; const [y, m] = String(ym).split('-').map(Number); return y ? (en ? `${EN_M[m - 1]} ${y}` : `${TH_M[m - 1]} ${y + 543}`) : ''; };
const money = v => (Number(v) || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const money2 = v => (Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const has = v => v !== undefined && v !== null && String(v).trim() !== '';
export function enWords(n) {
  n = Math.round(Number(n) || 0); if (!n) return 'Zero Baht only';
  const O = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const T = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const h = x => [x >= 100 ? O[Math.floor(x / 100)] + ' Hundred' : '', x % 100 < 20 ? O[x % 100] : T[Math.floor(x % 100 / 10)] + (x % 10 ? '-' + O[x % 10] : '')].filter(Boolean).join(' ');
  const out = []; let r = n;
  for (const [v, w] of [[1e6, 'Million'], [1e3, 'Thousand'], [1, '']]) { const q = Math.floor(r / v); if (q) out.push(h(q) + (w ? ' ' + w : '')); r %= v; }
  return out.join(' ') + ' Baht only';
}

// ---------- ข้อมูลตั้งต้นของสัญญาจากผู้เช่า + ห้อง ----------
const daysIn = (y, m) => new Date(y, m, 0).getDate();
export function prorate(rent, moveIn) {
  if (!moveIn) return null;
  const [y, m, d] = moveIn.split('-').map(Number), dim = daysIn(y, m), days = dim - d + 1;
  return { days, dim, amount: Math.round((Number(rent) || 0) / dim * days) };
}
export function defaults(t) {
  const room = db.get('rooms', t.room) || {}, rt = M.roomRates(room, t), rent = Number(t.rent ?? room.rent) || 0;
  const slots = M.slotsOf(t.room), moto = slots.filter(s => !s.id.startsWith('CAR')), car = slots.filter(s => s.id.startsWith('CAR'));
  const last = M.readings(t.room)[0];
  const today = new Date(), iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const since = t.since || iso;
  const extras = [];
  if (Number(t.parkingFee)) extras.push({ name: car.length ? `ค่าที่จอดรถยนต์${car.map(s => ' ' + s.id + (s.plate ? ' ทะเบียน ' + s.plate : '')).join(',')}` : 'ค่าที่จอดรถ', amt: String(t.parkingFee) });
  return {
    lang: t.lang === 'en' ? 'en' : 'th', date: iso, room: t.room, phone: t.phone || '', tenantName: t.name || '', tenantId: t.idNo || '', faceCode: t.faceCode || '',
    minMonths: '6', rent: String(rent), firstMonth: since.slice(0, 7), mode: 'month', moveIn: since, firstDays: '', firstAmount: String(rent),
    depositNote: '', deposit: String(Number(t.deposit) || rent), clean: '1000',
    fridgeDoors: Number(t.fridge) ? '1' : '', fridgeFee: String(Number(t.fridge) || 0),
    motoKeys: moto.length ? String(moto.length) : '', plate: moto.map(s => s.plate).filter(Boolean).join(', '), motoFee: '0',
    keyRoom: '1', keyBath: '1', meterE: last?.e != null ? String(last.e) : '', meterW: last?.w != null ? String(last.w) : '',
    wRate: rt.water, eRate: rt.elec, extras, photos: [],
  };
}
const extraList = C => (C.extras || []).filter(x => has(x.name) || has(x.amt));
export const total = C => ['firstAmount', 'deposit', 'clean', 'fridgeFee', 'motoFee'].reduce((a, k) => a + (Number(C[k]) || 0), 0) + extraList(C).reduce((a, x) => a + (Number(x.amt) || 0), 0);

// ---------- บล็อกเนื้อหา ----------
// run: { t: ข้อความ, c: สี, b, i, u, dots: จำนวนจุด (ช่องว่าง), nw: ห้ามตัดบรรทัด (กลุ่ม) }
const T = t => ({ t });
const B = t => ({ t, b: 1 });
const EM = t => ({ t, c: 'red', b: 1, i: 1, u: 1 });
const BIU = t => ({ t, b: 1, i: 1, u: 1 });
const D = n => ({ t: '.'.repeat(n), dots: 1 });
const C_ = (t, c) => ({ t, c });
const V = (v, c, n = 14, f = x => x) => has(v) ? { t: String(f(v)), c } : D(n);
const NW = (...runs) => ({ nw: runs });

function contentTH(C, x) {
  const tot = total(C), first = C.mode === 'day'
    ? [T('ค่าเช่าเดือน '), V(fMonth(C.firstMonth), 'lblue', 22), T(' รวม '), V(C.firstDays, 'blue', 6), T(' วัน')]
    : [T('ค่าเช่าเดือน '), V(fMonth(C.firstMonth), 'lblue', 22), C_(' (เต็มเดือน)', 'blue')];
  const rows = [
    ['4.1', first, C.firstAmount], ['4.2', [T('ค่าประกันความเสียหาย ('), V(C.depositNote, 'blue', 40), T(')')], C.deposit],
    ['4.3', [T('ค่าประกันความสะอาด')], C.clean], ['4.4', [T('ค่าเช่าตู้เย็น '), V(C.fridgeDoors, 'blue', 4), T(' ประตู')], C.fridgeFee],
    ['4.5', [T('กุญแจที่จอดมอเตอร์ไซค์ '), V(C.motoKeys, 'blue', 4), T(' ดอก ทะเบียน '), V(C.plate, 'blue', 14)], C.motoFee],
    ...extraList(C).map((e, i) => [`4.${6 + i}`, [V(e.name, 'blue', 30)], e.amt])];
  const last = `4.${rows.length}`;
  return [
    { k: 'title', title: 'สัญญาเช่า', room: C.room },
    { k: 'row2', l: [{ t: 'เบอร์โทร ', b: 1 }, { ...V(C.phone, 'blue', 20), b: 1 }], r: [T('ทำที่  มีชัย อพาร์ทเม้นท์')], sp: 1 },
    { k: 'row2', l: [T('Wifi password: meechai1234')], r: [T('วันที่ '), V(fDate(C.date), 'blue', 24)] },
    { k: 'p', in: 1, sp: 1, runs: [T('สัญญานี้ทำขึ้นระหว่าง มีชัย อพาร์ทเม้นท์ ซึ่งต่อไปจะเรียกว่า “ผู้ให้เช่า” ฝ่ายหนึ่ง กับ '), NW(V(C.tenantName, 'blue', 40)), T(' บัตรประจำตัวเลขที่ '), NW(V(C.tenantId, 'blue', 30)), T(' ซึ่งต่อไปนี้จะเรียกว่า “ผู้เช่า” อีกฝ่ายหนึ่ง ทั้งสองฝ่ายตกลงทำสัญญาต่อกันดังนี้')] },
    { k: 'p', in: 1, sp: 1, runs: [T('1. ผู้ให้เช่าตกลงให้ผู้เช่าเช่าห้องพักอาศัย ห้องที่ '), V(C.room, 'red', 6), T(' ของอาคารเลขที่ 65/105 หมู่ 2 ถนนสามวา แขวงบางชัน เขตคลองสามวา กรุงเทพมหานคร เพื่อใช้สำหรับอยู่อาศัยเท่านั้นโดยมีผู้พักอาศัยอยู่เป็นจำนวนไม่เกิน '), V(x.occCount, 'blue', 4), T(' คน โดยได้แนบสำเนาบัตรประจำตัวประชาชนผู้อาศัยทุกท่านเป็นเอกสารแนบ')] },
    { k: 'p', in: 1, runs: [T('2. คู่สัญญาตกลงราคาค่าเช่าห้องพักอาศัย ตามข้อ 1. เป็นจำนวนเงินเดือนละ '), NW(V(C.rent, 'red', 10, money2), T(' บาท')), T(' '), NW(T('('), V(C.rent, 'red', 20, bahtText), T(')')),
      T(` โดยชำระเงินประกัน และค่าเช่าอื่น ตามข้อ 4.1-${last} รวมเป็นเงิน `), NW(C_(money(tot), 'red'), T(' บาท')), T(' '), NW(T('('), C_(bahtText(tot), 'red'), T(')'))] },
    { k: 'p', in: 1, runs: [T('3. ผู้เช่าตกลงเป็นผู้ชำระค่าไฟฟ้า,น้ำประปา ให้แก่ผู้ให้เช่าโดยคิดขั้นต่ำ 1 หน่วย/เดือนในอัตราดังนี้')] },
    { k: 'rate', a: '- ค่าไฟฟ้า', b: `หน่วยละ ${money2(C.eRate)} บาท` }, { k: 'rate', a: '- ค่าน้ำประปา', b: `หน่วยละ ${money2(C.wRate)} บาท` },
    { k: 'p', in: 1, runs: [T('4. ผู้เช่าทำการชำระเงินให้ผู้ให้เช่าตามรายการดังต่อไปนี้')] },
    { k: 'items', word: 'เป็นเงิน', unit: 'บาท', rows: rows.map(([n, r, a]) => [n, r, has(a) ? C_(money(a), 'blue') : D(8)]) },
    { k: 'p', runs: [T('โดยผู้เช่าจะได้รับกุญแจดังต่อไปนี้')] },
    { k: 'p', ind: 1, runs: [T('- กุญแจห้อง  '), V(C.keyRoom, 'blue', 4), T(' ดอก      - กุญแจห้องน้ำ  '), V(C.keyBath, 'blue', 4), T(' ดอก'), ...(has(C.motoKeys) ? [T('      - กุญแจที่จอดมอเตอร์ไซค์  '), C_(C.motoKeys, 'blue'), T(' ดอก')] : [])] },
    { k: 'p', in: 1, runs: [T('ในกรณีกุญแจสูญหายคิดดอกละ 1,000 บาท (เปลี่ยนกุญแจแม่กุญแจเดิมให้ผู้เช่าไป)')] },
    { k: 'p', in: 1, runs: [T('ในกรณีที่ผู้เช่าย้ายออกทางผู้ให้เช่าจะคิดค่าทำความสะอาดในกรณีไม่มีคราบกาว หรืออันใดที่ต้องใช้สารทำความสะอาดพิเศษ เป็นเงิน 1,000.00 บาท (หนึ่งพันบาทถ้วน)')] },
    { k: 'page', flow: 1 },
    { k: 'p', in: 1, runs: [T('โดยผู้เช่าไม่มีสิทธิที่จะคิดดอกเบี้ยเมื่อสัญญาเช่าสิ้นสุดลง และจะนำเงินประกันการเช่าจำนวนดังกล่าวมาหักจากค่าเช่าหรือค่าใช้จ่ายรายเดือนมิได้ เมื่อสิ้นสุดสัญญาผู้เช่ามิได้ทำความเสียหายใด ๆ ต่อห้องเช่า ผู้ให้เช่าต้องคืนเงินประกันดังกล่าวภายใน 7 วันทำการ หลังผู้เช่าส่งคืนห้อง และสรุปยอดคืนเงินเรียบร้อยแล้ว')] },
    { k: 'p', in: 1, runs: [T('5. ผู้เช่าจะต้องเช่าห้องพักอาศัยเป็นเวลา '), V(C.minMonths, 'red', 4), C_(' เดือน', 'red'), T(' ขึ้นไป จึงจะได้รับเงินประกันคืน')] },
    { k: 'p', in: 1, runs: [T('6. ผู้เช่าต้องชำระค่าเช่าพร้อมค่าน้ำ/ค่าไฟฟ้า/ค่าอื่น ๆ ภายในวันที่ 5 ของทุกเดือนโดยการโอนเงินเข้าบัญชี '), B('ชื่อบัญชี นายสุทิน มีชัยสัจจะ บัญชีออมทรัพย์ ธนาคารกรุงศรี เลขที่บัญชี 492-1-04599-1'), T(' และทำการส่งสลิปให้ทางไลน์ของผู้ให้เช่าจึงจะถือว่าได้ชำระเงินเรียบร้อยแล้ว ตลอดระยะเวลาการเช่าหากผู้เช่าไม่ชำระเงินค่าเช่าและค่าใช้จ่ายตามกำหนดเวลา ผู้เช่าจำเป็นต้องชำระค่าทวงถามเป็นเงินวันละ 100 บาท (หนึ่งร้อยบาทถ้วน) เริ่มนับจากวันที่ 6 ของทุกเดือน')] },
    { k: 'qr' },
    { k: 'p', in: 1, runs: [BIU('หากผู้เช่าไม่ชำระเงินค่าเช่าและค่าใช้จ่ายต่าง ๆ ภายในวันที่ 15 ของทุกเดือน ผู้เช่ายินยอมให้ผู้ให้เช่ายกเลิกสัญญาและจะย้ายออกภายในวันที่ 30 ของเดือน'), T(' โดยยังคงคิดค่าเช่าหักกับเงินในข้อ 4.')] },
    { k: 'p', in: 1, runs: [T('7. หากผู้เช่าประสงค์ที่จะเลิกการเช่า ให้ผู้เช่าแจ้งล่วงหน้าแก่ผู้ให้เช่า'), EM('เป็นลายลักษณ์อักษรทางไลน์ของผู้ให้เช่าล่วงหน้า 30 วัน โดยจะมีผล ณ. วันสิ้นเดือนของเดือนที่ครบ 30 วันเพื่อรับเงินประกันตามข้อ 4. คืน'), T(' และต้องคืนก่อน 12.00 น.ของวันสุดท้ายของเดือนที่เช่า ทั้งนี้ผู้เช่าต้องมิได้กระทำความเสียหายใด ๆ ผู้ให้เช่าหรือทรัพย์สินที่เช่าแต่ประการใด โดยหากมีความเสียหายที่เกิดขึ้นนอกเหนือจากการใช้งาน โดยปกติผู้ให้เช่าจะคิดค่าความเสียหายจากเงินประกัน และถ้าหากเงินประกันไม่เพียงพอ ผู้เช่ายังคงมีภาระต้องหาเงินมาชดใช้ให้กับผู้ให้เช่า')] },
    { k: 'p', in: 1, runs: [T('โดยผู้เช่าจะส่งคืนห้องก่อนเวลา 12.00 น.ของวันสุดท้ายของเดือนที่เช่า เพื่อให้ผู้ให้เช่ามาตรวจรับห้องคืน ยกเว้นวันหยุด ตามปฏิทิน ผู้เช่า จะส่งมอบก่อนวันสิ้นสัญญา ให้เสร็จสิ้นก่อนในเวลาก่อน 12.00 น.')] },
    { k: 'p', in: 1, runs: [T('8. '), EM('ห้ามผู้เช่าเลี้ยงสัตว์ ทำการตอกตะปู ใช้ครก แก๊สหุงต้ม ทำเสียงดังจนข้างห้องเกิดความรำคาญหรืออื่นใดอันก่อให้เกิดความเสียหายภายในห้องเช่า'), T(' โดยผู้ให้เช่ามีสิทธินำวัตถุดังกล่าวมาฝากไว้ที่ห้องเก็บของ และผู้เช่าสามารถเบิกคืนเพื่อนำออกไปจากสถานที่เช่าได้')] },
    { k: 'p', in: 1, runs: [T('9. ผู้เช่าสามารถขนย้ายทรัพย์สินใด ๆ '), C_('ในระหว่างเวลา 9.00 – 18.00 น.', 'red'), T(' ยกเว้นวันหยุดทำการของผู้ให้เช่า เพื่อไม่ให้รบกวนห้องอื่น '), EM('หากดำเนินการดังกล่าวจะถือว่าสละสิทธิในเงินประกันในข้อ 4.')] },
    { k: 'page', fill: 1, flow: 1 },
    { k: 'group', blocks: [
      { k: 'p', in: 1, runs: [T('10. ผู้เช่าสัญญาว่าจะเป็นผู้ดูแลทรัพย์สินต่าง ๆ ของผู้เช่าหรือบริวารด้วยตนเอง รวมทั้งสัญญาว่าจะดูแลรักษาห้องที่เช่าเฉกเช่นวิญญูชนพึงปฏิบัติต่อทรัพย์ตนเอง ซึ่งหากเกิดความเสียหายใดๆนอกเหนือจากความเสียหายจากการใช้งานโดยปกติ ในห้องที่เช่าระหว่างการเช่าผู้เช่าขอเป็นผู้รับผิดชอบเอง')] },
      { k: 'p', in: 1, runs: [T('11. ผู้เช่าได้ตรวจและรับมอบทรัพย์สินที่เช่าตามข้อ 1. ในสภาพเรียบร้อยตามใบตรวจสภาพห้องก่อนเช่า (ใบตรวจสภาพห้องถือเป็นส่วนหนึ่งของสัญญาเช่า) '), EM('ในกรณีที่มีความเสียหายจะต้องแจ้งในใบตรวจสภาพห้องก่อนเช่า พร้อมถ่ายรูปจุดที่มีความเสียหายแนบสัญญา หากไม่ได้ระบุในใบตรวจสภาพห้องให้ถือว่าจุดนั้นปกติ')] },
      { k: 'p', in: 1, runs: [T('12. ในกรณีที่มีการเปลี่ยนบัตรประจำตัวประชาชน เปลี่ยนเบอร์โทรศัพท์ ผู้เช่าต้องแจ้งให้ผู้ให้เช่าทราบ ทางโทรศัพท์ ทางไลน์ หรือช่องทางที่ติดต่อผู้เช่าได้ ภายใน 15 วันนับแต่ทำเรื่องเปลี่ยนแปลง')] },
      { k: 'p', in: 1, runs: [T('13. กฎของการใช้อาคารถือเป็นส่วนหนึ่งของสัญญาเช่าฉบับนี้')] },
      { k: 'p', in: 1, sp: 1, runs: [T('คู่สัญญาทั้งสองฝ่ายได้อ่านและทราบข้อความในสัญญานี้แล้ว เห็นว่าถูกต้องตรงตามเจตนารมณ์แห่งตนทุกประการ จึงได้ลงลายมือชื่อไว้เป็นหลักฐานต่อหน้าพยาน')] }] },
    { k: 'sign', sg: 'ลงชื่อ', roles: ['ผู้เช่า', 'ผู้ให้เช่า', 'ผู้อาศัย1', 'ผู้อาศัย2'], names: [C.tenantName, 'มีชัย อพาร์ทเม้นท์', x.occ[0], x.occ[1]] },
    { k: 'meters', l: [C_('มิเตอร์ไฟเริ่มต้น ', 'orange'), V(C.meterE, 'orange', 14)], r: [C_('มิเตอร์น้ำเริ่มต้น ', 'lblue'), V(C.meterW, 'lblue', 14)] },
    { k: 'group', blocks: [{ k: 'remarks', label: 'หมายเหตุ', n: 4 },
      { k: 'p', sp: 1, runs: [C_('***', 'red'), T(' เอกสารต้องแนบใบตรวจสภาพห้อง ก่อนเช่า และหากมีความผิดปกติต้องระบุในใบตรวจสภาพห้องพร้อมแนบรูปถ่าย เพื่อยืนยัน พร้อมให้ผู้เช่าลงลายมือชื่อรับรองความถูกต้องด้วย '), C_('***', 'red')] }] },
    ...checklist(C, { title: 'รายการตรวจสภาพห้องก่อนเช่า ห้อง', before: 'ก่อนเช่า', after: 'หลังเช่า', date: 'ตรวจสภาพวันที่', bed: 'ห้องนอน', bath: 'ห้องน้ำ', bal: 'ระเบียง',
      hint: '** ใส่ตัวเลขจุดที่ไม่ปกติ และเขียนตัวเลข พร้อมคำอธิบายความผิดปกติ ในช่องว่าง', ok: 'ปกติ', ng: 'ไม่ปกติ', tenant: 'ผู้เช่า', insp: 'ผู้ตรวจ',
      items: ['2.ระบบไฟฟ้า', '3.ระบบประปา และสุขภัณฑ์', '4.ระบบโทรทัศน์', '5.ระบบสุขภัณฑ์', '6.ประตูห้อง', '7.มุ้งลวด', '8.ม่าน', '9.แอร์', '10. ................'] }),
    ...attachments(x, 'รูปแนบ'),
  ];
}

function contentEN(C, x) {
  const tot = total(C), first = C.mode === 'day'
    ? [T('Rent for '), V(fMonth(C.firstMonth, 1), 'lblue', 22), T(' ('), V(C.firstDays, 'blue', 6), T(' days)')]
    : [T('Rent for '), V(fMonth(C.firstMonth, 1), 'lblue', 22), C_(' (full month)', 'blue')];
  const rows = [
    ['4.1', first, C.firstAmount], ['4.2', [T('Damage deposit ('), V(C.depositNote, 'blue', 34), T(')')], C.deposit],
    ['4.3', [T('Cleaning deposit')], C.clean], ['4.4', [T('Refrigerator rental, '), V(C.fridgeDoors, 'blue', 4), T(' door(s)')], C.fridgeFee],
    ['4.5', [T('Motorcycle parking key(s): '), V(C.motoKeys, 'blue', 4), T(', plate no. '), V(C.plate, 'blue', 14)], C.motoFee],
    ...extraList(C).map((e, i) => [`4.${6 + i}`, [V(e.name, 'blue', 30)], e.amt])];
  const last = `4.${rows.length}`;
  return [
    { k: 'title', title: 'RENTAL AGREEMENT', room: C.room },
    { k: 'row2', l: [{ t: 'Tel. ', b: 1 }, { ...V(C.phone, 'blue', 20), b: 1 }], r: [T('Made at  Meechai Apartment')], sp: 1 },
    { k: 'row2', l: [T('Wifi password: meechai1234')], r: [T('Date '), V(fDate(C.date, 1), 'blue', 24)] },
    { k: 'p', in: 1, sp: 1, runs: [T('This Agreement is made between Meechai Apartment, hereinafter called the “Lessor”, of the one part, and '), NW(V(C.tenantName, 'blue', 40)), T(', holder of Passport / Identification No. '), NW(V(C.tenantId, 'blue', 30)), T(', hereinafter called the “Lessee”, of the other part. Both parties agree as follows:')] },
    { k: 'p', in: 1, sp: 1, runs: [T('1. The Lessor agrees to let, and the Lessee agrees to rent, Room No. '), V(C.room, 'red', 6), T(' of the building at No. 65/105 Moo 2, Sam Wa Road, Bang Chan Subdistrict, Khlong Sam Wa District, Bangkok, for residential use only, with not more than '), V(x.occCount, 'blue', 4), T(' occupant(s). Copies of the passports / identification cards of all occupants are attached to this Agreement.')] },
    { k: 'p', in: 1, runs: [T('2. Both parties agree on a monthly rent for the room under Clause 1 of '), NW(V(C.rent, 'red', 10, money2), T(' Baht')), T(' '), NW(T('('), V(C.rent, 'red', 20, enWords), T(').')),
      T(` The deposits and other charges under Clauses 4.1–${last} total `), NW(C_(money(tot), 'red'), T(' Baht')), T(' '), NW(T('('), C_(enWords(tot), 'red'), T(').'))] },
    { k: 'p', in: 1, runs: [T('3. The Lessee agrees to pay the Lessor for electricity and water, with a minimum charge of 1 unit per month, at the following rates:')] },
    { k: 'rate', a: '- Electricity', b: `${money2(C.eRate)} Baht per unit` }, { k: 'rate', a: '- Water', b: `${money2(C.wRate)} Baht per unit` },
    { k: 'p', in: 1, runs: [T('4. The Lessee shall pay the Lessor the following:')] },
    { k: 'items', word: 'Amount', unit: 'Baht', rows: rows.map(([n, r, a]) => [n, r, has(a) ? C_(money(a), 'blue') : D(8)]) },
    { k: 'p', runs: [T('The Lessee will receive the following keys:')] },
    { k: 'p', ind: 1, runs: [T('- Room key(s): '), V(C.keyRoom, 'blue', 4), T('      - Bathroom key(s): '), V(C.keyBath, 'blue', 4), ...(has(C.motoKeys) ? [T('      - Motorcycle parking key(s): '), C_(C.motoKeys, 'blue')] : [])] },
    { k: 'p', in: 1, runs: [T('If a key is lost, a fee of 1,000 Baht per key will be charged (the lock will be replaced and the old padlock given to the Lessee).')] },
    { k: 'p', in: 1, runs: [T('When the Lessee moves out, the Lessor will charge a cleaning fee of 1,000.00 Baht (One Thousand Baht only), provided there are no adhesive stains or anything else that requires special cleaning agents.')] },
    { k: 'page', flow: 1 },
    { k: 'p', in: 1, runs: [T('The Lessee shall not be entitled to any interest on the deposit when the lease ends, and may not use the deposit to offset the rent or monthly charges. At the end of the lease, if the Lessee has caused no damage to the room, the Lessor shall return the deposit within 7 business days after the Lessee has returned the room and the refund has been settled.')] },
    { k: 'p', in: 1, runs: [T('5. The Lessee must rent the room for at least '), V(C.minMonths, 'red', 4), C_(' months', 'red'), T(' to be entitled to a refund of the deposit.')] },
    { k: 'p', in: 1, runs: [T('6. The Lessee shall pay the rent together with water, electricity and other charges by the 5th day of each month by bank transfer to '), B('Account name: Mr. Suthin Meechaisatja, Savings Account, Krungsri Bank, Account No. 492-1-04599-1'), T(', and shall send the transfer slip to the Lessor via LINE; only then will the payment be deemed complete. Throughout the lease, if the Lessee fails to pay the rent and charges on time, the Lessee shall pay a collection fee of 100 Baht (One Hundred Baht only) per day, starting from the 6th day of each month.')] },
    { k: 'qr' },
    { k: 'p', in: 1, runs: [BIU('If the Lessee fails to pay the rent and other charges by the 15th day of any month, the Lessee consents to the Lessor terminating this Agreement and shall move out by the 30th day of that month,'), T(' with the rent still being charged and deducted from the money under Clause 4.')] },
    { k: 'p', in: 1, runs: [T('7. If the Lessee wishes to terminate the lease, the Lessee shall give the Lessor '), EM("written notice via the Lessor's LINE at least 30 days in advance; the termination shall take effect at the end of the month in which the 30-day period ends, in order to receive the deposit under Clause 4 back,"), T(' and shall return the room before 12:00 noon on the last day of the rented month. The Lessee must not have caused any damage to the Lessor or the leased property. Any damage beyond normal use will be charged against the deposit, and if the deposit is insufficient, the Lessee shall remain liable to pay the remaining amount to the Lessor.')] },
    { k: 'p', in: 1, runs: [T('The Lessee shall return the room before 12:00 noon on the last day of the rented month so that the Lessor can inspect it. If that day is a public holiday, the Lessee shall hand over the room before the end of the lease, no later than 12:00 noon.')] },
    { k: 'p', in: 1, runs: [T('8. '), EM('The Lessee shall not keep pets, hammer nails, use a mortar and pestle, use cooking gas, make noise that disturbs neighbouring rooms, or do anything else that causes damage inside the room.'), T(' The Lessor has the right to move such items to the storage room, and the Lessee may collect them in order to take them off the premises.')] },
    { k: 'p', in: 1, runs: [T('9. The Lessee may move belongings in or out '), C_('only between 9:00 and 18:00', 'red'), T(", except on the Lessor's holidays, so as not to disturb other rooms. "), EM('Failure to comply shall be deemed a waiver of the deposit under Clause 4.')] },
    { k: 'page', fill: 1, flow: 1 },
    { k: 'group', blocks: [
      { k: 'p', in: 1, runs: [T("10. The Lessee agrees to look after the property of the Lessee and the Lessee's household personally, and to take care of the room as a reasonable person would take care of their own property. The Lessee shall be responsible for any damage to the room during the lease beyond damage from normal use.")] },
      { k: 'p', in: 1, runs: [T('11. The Lessee has inspected and received the property under Clause 1 in good condition, as recorded in the pre-rental room inspection form (which forms part of this Agreement). '), EM('Any damage must be recorded in the pre-rental room inspection form, with photos of the damaged points attached to this Agreement. Any point not recorded in the form shall be deemed to be in normal condition.')] },
      { k: 'p', in: 1, runs: [T('12. If the Lessee changes their passport / identification card or telephone number, the Lessee shall inform the Lessor by telephone, via LINE, or through any channel by which the Lessee can be contacted, within 15 days of the change.')] },
      { k: 'p', in: 1, runs: [T('13. The building rules form part of this Agreement.')] },
      { k: 'p', in: 1, runs: [T('This Agreement is made in Thai and English. In the event of any inconsistency between the two versions, the Thai version shall prevail.')] },
      { k: 'p', in: 1, sp: 1, runs: [T('Both parties have read and understood this Agreement, agree that it reflects their true intentions, and have therefore signed below in the presence of witnesses.')] }] },
    { k: 'sign', sg: 'Signed', roles: ['Lessee', 'Lessor', 'Occupant 1', 'Occupant 2'], names: [C.tenantName, 'Meechai Apartment', x.occ[0], x.occ[1]] },
    { k: 'meters', l: [C_('Initial electricity meter reading ', 'orange'), V(C.meterE, 'orange', 12)], r: [C_('Initial water meter reading ', 'lblue'), V(C.meterW, 'lblue', 12)] },
    { k: 'group', blocks: [{ k: 'remarks', label: 'Remarks', n: 4 },
      { k: 'p', sp: 1, runs: [C_('***', 'red'), T(' The pre-rental room inspection form must be attached. Any abnormality must be recorded in the form with photos as evidence, and the Lessee must sign to certify that it is correct. '), C_('***', 'red')] }] },
    ...checklist(C, { title: 'Pre-rental Room Inspection Form – Room', before: 'Before rental', after: 'After rental', date: 'Inspection date', bed: 'Bedroom', bath: 'Bathroom', bal: 'Balcony',
      hint: '** Number each abnormal point and write the number with a description of the problem in the space provided', ok: 'Normal', ng: 'Abnormal', tenant: 'Lessee', insp: 'Inspector',
      items: ['2. Electrical system', '3. Plumbing and sanitary ware', '4. TV system', '5. Sanitary fixtures', '6. Room door', '7. Insect screens', '8. Curtains', '9. Air conditioner', '10. ................'] }, true),
    ...attachments(x, 'Attachments'),
  ];
}

function checklist(C, t, en) {
  return [
    { k: 'page', fill: 1 },
    { k: 'group', blocks: [{ k: 'p', center: 1, runs: [{ t: t.title + ' ', b: 1 }, { ...V(C.room, 'red', 6), b: 1 }] },
      { k: 'check', before: t.before, after: t.after, date: [T(t.date + ' '), V(fDate(C.date, en), 'blue', 24)] }] },
    { k: 'room1', label: t.bed, lines: 8 },
    { k: 'p', center: 1, runs: [C_(t.hint, 'red')] },
    { k: 'room2', labels: [t.bath, t.bal], lines: 3 },
    { k: 'item', label: t.items[0], ok: t.ok, ng: t.ng },
    { k: 'insp', roles: [t.tenant, t.insp] },
    { k: 'page', fill: 1 },
    ...t.items.slice(1).map(label => ({ k: 'item', label, ok: t.ok, ng: t.ng })),
    { k: 'insp', roles: [t.tenant, t.insp] },
  ];
}
// รูปแนบ: บัตรผู้เช่า + ผู้อาศัย (ขนาดสัดส่วนบัตรจริง) แล้วต่อด้วยรูปอื่น หน้าแรก 4 รูป หน้าถัดไปหน้าละ 4 รูป
function attachments(x, title) {
  const ids = x.ids || [], photos = x.photos || [];
  if (!ids.length && !photos.length) return [];
  const out = [], first = photos.slice(0, ids.length ? 4 : 4), rest = photos.slice(first.length);
  out.push({ k: 'page' }, { k: 'att', title, ids, photos: first, tall: !ids.length, codeLbl: x.codeLbl });
  for (let i = 0; i < rest.length; i += 4) out.push({ k: 'page' }, { k: 'att', title, ids: [], photos: rest.slice(i, i + 4), tall: true });
  return out;
}

// ผังกางกล่องห้องนอน / ห้องน้ำ / ระเบียง ตามต้นฉบับ: [ความกว้าง, ความสูง, กว้างจริง (มม.), สี่เหลี่ยม [x, y, w, h]]
export const ROOMS = {
  bed: [234, 285, 56, [[60, 0, 117, 285], [0, 81, 234, 110], [75, 49, 26, 32], [76, 191, 19, 45], [108, 191, 56, 45]]],
  bath: [227, 160, 54, [[84, 0, 57, 160], [0, 53, 227, 44], [95, 16, 27, 37]]],
  bal: [214, 160, 51, [[56, 0, 87, 160], [0, 53, 214, 44], [64, 16, 71, 37]]],
};
// วาดเป็นรูป (ใช้ทั้งหน้า A4 และไฟล์ Word) — เส้นคมและตรงกันทุกแบบ
const roomSvg = def => `<img src="${roomPng(def)}" alt="" style="width:${def[2]}mm;display:block;margin:0 auto">`;
const roomPng = ([vw, vh, , rects], k = 4) => {
  const c = document.createElement('canvas'); c.width = (vw + 4) * k; c.height = (vh + 4) * k;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.strokeStyle = '#000'; g.lineWidth = 1.4 * k / 2;
  rects.forEach(([x, y, w, h]) => g.strokeRect((x + 2) * k, (y + 2) * k, w * k, h * k));
  return c.toDataURL('image/png');
};

// ---------- รวมข้อมูล + รูป ----------
export async function photoDataDb(id) {
  if (!id) return '';
  let p = await db.getPhoto(id);
  if (!p && isServerMode() && navigator.onLine) { try { const r = await api.call('getPhoto', { id }); p = { id, dataUrl: r.dataUrl }; await db.putPhoto(p); } catch {} }
  return p?.dataUrl || '';
}
// forLine = ฉบับส่ง LINE: ไม่มีรูปบัตรประชาชน (ลิงก์ Drive เปิดได้ทุกคนที่มีลิงก์)
// getPhoto(id) → dataUrl: ให้หน้าต่างสัญญาส่งรูปที่ยังไม่บันทึกเข้ามาได้
export async function build(C, t, { forLine = false, getPhoto = null } = {}) {
  const photoData = id => (getPhoto ? getPhoto(id) : photoDataDb(id));
  const occ = (t.occupants || []).map(o => (typeof o === 'string' ? { name: o } : o)).filter(o => o.name || o.photo);
  const x = { occCount: String(1 + occ.length), occ: [occ[0]?.name || '', occ[1]?.name || ''], ids: [], photos: [] };
  if (has(C.occCount)) x.occCount = C.occCount;
  const en = C.lang === 'en';
  if (!forLine) {
    const main = await photoData(t.idPhoto);
    if (main) x.ids.push({ url: main, label: (en ? 'Lessee' : 'ผู้เช่า') + (C.tenantName ? ' · ' + C.tenantName : ''), code: C.faceCode || '' });
    for (const [i, o] of occ.entries()) { const u = await photoData(o.photo); if (u) x.ids.push({ url: u, label: `${en ? 'Occupant' : 'ผู้อาศัย'} ${i + 1}${o.name ? ' · ' + o.name : ''}`, code: o.faceCode || '' }); }
    x.codeLbl = en ? 'Face scanner access code: ' : 'รหัสเครื่องสแกนใบหน้า: ';
  }
  const EN_LBL = { meterE: 'Electricity meter', meterW: 'Water meter', fridge: 'Refrigerator' };
  for (const p of C.photos || []) { const u = await photoData(p.id); if (u) x.photos.push({ url: u, label: (en && EN_LBL[p.tag]) || p.label || '' }); }
  return { blocks: en ? contentEN(C, x) : contentTH(C, x), en };
}

// ---------- หน้า A4 (HTML) ----------
const CSS = `
@page{size:A4;margin:0}
.ct-pg{width:210mm;height:297mm;background:#fff;padding:9mm 20mm 14mm;position:relative;font-family:'Sarabun','TH Sarabun New',sans-serif;font-size:15.5px;line-height:1.75;color:#000;overflow:hidden;
  display:flex;flex-direction:column;box-sizing:border-box;break-after:page;page-break-after:always;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.ct-pg:last-child{break-after:auto;page-break-after:auto}
.ct-pg *{box-sizing:border-box}
.ct-pg.en{font-size:14.5px;line-height:1.6;text-align:justify}
.ct-pg .wm{position:absolute;left:50%;top:52%;width:165mm;transform:translate(-50%,-50%);opacity:.13;pointer-events:none}
.ct-pg>*{position:relative}
.ct-hd{text-align:center;font-weight:700;font-size:16px;line-height:1.6;border-bottom:2.5px solid #1F4E79;padding-bottom:3px;margin:0 -2mm 14px}
.ct-ft{position:absolute!important;left:18mm;right:18mm;bottom:9mm;border-top:2.5px solid #1F4E79}
.ct-body{flex:1;display:flex;flex-direction:column;padding-bottom:3mm}
.ct-body.fill{justify-content:space-between}
.ct-pg p{margin:0}.ct-pg .in{text-indent:12mm}.ct-pg .ind{padding-left:12mm}.ct-pg .sp{margin-top:12px}.ct-pg .ctr{text-align:center}
.ct-title{display:flex;justify-content:center;position:relative;margin:4px 0 10px}
.ct-title u{font-size:21px;font-weight:700}
.ct-room{position:absolute;right:0;top:-6px;border:1.5px solid #000;width:42mm;height:15mm;display:flex;align-items:center;justify-content:center;font-size:21px;font-weight:700;color:#EE0000}
.ct-row2{display:flex;justify-content:space-between;text-align:left}
.ct-rate{padding-left:12mm;display:grid;grid-template-columns:30mm auto;text-align:left}
.ct-items{border-collapse:collapse;margin-left:6mm;width:calc(100% - 6mm);text-align:left}
.ct-items td{padding:0 2px;vertical-align:top}.ct-items td.a{text-align:right;width:22mm}.ct-items td.u{width:12mm;padding-left:8px}.ct-items td.l{width:20mm}
.c-blue{color:#0070C0}.c-red{color:#EE0000}.c-lblue{color:#4472C4}.c-orange{color:#ED7D31}.c-head{color:#1F4E79}
.dots{color:#7a8a9a;letter-spacing:-.5px}.c-orange .dots,.c-lblue .dots,.dots.c-orange,.dots.c-lblue{color:inherit}
.nw{white-space:nowrap}
.ct-qr{display:flex;justify-content:center;margin:8px 0}.ct-qr img{height:46mm}
.ct-sign{display:grid;grid-template-columns:1fr 1fr;gap:12mm 14mm;text-align:left}
.ct-sg{display:grid;grid-template-columns:auto 1fr 18mm;column-gap:2mm;row-gap:1.5mm;align-items:end}
.ct-pg.en .ct-sg{grid-template-columns:auto 1fr 21mm}
.ct-sg .dl{border-bottom:1.6px dotted #333;height:1.1em;margin-bottom:.35em}.ct-sg .sn{text-align:center;min-height:1.6em;white-space:nowrap}
.ct-rmk{display:flex;align-items:flex-end;gap:2mm;height:2.1em}.ct-rmk i{flex:1;border-bottom:1.6px dotted #333;margin-bottom:.45em}
.ct-check{display:flex;align-items:center;gap:34px}
.ct-box{display:inline-block;width:13px;height:15px;border:1.3px solid #000;border-radius:2px;vertical-align:-2px;margin-right:4px;position:relative}
.ct-box.t::after{content:'✓';position:absolute;left:0;top:-7px;color:#d00;font-weight:700;font-size:17px}
.ct-ln{border-bottom:1px dotted #555;height:2.1em}
.ct-cl{display:grid;grid-template-columns:48mm 22mm 24mm 1fr;align-items:start;font-size:13.5px;text-align:left}
.ct-cl .ln{border-bottom:1px dotted #555;height:1.6em;margin-bottom:6px}
.ct-sg1{border-bottom:1.6px dotted #333;height:2.2em;margin:0 6mm 1mm}
.ct-atttl{font-weight:700;font-size:19px;margin:0 0 4mm;text-align:center;text-decoration:underline}
.ct-pg p.j{text-align:justify}.ct-pg .zs{font-size:0}
.ct-att figcaption{text-align:center}.ct-att figcaption .fc{color:#000;font-size:13px}
.ct-att{display:grid;grid-template-columns:1fr 1fr;gap:6mm;margin-bottom:6mm}
.ct-att.one{grid-template-columns:1fr;width:calc(50% - 3mm);margin-left:auto;margin-right:auto}
.ct-att figure{margin:0;display:flex;flex-direction:column;align-items:center}
.ct-att .im{width:100%;height:76mm;display:flex;align-items:center;justify-content:center;overflow:hidden}
.ct-att .im.id{height:auto;aspect-ratio:85.6/54}.ct-att .im.tall{height:110mm}
.ct-att img{max-width:100%;max-height:100%;object-fit:contain}
.ct-att figcaption{font-size:12px;color:#555;margin-top:1mm}
@media screen{.ct-pg{margin:12px auto;box-shadow:0 2px 12px rgba(0,0,0,.14)}}
`;
const cls = r => [r.c ? 'c-' + r.c : '', r.dots ? 'dots' : ''].filter(Boolean).join(' ');
// เบราว์เซอร์จัดชิดขอบ (justify) ภาษาไทยได้เฉพาะตรงช่องว่าง → แทรกช่องว่างขนาด 0 ระหว่างคำ ให้ยืดได้ทุกคำแบบ Word (Thai Distributed)
const SEG = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('th', { granularity: 'word' }) : null;
const GSEG = SEG ? new Intl.Segmenter('th', { granularity: 'grapheme' }) : null;
// ชื่อเฉพาะที่ตัวตัดคำแยกผิด → ไม่ตัดกลางคำ
const KEEP_W = ['มีชัย', 'อพาร์ทเม้นท์', 'คลองสามวา', 'สามวา', 'บางชัน', 'กรุงเทพมหานคร', 'ผู้ให้เช่า', 'ผู้เช่า', 'ผู้อาศัย', 'ผู้พักอาศัย'];
const KEEP = new RegExp(`(${KEEP_W.join('|')})`), KEEP_ONE = new RegExp(`^(${KEEP_W.join('|')})$`);
// ห้ามแทรกติดช่องว่างเดิม (ช่องว่างติดกันจะถูกยุบรวม ทำให้ช่องว่างจริงหาย)
const thJ = s => {
  if (!SEG || !/[฀-๿]/.test(s)) return esc(s);
  const seg = s.split(KEEP).filter(Boolean).flatMap(p => (KEEP_ONE.test(p) ? [p] : [...SEG.segment(p)].map(x => x.segment)));
  // Thai Distributed (แบบ Word): ในคำคั่นทุกตัวอักษรด้วยช่องว่างไม่ตัดบรรทัดขนาด 0 (ยืดได้แต่ไม่ตัดกลางคำ) · ระหว่างคำใช้ช่องว่างปกติขนาด 0 (ตัดบรรทัดได้)
  const dist = w => (/^\s+$/.test(w) ? esc(w) : [...GSEG.segment(w)].map(g => esc(g.segment)).join('<span class="zs"> </span>'));
  return seg.map((x, i) => dist(x) + (i < seg.length - 1 && !/\s$/.test(x) && !/^\s/.test(seg[i + 1]) ? '<span class="zs"> </span>' : '')).join('');
};
const runHtml = (r, j) => {
  if (r.nw) return `<span class="nw">${r.nw.map(x => runHtml(x)).join('')}</span>`;
  let h = j && !r.dots ? thJ(r.t) : esc(r.t);
  if (r.b) h = `<b>${h}</b>`; if (r.i) h = `<i>${h}</i>`; if (r.u) h = `<u>${h}</u>`;
  const c = cls(r); return c ? `<span class="${c}">${h}</span>` : h;
};
const runsHtml = (rs, j) => rs.map(r => runHtml(r, j)).join('');
function blockHtml(b, ctx) {
  switch (b.k) {
    case 'title': return `<div class="ct-title"><u>${esc(b.title)}</u><div class="ct-room">${esc(b.room || '')}</div></div>`;
    case 'row2': return `<div class="ct-row2"${b.sp ? ' style="margin-top:14px"' : ''}><span>${runsHtml(b.l)}</span><span>${runsHtml(b.r)}</span></div>`;
    case 'p': { const j = !b.center && !ctx.en;
      return `<p class="${[b.in ? 'in' : '', b.ind ? 'ind' : '', b.sp ? 'sp' : '', b.center ? 'ctr' : '', j ? 'j' : ''].join(' ')}">${runsHtml(b.runs, j)}</p>`; }
    case 'rate': return `<div class="ct-rate"><span>${esc(b.a)}</span><span>${esc(b.b)}</span></div>`;
    case 'items': return `<table class="ct-items">${b.rows.map(([n, r, a]) => `<tr><td style="width:9mm">${n}</td><td>${runsHtml(r)}</td><td class="l">${esc(b.word)}</td><td class="a">${runHtml(a)}</td><td class="u">${esc(b.unit)}</td></tr>`).join('')}</table>`;
    case 'qr': return ctx.qr ? `<div class="ct-qr"><img src="${ctx.qr}" alt="QR"></div>` : '';
    case 'group': return `<div>${b.blocks.map(x => blockHtml(x, ctx)).join('')}</div>`;
    case 'sign': {
      const one = (role, name, paren) => `<div class="ct-sg"><span>${esc(b.sg)}</span><span class="dl"></span><span>${esc(role)}</span><span></span><span class="sn">${paren ? `(${name ? `<span class="c-blue">${esc(name)}</span>` : `<span class="dots">${'.'.repeat(34)}</span>`})` : esc(name)}</span><span></span></div>`;
      return `<div class="ct-sign">${one(b.roles[0], b.names[0], 1)}${one(b.roles[1], b.names[1], 0)}${one(b.roles[2], b.names[2], 1)}${one(b.roles[3], b.names[3], 1)}</div>`;
    }
    case 'meters': return `<div class="ct-row2" style="padding:0 ${ctx.en ? 6 : 12}mm"><span>${runsHtml(b.l)}</span><span>${runsHtml(b.r)}</span></div>`;
    case 'remarks': return `<div class="ct-rmk"><span>${esc(b.label)}</span><i></i></div>` + '<div class="ct-rmk"><i></i></div>'.repeat(b.n - 1);
    case 'check': return `<div class="ct-check"><span><span class="ct-box t"></span>${esc(b.before)}</span><span><span class="ct-box"></span>${esc(b.after)}</span><span>${runsHtml(b.date)}</span></div>`;
    case 'room1': return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8mm;align-items:center"><div class="ctr">${roomSvg(ROOMS.bed)}<div style="margin-top:3mm"><b>${esc(b.label)}</b></div></div><div>${'<div class="ct-ln"></div>'.repeat(b.lines)}</div></div>`;
    case 'room2': return `<div><div style="display:grid;grid-template-columns:1fr 1fr;gap:8mm;text-align:center"><div>${roomSvg(ROOMS.bath)}<div style="margin-top:3mm"><b>${esc(b.labels[0])}</b></div></div><div>${roomSvg(ROOMS.bal)}<div style="margin-top:3mm"><b>${esc(b.labels[1])}</b></div></div></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8mm"><div>${'<div class="ct-ln"></div>'.repeat(b.lines)}</div><div>${'<div class="ct-ln"></div>'.repeat(b.lines)}</div></div></div>`;
    case 'item': return `<div class="ct-cl"><span>${esc(b.label)}</span><span><span class="ct-box"></span>${esc(b.ok)}</span><span><span class="ct-box"></span>${esc(b.ng)}</span><div><div class="ln"></div><div class="ln"></div></div></div>`;
    case 'insp': return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:20mm;text-align:center;margin-top:6mm"><div><div class="ct-sg1"></div>${esc(b.roles[0])}</div><div><div class="ct-sg1"></div>${esc(b.roles[1])}</div></div>`;
    case 'att': {
      const code = p => p.code != null ? `<div class="fc">${esc(b.codeLbl || '')}${p.code ? `<span class="c-blue">${esc(p.code)}</span>` : `<span class="dots">${'.'.repeat(16)}</span>`}</div>` : '';
      const fig = (p, c) => `<figure><div class="im ${c}"><img src="${p.url}" alt=""></div>${p.label ? `<figcaption>${esc(p.label)}${code(p)}</figcaption>` : ''}</figure>`;
      return `<div><p class="ct-atttl">${esc(b.title)}</p>${b.ids.length ? `<div class="ct-att${b.ids.length === 1 ? ' one' : ''}">${b.ids.map(p => fig(p, 'id')).join('')}</div>` : ''}
        ${b.photos.length ? `<div class="ct-att">${b.photos.map(p => fig(p, b.tall ? 'tall' : '')).join('')}</div>` : ''}</div>`;
    }
  }
  return '';
}
// แบ่งเป็นหน้า A4 ตามบล็อก "page"
function pagesOf(blocks) {
  const pages = [{ fill: false, blocks: [] }];
  for (const b of blocks) b.k === 'page' ? pages.push({ fill: !!b.fill, blocks: [] }) : pages[pages.length - 1].blocks.push(b);
  return pages.filter(p => p.blocks.length);
}
const headHtml = en => en ? '<div class="ct-hd">Meechai Apartment<br>65/105 Moo 2, Sam Wa Road, Bang Chan, Khlong Sam Wa, Bangkok 10510</div>'
  : '<div class="ct-hd">มีชัย อพาร์ทเม้นท์<br>65/105 หมู่ 2 ถนนสามวา แขวงบางชัน เขตคลองสามวา กรุงเทพมหานคร 10510</div>';
export async function pagesHtml(doc) {
  const [wm, qr] = await Promise.all([asset('brand'), asset('qr')]);
  const ctx = { qr, en: doc.en };
  return pagesOf(doc.blocks).map(p => `<div class="ct-pg ${doc.en ? 'en' : ''}">${wm ? `<img class="wm" src="${wm}" alt="">` : ''}${headHtml(doc.en)}<div class="ct-body${p.fill ? ' fill' : ''}">${p.blocks.map(b => blockHtml(b, ctx)).join('')}</div><div class="ct-ft"></div></div>`).join('');
}
const SARABUN = 'https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap';
export const docStyle = () => `<link href="${SARABUN}" rel="stylesheet"><style>${CSS}</style>`;
// CSS สำหรับแสดงตัวอย่างในหน้าต่างแอป (ไม่มี @page เพื่อไม่ให้กระทบการพิมพ์หน้าอื่น)
export const previewCss = () => CSS.replace('@page{size:A4;margin:0}', '');

export async function printContract(doc) {
  return printInFrame(`${docStyle()}<div id="ct-src" style="font-family:Sarabun;position:absolute;opacity:0">ก0<b>ก0</b></div>${await pagesHtml(doc)}`, d => d.getElementById('ct-src')?.remove());
}

// ---------- PDF (วาดทีละหน้าในเครื่อง) ----------
export async function contractPdf(doc, { scale = 2, quality = 0.88 } = {}) {
  await pdfLibs();
  if (!document.getElementById('ct-font')) document.head.insertAdjacentHTML('beforeend', `<link id="ct-font" href="${SARABUN}" rel="stylesheet">`);
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;z-index:-1';
  host.innerHTML = `<style>${CSS.replace('@media screen{.ct-pg{margin:12px auto;box-shadow:0 2px 12px rgba(0,0,0,.14)}}', '')}</style><div style="font-family:Sarabun">ก0<b>ก0</b></div>${await pagesHtml(doc)}`;
  document.body.appendChild(host);
  try {
    await document.fonts?.load?.('16px Sarabun'); await document.fonts?.load?.('bold 16px Sarabun'); await document.fonts?.ready;
    await Promise.all([...host.querySelectorAll('img')].map(i => i.complete ? null : new Promise(r => { i.onload = i.onerror = r; setTimeout(r, 4000); })));
    const pdf = new window.jspdf.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    const pgs = [...host.querySelectorAll('.ct-pg')];
    for (const [i, pg] of pgs.entries()) {
      const canvas = await window.html2canvas(pg, { scale, backgroundColor: '#ffffff', logging: false });
      if (i) pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/jpeg', quality), 'JPEG', 0, 0, 210, 297);
    }
    return pdf;
  } finally { host.remove(); }
}
export const fileName = (C, ext) => `สัญญาเช่า-${C.room}-${String(C.date || '').slice(0, 7)}${C.lang === 'en' ? '-EN' : ''}.${ext}`;

// ---------- Word (.docx) ----------
const xmlEsc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// ฟอนต์เดียวกับสัญญาต้นฉบับ (Angsana New 16pt มีในทุกเครื่อง Windows) — TH Sarabun New ไม่ได้ติดตั้งมาในเครื่อง Word จะเปลี่ยนเป็นฟอนต์อื่นแทน
const FONT = 'Angsana New';
const TW = 9639;   // ความกว้างพื้นที่พิมพ์ (twips) = A4 11906 − ขอบซ้าย 1134 − ขอบขวา 1133 (ตามไฟล์ต้นฉบับ)
const imgSize = url => new Promise(r => { const i = new Image(); i.onload = () => r([i.naturalWidth, i.naturalHeight]); i.onerror = () => r([4, 3]); i.src = url; });
const fit = ([w, h], mw, mh) => { const k = Math.min(mw / w, mh / h); return [w * k, h * k]; };

function docxWriter() {
  const media = [];   // { rid, name, bytes, ext }
  let n = 0;
  const addImage = (url, scope = 'doc') => {
    const ext = /^data:image\/png/.test(url) ? 'png' : 'jpeg';
    const rid = `rIdImg${media.length + 1}`;
    media.push({ rid, scope, name: `image${media.length + 1}.${ext}`, bytes: dataUrlBytes(url), ext });
    return rid;
  };
  const drawing = (rid, wmm, hmm) => {
    const cx = Math.round(wmm * 36000), cy = Math.round(hmm * 36000), id = ++n;
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Picture ${id}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="img${id}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  };
  return { media, addImage, drawing };
}
const rPr = r => {
  const c = r.c ? COLOR[r.c] : r.dots ? COLOR.gray : '';
  return `<w:rPr>${r.b ? '<w:b/><w:bCs/>' : ''}${r.i ? '<w:i/><w:iCs/>' : ''}${c ? `<w:color w:val="${c}"/>` : ''}${r.sz ? `<w:sz w:val="${r.sz}"/><w:szCs w:val="${r.sz}"/>` : ''}${r.u ? '<w:u w:val="single"/>' : ''}</w:rPr>`;
};
// กลุ่มห้ามตัดบรรทัด (เช่น ชื่อ-สกุล) → ใช้ช่องว่างแบบไม่ตัดบรรทัดใน Word
const flat = rs => rs.flatMap(r => (r.nw ? flat(r.nw).map(x => (x.dots ? x : { ...x, t: String(x.t).replace(/ /g, ' ') })) : [r]));
const runX = r => `<w:r>${rPr(r)}<w:t xml:space="preserve">${xmlEsc(r.t)}</w:t></w:r>`;
const tab = (r = {}) => `<w:r>${rPr(r)}<w:tab/></w:r>`;
const P = (inner, { jc, ind, first, before = 0, after = 0, tabs = '', keep } = {}) =>
  `<w:p><w:pPr>${keep ? '<w:keepNext/>' : ''}${tabs ? `<w:tabs>${tabs}</w:tabs>` : ''}<w:spacing w:before="${before}" w:after="${after}"/>${ind || first ? `<w:ind w:left="${ind || 0}"${first ? ` w:firstLine="${first}"` : ''}/>` : ''}${jc ? `<w:jc w:val="${jc}"/>` : ''}</w:pPr>${inner}</w:p>`;
const TABS = (...t) => t.map(([pos, val = 'left', leader]) => `<w:tab w:val="${val}" w:pos="${pos}"${leader ? ` w:leader="${leader}"` : ''}/>`).join('');
const cellX = (w, inner, { border, vAlign } = {}) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${border ? '<w:tcBorders><w:top w:val="single" w:sz="12"/><w:left w:val="single" w:sz="12"/><w:bottom w:val="single" w:sz="12"/><w:right w:val="single" w:sz="12"/></w:tcBorders>' : ''}${vAlign ? `<w:vAlign w:val="${vAlign}"/>` : ''}</w:tcPr>${inner}</w:tc>`;
const tableX = (widths, rows) => `<w:tbl><w:tblPr><w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders><w:tblCellMar><w:left w:w="40" w:type="dxa"/><w:right w:w="40" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${widths.map(w => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${rows.map(r => `<w:tr>${r}</w:tr>`).join('')}</w:tbl>`;
const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

async function blockDocx(b, ctx) {
  const W = ctx.W, en = ctx.en, jc = en ? 'both' : 'thaiDistribute';
  switch (b.k) {
    case 'title': return tableX([2400, 4839, 2400], [cellX(2400, P('')) + cellX(4839, P(runX({ t: b.title, b: 1, u: 1, sz: 42 }), { jc: 'center' }), { vAlign: 'center' }) +
      cellX(2400, P(runX({ t: b.room || '', b: 1, c: 'red', sz: 42 }), { jc: 'center', before: 60, after: 60 }), { border: 1, vAlign: 'center' })]);
    case 'row2': return P(flat(b.l).map(runX).join('') + tab() + flat(b.r).map(runX).join(''), { tabs: TABS([TW, 'right']), before: b.sp ? 240 : 0 });
    case 'p': return P(flat(b.runs).map(runX).join(''), { jc: b.center ? 'center' : jc, first: b.in ? 680 : 0, ind: b.ind ? 680 : 0, before: b.sp ? 200 : 0 });
    case 'rate': return P(runX({ t: b.a }) + tab() + runX({ t: b.b }), { ind: 680, tabs: TABS([2400]) });
    case 'items': return b.rows.map(([n, r, a]) => P(runX({ t: n }) + tab() + flat(r).map(runX).join('') + tab() + runX({ t: b.word }) + tab() + runX(a) + tab() + runX({ t: b.unit }),
      { ind: 340, tabs: TABS([900], [6500], [8550, 'right'], [8750]) })).join('');
    case 'qr': return ctx.qr ? P(ctx.wr.drawing(ctx.wr.addImage(ctx.qr), ...fit(ctx.qrSize, 120, 46)), { jc: 'center', before: 120, after: 120 }) : '';
    case 'group': return (await Promise.all(b.blocks.map(x => blockDocx(x, ctx)))).join('');
    case 'sign': {
      const half = Math.floor(W / 2), roleW = en ? 1300 : 1050;
      const one = (role, name, paren) => P(runX({ t: b.sg + ' ' }) + tab() + runX({ t: ' ' + role }), { tabs: TABS([half - roleW - 300, 'left', 'dot']), before: 480 }) +
        P(paren ? (name ? runX({ t: '(' }) + runX({ t: name, c: 'blue' }) + runX({ t: ')' }) : runX({ t: '(' + '.'.repeat(34) + ')', dots: 1 })) : runX({ t: name }), { jc: 'center', ind: 0, after: 360 });
      return tableX([half, W - half], [cellX(half, one(b.roles[0], b.names[0], 1)) + cellX(W - half, one(b.roles[1], b.names[1], 0)),
        cellX(half, one(b.roles[2], b.names[2], 1)) + cellX(W - half, one(b.roles[3], b.names[3], 1))]);
    }
    case 'meters': return P(flat(b.l).map(runX).join('') + tab() + flat(b.r).map(runX).join(''), { ind: 680, tabs: TABS([TW - 680, 'right']), before: 240, after: 240 });
    case 'remarks': return P(runX({ t: b.label + ' ' }) + tab(), { tabs: TABS([TW, 'right', 'dot']) }) + Array(b.n - 1).fill(P(tab(), { tabs: TABS([TW, 'right', 'dot']) })).join('');
    case 'check': return P(runX({ t: '☑ ', c: 'red' }) + runX({ t: b.before }) + tab() + runX({ t: '☐ ' + b.after }) + tab() + flat(b.date).map(runX).join(''), { tabs: TABS([2200], [4300]), after: 200 });
    case 'room1': {
      const [vw, vh, mm] = ROOMS.bed, img = ctx.wr.drawing(ctx.wr.addImage(roomPng(ROOMS.bed)), mm, mm * vh / vw);
      const lines = Array(b.lines).fill(P(tab(), { tabs: TABS([W / 2 - 200, 'right', 'dot']), before: 120 })).join('');
      return tableX([W / 2, W / 2], [cellX(W / 2, P(img, { jc: 'center', before: 120 }) + P(runX({ t: b.label, b: 1 }), { jc: 'center', before: 120, after: 120 }), { vAlign: 'center' }) + cellX(W / 2, lines, { vAlign: 'center' })]);
    }
    case 'room2': {
      const im = k => { const [vw, vh, mm] = ROOMS[k]; return ctx.wr.drawing(ctx.wr.addImage(roomPng(ROOMS[k])), mm, mm * vh / vw); };
      const lines = Array(b.lines).fill(P(tab(), { tabs: TABS([W / 2 - 200, 'right', 'dot']), before: 120 })).join('');
      return tableX([W / 2, W / 2], [cellX(W / 2, P(im('bath'), { jc: 'center', before: 120 }) + P(runX({ t: b.labels[0], b: 1 }), { jc: 'center', before: 120 })) + cellX(W / 2, P(im('bal'), { jc: 'center', before: 120 }) + P(runX({ t: b.labels[1], b: 1 }), { jc: 'center', before: 120 })),
        cellX(W / 2, lines) + cellX(W / 2, lines)]);
    }
    case 'item': return P(runX({ t: b.label }) + tab() + runX({ t: '☐ ' + b.ok }) + tab() + runX({ t: '☐ ' + b.ng }) + tab(), { tabs: TABS([2900], [4200], [TW, 'right', 'dot']), before: 160 }) +
      P(tab(), { tabs: TABS([5600], [TW, 'right', 'dot']), after: 120 });
    case 'insp': return P(tab({}) + tab() + tab() + tab(), { tabs: TABS([600], [4000, 'left', 'dot'], [5600], [9000, 'left', 'dot']), before: 600 }) +
      P(tab() + runX({ t: b.roles[0] }) + tab() + runX({ t: b.roles[1] }), { tabs: TABS([2300, 'center'], [7300, 'center']) });
    case 'att': {
      const half = Math.floor(W / 2);
      const cap = p => !p.label ? P('', { after: 120 }) : p.code == null ? P(runX({ t: p.label, sz: 24 }), { jc: 'center', after: 120 })
        : P(runX({ t: p.label, sz: 24 }), { jc: 'center' }) + P(runX({ t: b.codeLbl || '', sz: 24 }) + (p.code ? runX({ t: p.code, c: 'blue', sz: 24 }) : runX({ t: '.'.repeat(16), dots: 1, sz: 24 })), { jc: 'center', after: 120 });
      const cell = async (p, mw, mh) => { const [w, h] = fit(await imgSize(p.url), mw, mh); return cellX(half, P(ctx.wr.drawing(ctx.wr.addImage(p.url), w, h), { jc: 'center' }) + cap(p)); };
      const grid = async (list, mw, mh) => { const rows = []; for (let i = 0; i < list.length; i += 2) rows.push((await cell(list[i], mw, mh)) + (list[i + 1] ? await cell(list[i + 1], mw, mh) : cellX(half, P('')))); return rows.length ? tableX([half, W - half], rows) : ''; };
      const ids = b.ids.length === 1 ? tableX([W], [cellX(W, P(ctx.wr.drawing(ctx.wr.addImage(b.ids[0].url), ...fit(await imgSize(b.ids[0].url), 82, 54)), { jc: 'center' }) + cap(b.ids[0]))]) : await grid(b.ids, 82, 54);
      return P(runX({ t: b.title, b: 1, u: 1, sz: 38 }), { jc: 'center', after: 120 }) + ids + await grid(b.photos, 82, b.tall ? 105 : 72);
    }
  }
  return '';
}

export async function contractDocx(doc) {
  const [wm, qr] = await Promise.all([asset('brand'), asset('qr')]);
  const wr = docxWriter();
  const ctx = { W: TW, en: doc.en, wr, qr, qrSize: qr ? await imgSize(qr) : [4, 3] };
  const parts = [];
  for (const b of doc.blocks) {
    // หน้า 1–3 ของสัญญาให้ Word ตัดหน้าเองตามความยาวข้อความ (บังคับขึ้นหน้าใหม่เฉพาะใบตรวจสภาพห้องและรูปแนบ)
    if (b.k === 'page') { if (parts.length && !b.flow) parts.push(pageBreak); continue; }
    parts.push(await blockDocx(b, ctx));
  }
  const wmRid = wm ? 'rIdWm' : null, wmBytes = wm ? dataUrlBytes(wm) : null;
  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
  const sect = `<w:sectPr><w:headerReference w:type="default" r:id="rIdHdr"/><w:footerReference w:type="default" r:id="rIdFtr"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1133" w:bottom="1276" w:left="1134" w:header="426" w:footer="720" w:gutter="0"/></w:sectPr>`;
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${parts.join('')}${sect}</w:body></w:document>`;
  // หัวกระดาษ: ชื่อ + ที่อยู่ + เส้นน้ำเงิน · ลายน้ำโลโก้แบบ "ซีดจาง" (เหมือนไฟล์ต้นฉบับ) อยู่หลังข้อความทุกหน้า
  const cx = 165 * 36000, cy = cx;
  const wmXml = wmRid ? `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="0" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:align>center</wp:align></wp:positionH><wp:positionV relativeFrom="page"><wp:align>center</wp:align></wp:positionV><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="9000" name="Watermark"/><wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="9000" name="watermark"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${wmRid}"><a:lum bright="70000" contrast="-70000"/></a:blip><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>` : '';
  const hd = doc.en ? ['Meechai Apartment', '65/105 Moo 2, Sam Wa Road, Bang Chan, Khlong Sam Wa, Bangkok 10510'] : ['มีชัย อพาร์ทเม้นท์', '65/105 หมู่ 2 ถนนสามวา แขวงบางชัน เขตคลองสามวา กรุงเทพมหานคร 10510'];
  const header = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${NS}>${P(wmXml + runX({ t: hd[0], b: 1 }), { jc: 'center' })}<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="18" w:space="4" w:color="1F4E79"/></w:pBdr><w:spacing w:before="0" w:after="0"/><w:jc w:val="center"/></w:pPr>${runX({ t: hd[1], b: 1 })}</w:p></w:hdr>`;
  const footer = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${NS}><w:p><w:pPr><w:pBdr><w:top w:val="single" w:sz="18" w:space="4" w:color="1F4E79"/></w:pBdr></w:pPr></w:p></w:ftr>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:eastAsia="${FONT}" w:cs="${FONT}"/><w:sz w:val="32"/><w:szCs w:val="32"/><w:lang w:val="${doc.en ? 'en-US' : 'th-TH'}" w:bidi="th-TH"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`;
  const rel = (id, type, target) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`;
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel('rIdStyles', 'styles', 'styles.xml')}${rel('rIdHdr', 'header', 'header1.xml')}${rel('rIdFtr', 'footer', 'footer1.xml')}${wr.media.map(m => rel(m.rid, 'image', 'media/' + m.name)).join('')}</Relationships>`;
  const hdrRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${wmRid ? rel(wmRid, 'image', 'media/watermark.png') : ''}</Relationships>`;
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  return zip([
    { name: '[Content_Types].xml', data: types }, { name: '_rels/.rels', data: rootRels },
    { name: 'word/document.xml', data: document }, { name: 'word/styles.xml', data: styles },
    { name: 'word/header1.xml', data: header }, { name: 'word/footer1.xml', data: footer },
    { name: 'word/_rels/document.xml.rels', data: docRels }, { name: 'word/_rels/header1.xml.rels', data: hdrRels },
    ...(wmBytes ? [{ name: 'word/media/watermark.png', data: wmBytes }] : []),
    ...wr.media.map(m => ({ name: 'word/media/' + m.name, data: m.bytes })),
  ]);
}

export function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

// ---------- ส่ง LINE (เฉพาะห้องที่ผูก LINE OA แล้ว · ฉบับไม่มีรูปบัตร) ----------
export async function sendContractLine(C, t, getPhoto) {
  if (!isServerMode()) throw new Error('ต้องเชื่อม Google และตั้งค่า LINE OA ก่อน (เมนูตั้งค่า)');
  if (!navigator.onLine) throw new Error('ต้องเชื่อมต่ออินเทอร์เน็ตก่อนส่ง LINE');
  if (!M.lineLinkOf(C.room)) throw new Error(`ห้อง ${C.room} ยังไม่ได้ผูก LINE OA`);
  const pdf = await contractPdf(await build(C, t, { forLine: true, getPhoto }), { scale: 1.6, quality: 0.8 });
  const r = await api.call('sendContract', { room: C.room, lang: C.lang, name: fileName(C, 'pdf'), tenantName: C.tenantName, date: C.date, pdf: pdf.output('datauristring') });
  return r;
}
