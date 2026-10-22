// ตัวช่วยหน้าจอที่ทุกโมดูลใช้ร่วมกัน
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ESC[c]);

export const fmt = n => (Number(n) || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });
export const fmt0 = n => (Number(n) || 0).toLocaleString('th-TH', { maximumFractionDigits: 0 });

const TH_MONTHS = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
const TH_MON = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
// period = 'YYYY-MM' (ค.ศ.)
export const periodLabel = (p, short = false) => { const [y, m] = p.split('-').map(Number); return `${(short ? TH_MON : TH_MONTHS)[m - 1]} ${y + 543}`; };
export const periodOf = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
export const shiftPeriod = (p, n) => { const [y, m] = p.split('-').map(Number); return periodOf(new Date(y, m - 1 + n, 1)); };
export const thDate = iso => { if (!iso) return '-'; const d = new Date(iso); return isNaN(d) ? iso : d.toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric' }); };

let toastTimer;
export function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), ms);
}

export function openModal(html, { wide = false } = {}) {
  const box = $('#modal-box'); box.className = 'modal-box' + (wide ? ' wide' : '');
  box.innerHTML = `<button type="button" class="modal-print" title="พิมพ์ป๊อปอัปนี้ (A4)">🖨️</button>` + html;
  $('#modal').classList.add('on'); return box;
}
export function closeModal() { $('#modal').classList.remove('on'); $('#modal-box').innerHTML = ''; document.dispatchEvent(new Event('modal-closed')); }
document.addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });

export function confirmBox(msg, okText = 'ยืนยัน') {
  return new Promise(res => {
    const box = openModal(`<h3>ยืนยัน</h3><p>${esc(msg)}</p><div class="form-acts"><button class="btn" data-x>ยกเลิก</button><button class="btn pri" data-ok>${esc(okText)}</button></div>`);
    box.querySelector('[data-x]').onclick = () => { closeModal(); res(false); };
    box.querySelector('[data-ok]').onclick = () => { closeModal(); res(true); };
  });
}

// ---------- จำนวนเงินเป็นตัวอักษร ----------
const TH_DIGIT = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
const TH_POS = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];
function thInt(n) {
  if (n === 0) return '';
  if (n >= 1e6) return thInt(Math.floor(n / 1e6)) + 'ล้าน' + thInt(n % 1e6);
  const s = String(n); let out = '';
  for (let i = 0; i < s.length; i++) {
    const d = +s[i], pos = s.length - i - 1; if (!d) continue;
    if (pos === 1 && d === 1) out += 'สิบ';
    else if (pos === 1 && d === 2) out += 'ยี่สิบ';
    else if (pos === 0 && d === 1 && s.length > 1) out += 'เอ็ด';
    else out += TH_DIGIT[d] + TH_POS[pos];
  }
  return out;
}
export function bahtText(amount) {
  const v = Math.round((Number(amount) || 0) * 100), baht = Math.floor(v / 100), st = v % 100;
  if (!baht && !st) return 'ศูนย์บาทถ้วน';
  return (baht ? thInt(baht) + 'บาท' : '') + (st ? thInt(st) + 'สตางค์' : 'ถ้วน');
}
const EN1 = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const EN10 = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function enInt(n) {
  if (n < 20) return EN1[n];
  if (n < 100) return EN10[Math.floor(n / 10)] + (n % 10 ? '-' + EN1[n % 10] : '');
  if (n < 1000) return EN1[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' ' + enInt(n % 100) : '');
  if (n < 1e6) return enInt(Math.floor(n / 1000)) + ' thousand' + (n % 1000 ? ' ' + enInt(n % 1000) : '');
  return enInt(Math.floor(n / 1e6)) + ' million' + (n % 1e6 ? ' ' + enInt(n % 1e6) : '');
}
export function englishAmount(amount) {
  const v = Math.round((Number(amount) || 0) * 100);
  return `${enInt(Math.floor(v / 100)) || 'zero'} baht and ${String(v % 100).padStart(2, '0')}/100`;
}

// ดาวน์โหลดตารางเป็นไฟล์ Excel (CSV UTF-8 ที่ Excel เปิดภาษาไทยได้)
export function downloadCsv(filename, rows) {
  const cell = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const blob = new Blob(['﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
}

export const uid =(p = '') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const stripTitle = name => String(name || '').replace(/^(คุณ|นาย|นางสาว|นาง|น\.ส\.)\s*/, '').trim().split(/\s+/)[0] || 'xxx';
