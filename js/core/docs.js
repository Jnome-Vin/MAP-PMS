// เอกสารบิล: ใบแจ้งหนี้ / ใบเสร็จรับเงิน (ไทย/อังกฤษ) หน้าตาตามโปรแกรมเดิม (Invoi-L.rpt)
// ใช้ทั้งพิมพ์ในเครื่อง และส่งให้ server ทำ PDF ส่ง LINE
import * as M from './model.js';
import { esc, fmt, bahtText, englishAmount, thDate } from './ui.js';
import { printInFrame } from './printframe.js';

const ASSETS = { logo: 'assets/logo.png', qr: 'assets/payment-qr.png', sign: 'assets/signature.png' };
const cache = {};
// รูปเป็น dataURL เพื่อให้ฝังใน PDF ได้ และพิมพ์ได้ตอน offline
export async function asset(key) {
  if (cache[key]) return cache[key];
  try {
    const blob = await (await fetch(ASSETS[key])).blob();
    cache[key] = await new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(blob); });
  } catch { cache[key] = ''; }
  return cache[key];
}
export const preloadAssets = () => Promise.all(Object.keys(ASSETS).map(asset));

const T = {
  th: { invoice: 'ใบแจ้งหนี้', receipt: 'ใบเสร็จรับเงิน', room: 'หมายเลขห้อง', name: 'ชื่อ-นามสกุล', date: 'วันเวลาที่พิมพ์', item: 'รายการ', qty: 'จำนวนหน่วย',
    price: 'ราคาต่อหน่วย', amount: 'จำนวนเงิน', total: 'รวมเงิน', paid: 'ชำระแล้ว', balance: 'คงค้าง', tenant: 'ผู้เช่า', preparer: 'ผู้จัดทำ', receiver: 'ผู้รับเงิน', due: 'ครบกำหนดชำระ' },
  en: { invoice: 'INVOICE', receipt: 'RECEIPT', room: 'Room No', name: 'Name', date: 'Print Date', item: 'Description', qty: 'Quantity',
    price: 'Price/Unit', amount: 'Amount', total: 'Total', paid: 'Paid', balance: 'Balance', tenant: 'TENANT', preparer: 'PREPARER', receiver: 'RECEIVER', due: 'Due date' },
};

// เลย์เอาต์ตามใบแจ้งหนี้โปรแกรมเดิม บนกระดาษ A4 (794×1123 px ที่ 96 dpi)
// ขอบบน 12 มม. ข้าง 16 มม. ล่าง 25 มม. — เส้นน้ำเงินล่างอยู่เหนือขอบล่าง มีพื้นที่กระดาษเหลือใต้เส้นเหมือนใบเดิม
const CSS = `
.doc{font-family:"IBM Plex Sans Thai","Sarabun","TH Sarabun New",sans-serif;color:#111;font-size:15px;line-height:1.5;max-width:680px;margin:0 auto}
.doc table.lay{width:100%;border-collapse:collapse}
.doc table.lay td{padding:0;vertical-align:top;border:0}
.doc .logo{width:165px}.doc .brand{font-weight:700;color:#1b2a6b;font-size:20px}
.doc .title{border:1.5px solid #111;border-radius:16px;padding:12px 10px;font-size:21px;font-weight:700;color:#c00;text-align:center}
.doc .no{text-align:center;font-weight:700;margin-top:22px}
.doc .rule{border-top:3px solid #1b2a6b;margin:8px 0 16px}
.doc table.info{border-collapse:collapse;margin:0 0 16px 30px}
.doc table.info td{padding:5px 0;border:0;vertical-align:top}
.doc table.info td.k{width:210px}
.doc table.items{width:100%;border-collapse:separate;border-spacing:0;border:1.5px solid #111;border-radius:12px}
.doc table.items th{font-weight:700;border-bottom:1px solid #111;border-left:1px solid #111;padding:12px 6px;text-align:center;white-space:nowrap}
.doc table.items td{border-left:1px solid #111;padding:6px 16px;vertical-align:top}
.doc table.items th.f,.doc table.items td.f{border-left:0}
.doc table.items td.f{white-space:nowrap}
.doc table.items td.n{text-align:right;white-space:nowrap}.doc table.items td.c{text-align:center}
.doc table.items tr.sp td{height:8px;padding:0 16px}
.doc table.items tr.tot td{border-top:1px solid #111;font-weight:700;padding:12px 16px;white-space:normal}
.doc .note{margin:26px 0 0;font-size:15px;color:#111}
.doc table.sign{border-collapse:collapse;margin:12px auto 0;width:94%}
.doc table.sign td{padding:0;border:0;vertical-align:bottom}
.doc table.sign td.lbl{white-space:nowrap;width:1%}
.doc table.sign td.dots{text-align:center;width:45%}
.doc table.sign td.gap{width:9%}
.doc table.sign tr.img td{height:56px;text-align:center}
.doc .sig{height:80px;position:relative;top:30px;z-index:1}   /* เลื่อนลงให้ปลายลายเซ็นทับเส้นประ (ไม่ลอย) */
.doc .qr{text-align:center;margin:12px 0 34px}.doc .qr img{width:268px}
.doc .stamp{color:#2e8b57;font-weight:700;font-size:16px;margin:30px 0 6px}
.doc .foot{border-top:3px solid #1b2a6b;margin-top:40px}
.a4{width:794px;height:1123px;padding:36px 60px 110px;box-sizing:border-box;background:#fff;overflow:hidden}
.a4 .doc{height:100%;max-width:none;display:flex;flex-direction:column}.a4 .doc .foot{margin-top:auto}
@media print{.a4{height:295mm;break-after:page;page-break-after:always}.a4:last-child{break-after:auto;page-break-after:auto}}
`;
export const docCss = () => CSS;

// type: 'invoice' | 'receipt'
export async function docHtml(b, { type = 'invoice', lang = M.langOf(b), payment = null } = {}) {
  const t = T[lang] || T.th, p = M.property(), c = M.calcBill(b), lines = M.billLines(b, lang);
  const [logo, qr, sign] = await Promise.all([asset('logo'), asset('qr'), asset('sign')]);
  const now = new Date();
  const amount = type === 'receipt' && payment ? payment.amount : c.total;
  const no = type === 'receipt' ? (payment?.receiptNo || b.receiptNo || '-') : (b.invoiceNo || '-');
  const dots = '.'.repeat(44);
  return `<div class="doc">
  <table class="lay"><tr>
    <td>${logo ? `<img class="logo" src="${logo}" alt="">` : `<div class="brand">${esc(p.nameEn || p.name)}</div>`}
      ${p.address || p.phone || p.taxId ? `<div style="font-size:12px">${esc(p.address || '')}${p.phone ? ' โทร ' + esc(p.phone) : ''}${p.taxId ? '<br>เลขประจำตัวผู้เสียภาษี ' + esc(p.taxId) : ''}</div>` : ''}</td>
    <td style="width:250px;padding-top:12px"><div class="title">${type === 'receipt' ? t.receipt : t.invoice}</div><div class="no">NO. ${esc(no)}</div></td>
  </tr></table>
  <div class="rule"></div>
  <table class="info">
    <tr><td class="k">${t.room} :</td><td>${esc(b.room)}</td></tr>
    <tr><td class="k">${t.name} :</td><td>${esc(b.tenantName || '')}</td></tr>
    <tr><td class="k">${t.date} :</td><td>${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}<span style="display:inline-block;width:80px"></span>${now.toTimeString().slice(0, 8)}</td></tr>
  </table>
  <table class="items"><thead><tr><th class="f">${t.item}</th><th style="width:105px">${t.qty}</th><th style="width:110px">${t.price}</th><th style="width:120px">${t.amount}</th></tr></thead><tbody>
    <tr class="sp"><td class="f"></td><td></td><td></td><td></td></tr>
    ${lines.map(l => `<tr><td class="f"><span style="display:inline-block;min-width:110px">${esc(l.label)}</span>${esc(l.sub || '')}</td><td class="c">${l.qty ?? ''}</td><td class="n">${l.price != null ? fmt2(l.price) : ''}</td><td class="n">${fmt2(l.amount)}</td></tr>`).join('')}
    <tr class="sp"><td class="f"></td><td></td><td></td><td></td></tr>
    ${type === 'receipt' && c.paid !== c.total ? `<tr class="tot"><td class="f" style="text-align:center" colspan="2"></td><td class="c">${t.total}</td><td class="n">${fmt2(c.total)}</td></tr>` : ''}
    <tr class="tot"><td class="f" style="text-align:center" colspan="2">( ${lang === 'en' ? englishAmount(amount) : bahtText(amount)} )</td><td class="c">${type === 'receipt' ? t.paid : t.total}</td><td class="n">${fmt2(amount)}</td></tr>
  </tbody></table>
  ${type === 'receipt' ? `<p class="stamp">✔ ${t.paid} ${thDate(payment?.date || b.paidAt)}${c.balance > 0 ? ` · ${t.balance} ${fmt2(c.balance)}` : ''}</p>`
    : `<p class="note">${esc(lang === 'en' ? (p.billNoteEn || p.billNote || '') : (p.billNote || ''))}</p>`}
  <table class="sign">
    <tr class="img"><td class="lbl"></td><td class="dots"></td><td class="gap"></td><td class="lbl"></td>
      <td class="dots">${type === 'invoice' && sign ? `<img class="sig" src="${sign}" alt="">` : ''}</td></tr>
    <tr><td class="lbl">${t.tenant}</td><td class="dots">${dots}</td><td class="gap"></td>
      <td class="lbl">${type === 'receipt' ? t.receiver : t.preparer}</td><td class="dots">${dots}</td></tr>
  </table>
  ${type === 'invoice' && qr && p.showQr !== false ? `<div class="qr"><img src="${qr}" alt="QR ชำระเงิน"></div>` : ''}
  <div class="foot"></div>
</div>`;
}
const fmt2 = n => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// บิลที่รายการเยอะจนเกินหน้า → ย่อทั้งใบให้พอดี 1 แผ่น A4 (เผื่อความสูงตอนพิมพ์ 296 มม.)
const A4_CONTENT_PX = Math.floor(295 * 96 / 25.4) - 36 - 110 - 4;
function fitA4(root) {
  root.querySelectorAll('.a4 .doc').forEach(d => {
    d.style.transform = d.style.height = d.style.width = d.style.maxWidth = '';
    // ความสูงที่ต้องใช้จริง = ผลรวมความสูงของส่วนต่างๆ (ไม่นับช่องว่างยืดหยุ่นเหนือเส้นล่าง)
    const win = d.ownerDocument.defaultView;   // อาจอยู่ในกรอบพิมพ์ (iframe)
    const need = [...d.children].reduce((h, k) => { const cs = win.getComputedStyle(k); return h + k.offsetHeight + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom); }, 0);
    if (need <= A4_CONTENT_PX) return;
    const s = A4_CONTENT_PX / need;
    d.style.transformOrigin = 'top left';
    d.style.transform = `scale(${s.toFixed(4)})`;
    d.style.width = d.style.maxWidth = `${(100 / s).toFixed(2)}%`;   // ขยายกล่องก่อนย่อ เพื่อให้ย่อแล้วยังเต็มความกว้าง/สูงพอดี
    d.style.height = `${(100 / s).toFixed(2)}%`;
  });
}

// PDF ขนาด A4 จริง วาดในเครื่องจากหน้าตาเดียวกับที่พิมพ์ (html2canvas + jsPDF) → ส่งให้ server เก็บใน Drive และแนบลิงก์ใน LINE
// ตัวแปลง HTML→PDF ของ Google กำหนดขนาดกระดาษไม่ได้ จึงทำ PDF เองเพื่อให้ได้ A4 ตรงกับใบที่พิมพ์
const LIBS = {
  html2canvas: 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',
  jspdf: 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
};
const loaded = {};
const loadLib = key => loaded[key] ||= new Promise((res, rej) => {
  const s = document.createElement('script'); s.src = LIBS[key]; s.onload = res; s.onerror = () => { delete loaded[key]; rej(new Error('โหลดตัวสร้าง PDF ไม่ได้')); };
  document.head.appendChild(s);
});
export async function docPdf(b, opts) {
  await Promise.all([loadLib('html2canvas'), loadLib('jspdf')]);
  await document.fonts?.ready;
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;z-index:-1';
  host.innerHTML = `<style>${CSS}</style><div class="a4">${await docHtml(b, opts)}</div>`;
  document.body.appendChild(host);
  fitA4(host);
  try {
    // รอรูป (dataURL) โหลดเสร็จ — ไม่ใช้ img.decode() เพราะค้างได้เมื่อรูปอยู่นอกจอ
    await Promise.all([...host.querySelectorAll('img')].map(i => i.complete ? null
      : new Promise(r => { i.onload = i.onerror = r; setTimeout(r, 3000); })));
    const canvas = await window.html2canvas(host.querySelector('.a4'), { scale: 2, backgroundColor: '#ffffff', logging: false });
    const pdf = new window.jspdf.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, 210, 297);
    return pdf.output('datauristring');
  } finally { host.remove(); }
}

// เอกสารครบหน้า (ใช้ทำ PDF ที่ server — สำรองกรณีสร้าง PDF ในเครื่องไม่ได้)
export async function docPage(b, opts) {
  return `<html><head><meta charset="utf-8"><style>@page{size:A4;margin:12mm}body{margin:0}${CSS}</style></head><body>${await docHtml(b, opts)}</body></html>`;
}

export async function printDocs(list, opts = {}) {
  if (!list.length) return false;
  return printA4(await Promise.all(list.map(b => docHtml(b, typeof opts === 'function' ? opts(b) : opts))));
}

// ---------- ใบคืนเงินประกัน (ตอนย้ายออก) — รูปแบบเดียวกับใบแจ้งหนี้ ----------
// เลขที่ RF + ปี พ.ศ. 2 หลัก + เดือน + ลำดับในเดือน เช่น RF6910-1 (ตามเดือนที่ย้ายออก)
export function nextRefundNo(date, tenants) {
  const [y, m] = String(date).split('-').map(Number);
  const prefix = `RF${String((y + 543) % 100).padStart(2, '0')}${String(m).padStart(2, '0')}-`;
  const max = tenants.map(t => t.moveOutDoc?.no).filter(n => n && n.startsWith(prefix)).reduce((a, n) => Math.max(a, Number(n.slice(prefix.length)) || 0), 0);
  return prefix + (max + 1);
}
export async function refundDocHtml(t) {
  const d = t.moveOutDoc;
  if (!d) return '<div class="doc"><p>ไม่มีข้อมูลเอกสารคืนเงิน</p></div>';
  const [logo, sign] = await Promise.all([asset('logo'), asset('sign')]);
  const now = new Date(), dots = '.'.repeat(44), back = d.refund >= 0;
  const [y, m, dd] = String(d.date || '').split('-').map(Number);
  const red = s => `<span style="color:#c00">${s}</span>`;
  const rows = [];
  if (d.wu != null) rows.push(['ค่าน้ำประปา', `( ${d.wPrev} - ${d.wCur} )${d.wMin != null ? ' ขั้นต่ำ' : ''}`, d.wMin ?? d.wu, d.wRate, d.water]);
  if (d.eu != null) rows.push(['ค่าไฟฟ้า', `( ${d.ePrev} - ${d.eCur} )${d.eMin != null ? ' ขั้นต่ำ' : ''}`, d.eMin ?? d.eu, d.eRate, d.elec]);
  (d.items || []).forEach(o => rows.push([o.name || 'รายการหัก', '', null, null, o.amount]));
  const how = !back ? 'ผู้เช่าต้องชำระเพิ่มตามยอดข้างต้น'
    : d.refundMethod === 'transfer' ? `คืนเงินโดย: โอนเข้าบัญชี ${esc(d.bank || '')} เลขที่ ${esc(d.acctNo || '')}${d.acctName ? ` ชื่อบัญชี ${esc(d.acctName)}` : ''}`
    : d.refundMethod === 'cash' ? 'คืนเงินโดย: เงินสด'
    : 'คืนเงินโดย: ......................................................................';
  return `<div class="doc">
  <table class="lay"><tr>
    <td>${logo ? `<img class="logo" src="${logo}" alt="">` : `<div class="brand">${esc(M.property().nameEn || M.property().name)}</div>`}</td>
    <td style="width:250px;padding-top:12px"><div class="title">ใบคืนเงินประกัน</div><div class="no">NO. ${esc(d.no || '-')}</div></td>
  </tr></table>
  <div class="rule"></div>
  <table class="info">
    <tr><td class="k">หมายเลขห้อง :</td><td>${esc(t.room)}</td></tr>
    <tr><td class="k">ชื่อ-นามสกุล :</td><td>${esc(t.name || '')}</td></tr>
    <tr><td class="k">วันที่ย้ายออก :</td><td>${y ? `${dd}/${m}/${y + 543}` : '-'}</td></tr>
    <tr><td class="k">วันเวลาที่พิมพ์ :</td><td>${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}<span style="display:inline-block;width:80px"></span>${now.toTimeString().slice(0, 8)}</td></tr>
  </table>
  <table class="items"><thead><tr><th class="f">รายการ</th><th style="width:105px">จำนวนหน่วย</th><th style="width:110px">ราคาต่อหน่วย</th><th style="width:120px">จำนวนเงิน</th></tr></thead><tbody>
    <tr class="sp"><td class="f"></td><td></td><td></td><td></td></tr>
    <tr><td class="f"><b>เงินประกัน</b></td><td></td><td></td><td class="n"><b>${fmt2(d.deposit)}</b></td></tr>
    <tr><td class="f" style="padding-top:12px"><u>หัก</u></td><td></td><td></td><td></td></tr>
    ${rows.map(r => `<tr><td class="f"><span style="display:inline-block;min-width:160px">&nbsp;&nbsp;- ${esc(r[0])}</span>${esc(r[1])}</td><td class="c">${r[2] ?? ''}</td><td class="n">${r[3] != null ? fmt2(r[3]) : ''}</td><td class="n">${red('-' + fmt2(r[4]))}</td></tr>`).join('')}
    <tr><td class="f" style="padding-top:10px">รวมรายการหัก</td><td></td><td></td><td class="n" style="padding-top:10px">${red('-' + fmt2(d.totalDed))}</td></tr>
    <tr class="sp"><td class="f"></td><td></td><td></td><td></td></tr>
    <tr class="tot"><td class="f" style="text-align:center" colspan="2">( ${bahtText(Math.abs(d.refund))} )</td><td class="c" style="white-space:nowrap">${back ? 'คืนเงินประกัน' : 'ชำระเพิ่ม'}</td><td class="n">${back ? fmt2(d.refund) : red(fmt2(-d.refund))}</td></tr>
  </tbody></table>
  <p class="note">ผู้เช่าได้ตรวจสอบรายการและเลขมิเตอร์ข้างต้นแล้ว<br>${how}</p>
  <table class="sign">
    <tr class="img"><td class="lbl"></td><td class="dots"></td><td class="gap"></td><td class="lbl"></td><td class="dots">${sign ? `<img class="sig" src="${sign}" alt="">` : ''}</td></tr>
    <tr><td class="lbl">ผู้เช่า</td><td class="dots">${dots}</td><td class="gap"></td><td class="lbl">ผู้จัดทำ</td><td class="dots">${dots}</td></tr>
  </table>
  <div class="foot"></div>
</div>`;
}
export async function printRefundDoc(t) { return printA4([await refundDocHtml(t)]); }

// พิมพ์เอกสารชุดหนึ่ง (แต่ละหน้าเป็น HTML ของ .doc) จากกรอบแยก (core/printframe.js)
// 1 ใบ = 1 แผ่น A4 พอดี: ขอบกระดาษ 0 (ไม่มีหัว/ท้ายกระดาษของเบราว์เซอร์) แล้วจัดขอบเองในกรอบ .a4
export function a4Html(pages) {
  return `<style>${CSS}@page{size:A4;margin:0}</style>` + pages.map(h => `<div class="a4">${h}</div>`).join('');
}
function printA4(pages) {
  return printInFrame(a4Html(pages), doc => fitA4(doc));
}
