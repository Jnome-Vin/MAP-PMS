// เอกสารบิล: ใบแจ้งหนี้ / ใบเสร็จรับเงิน (ไทย/อังกฤษ) หน้าตาตามโปรแกรมเดิม (Invoi-L.rpt)
// ใช้ทั้งพิมพ์ในเครื่อง และส่งให้ server ทำ PDF ส่ง LINE
import * as M from './model.js';
import { esc, fmt, bahtText, englishAmount, thDate, $ } from './ui.js';

const ASSETS = { logo: 'assets/logo.png', qr: 'assets/payment-qr.png' };
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

const CSS = `
.doc{font-family:"IBM Plex Sans Thai","Sarabun",sans-serif;color:#111;max-width:720px;margin:0 auto;font-size:13px}
.doc .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1b2a6b;padding-bottom:8px}
.doc .logo{width:110px}.doc .brand{font-weight:700;color:#1b2a6b}
.doc .title{border:1.5px solid #111;border-radius:14px;padding:8px 40px;font-size:18px;font-weight:700;color:#c00;text-align:center}
.doc .no{text-align:center;font-weight:700;margin-top:14px}
.doc .info{display:grid;grid-template-columns:110px 1fr;gap:6px 10px;margin:12px 0 10px 12px}
.doc .info b{font-weight:600;border:1px solid #9ab;background:#eef4fb;padding:1px 8px;width:140px;display:inline-block}
.doc table{width:100%;border-collapse:collapse;border:1.5px solid #111;border-radius:6px}
.doc th{font-weight:700;border-bottom:1px solid #111;border-left:1px solid #111;padding:8px;text-align:center}
.doc td{border-left:1px solid #111;padding:4px 10px;vertical-align:top}
.doc td.n{text-align:right;white-space:nowrap}.doc td.c{text-align:center}
.doc tr.sp td{height:14px}.doc tr.tot td{border-top:1px solid #111;font-weight:700;padding:6px 10px}
.doc .note{margin:18px 0 8px}.doc .sign{display:flex;justify-content:space-around;margin:26px 0 10px}
.doc .qr{text-align:center;margin-top:8px}.doc .qr img{width:300px}
.doc .stamp{color:#2e8b57;font-weight:700;font-size:15px}
`;
export const docCss = () => CSS;

// type: 'invoice' | 'receipt'
export async function docHtml(b, { type = 'invoice', lang = M.langOf(b), payment = null } = {}) {
  const t = T[lang] || T.th, p = M.property(), c = M.calcBill(b), lines = M.billLines(b, lang);
  const [logo, qr] = await Promise.all([asset('logo'), asset('qr')]);
  const now = new Date(), printed = `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}  ${now.toTimeString().slice(0, 8)}`;
  const amount = type === 'receipt' && payment ? payment.amount : c.total;
  const no = type === 'receipt' ? (payment?.receiptNo || b.receiptNo || '-') : (b.invoiceNo || '-');
  return `<div class="doc">
  <div class="head"><div>${logo ? `<img class="logo" src="${logo}" alt="">` : `<div class="brand">${esc(p.nameEn || p.name)}</div>`}
      <div style="font-size:11px">${esc(p.address || '')}${p.phone ? ' โทร ' + esc(p.phone) : ''}${p.taxId ? '<br>เลขประจำตัวผู้เสียภาษี ' + esc(p.taxId) : ''}</div></div>
    <div><div class="title">${type === 'receipt' ? t.receipt : t.invoice}</div><div class="no">NO. ${esc(no)}</div></div></div>
  <div class="info"><span>${t.room} :</span><span><b>${esc(b.room)}</b></span>
    <span>${t.name} :</span><span>${esc(b.tenantName || '')}</span>
    <span>${t.date} :</span><span>${printed}</span></div>
  <table><thead><tr><th style="border-left:0">${t.item}</th><th style="width:90px">${t.qty}</th><th style="width:90px">${t.price}</th><th style="width:100px">${t.amount}</th></tr></thead><tbody>
    <tr class="sp"><td style="border-left:0"></td><td></td><td></td><td></td></tr>
    ${lines.map(l => `<tr><td style="border-left:0">${esc(l.label)} <span style="margin-left:14px">${esc(l.sub || '')}</span></td><td class="c">${l.qty ?? ''}</td><td class="c">${l.price != null ? fmt2(l.price) : ''}</td><td class="n">${fmt2(l.amount)}</td></tr>`).join('')}
    <tr class="sp"><td style="border-left:0"></td><td></td><td></td><td></td></tr>
    ${type === 'receipt' && c.paid !== c.total ? `<tr class="tot"><td style="border-left:0;text-align:center" colspan="2"></td><td class="c">${t.total}</td><td class="n">${fmt2(c.total)}</td></tr>` : ''}
    <tr class="tot"><td style="border-left:0;text-align:center" colspan="2">( ${lang === 'en' ? englishAmount(amount) : bahtText(amount)} )</td><td class="c">${type === 'receipt' ? t.paid : t.total}</td><td class="n">${fmt2(amount)}</td></tr>
  </tbody></table>
  ${type === 'receipt' ? `<p class="stamp">✔ ${t.paid} ${thDate(payment?.date || b.paidAt)}${c.balance > 0 ? ` · ${t.balance} ${fmt2(c.balance)}` : ''}</p>`
    : `<p class="note">${esc(lang === 'en' ? (p.billNoteEn || p.billNote || '') : (p.billNote || ''))}</p>`}
  <div class="sign"><span>${t.tenant}.......................................</span><span>${type === 'receipt' ? t.receiver : t.preparer}.......................................</span></div>
  ${type === 'invoice' && qr && p.showQr !== false ? `<div class="qr"><img src="${qr}" alt="QR ชำระเงิน"></div>` : ''}
</div>`;
}
const fmt2 = n => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// เอกสารครบหน้า (ใช้ทำ PDF ที่ server)
export async function docPage(b, opts) {
  return `<html><head><meta charset="utf-8"><style>body{margin:24px}${CSS}</style></head><body>${await docHtml(b, opts)}</body></html>`;
}

export async function printDocs(list, opts = {}) {
  if (!list.length) return false;
  const pages = await Promise.all(list.map(b => docHtml(b, typeof opts === 'function' ? opts(b) : opts)));
  $('#print-area').innerHTML = `<style>${CSS}</style>` + pages.map(h => `<div class="page">${h}</div>`).join('');
  setTimeout(() => window.print(), 80);
  return true;
}
