// พิมพ์หน้าจอปัจจุบัน (หรือป๊อปอัปที่เปิดอยู่) ลงกระดาษ A4 — มีหัวกระดาษ ซ่อนปุ่ม/เมนู และย่อให้พอดีความกว้างกระดาษ
// ใช้ได้ทั้งปุ่ม 🖨️ และ Ctrl+P / เมนูพิมพ์ของเบราว์เซอร์ (beforeprint)
import { APP } from './config.js';
import * as M from './model.js';
import * as auth from './auth.js';
import { printInFrame } from './printframe.js';

const LANDSCAPE = new Set(['floorplan', 'parking']);   // ผังกว้าง → พิมพ์แนวนอน
const PX_PER_MM = 96 / 25.4, MARGIN_MM = 10;
const area = () => document.getElementById('print-area');
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// เอกสารที่โมดูลเตรียมเอง (บิล ใบเสร็จ รายงาน) จะใส่ #print-area ก่อนสั่งพิมพ์ — จำเวลาไว้เพื่อไม่ให้ beforeprint ทับ
let preparedAt = 0;
new MutationObserver(() => { preparedAt = Date.now(); }).observe(area(), { childList: true });

// ปุ่ม 🖨️: เตรียมหน้าใน #print-area (วัดขนาด/ย่อ) แล้วพิมพ์จากกรอบแยก
export function printScreen(opts = {}) {
  build(opts);
  return printInFrame(area().innerHTML);
}

// Ctrl+P / เมนูพิมพ์ของเบราว์เซอร์ พิมพ์จากหน้าแอปโดยตรง: ซ่อนองค์ประกอบอื่นทั้งหมดแบบ inline !important
// (ชนะสไตล์ที่ส่วนเสริมเบราว์เซอร์บังคับไว้) แล้วคืนค่าหลังพิมพ์
let hidden = [];
window.addEventListener('beforeprint', () => {
  if (Date.now() - preparedAt > 1500) build();
  const others = [...document.documentElement.children].filter(e => e.tagName !== 'HEAD' && e.tagName !== 'BODY')
    .concat([...document.body.children].filter(e => e.id !== 'print-area' && e.tagName !== 'SCRIPT'));
  hidden = others.map(e => [e, e.getAttribute('style')]);
  others.forEach(e => e.style.setProperty('display', 'none', 'important'));
});
window.addEventListener('afterprint', () => {
  hidden.forEach(([e, s]) => s == null ? e.removeAttribute('style') : e.setAttribute('style', s));
  hidden = [];
});

function build({ landscape } = {}) {
  const modalOn = document.getElementById('modal').classList.contains('on');
  const src = modalOn ? document.getElementById('modal-box') : document.getElementById('view');
  if (!src) return;
  const mod = document.querySelector('nav.side button.on')?.dataset.m;
  // ตารางคอลัมน์เยอะ (เช่น รายชื่อผู้เช่า) → แนวนอนอัตโนมัติ
  const wideTable = [...src.querySelectorAll('table')].some(t => t.offsetParent && (t.rows[0]?.cells.length || 0) >= 9);
  const land = landscape ?? (!modalOn && (LANDSCAPE.has(mod) || wideTable));

  const clone = src.cloneNode(true);
  // ค่าในช่องกรอก (พิมพ์ค่าที่กรอกอยู่ ไม่ใช่ช่องว่าง)
  const live = [...src.querySelectorAll('input,select,textarea')], copy = [...clone.querySelectorAll('input,select,textarea')];
  copy.forEach((el, i) => {
    const v = live[i];
    // ช่องว่างนอกฟอร์ม (ช่องค้นหา ตัวเลือกไฮไลต์) ไม่ต้องพิมพ์ · ในฟอร์มพิมพ์เป็นเส้นว่างไว้เขียนมือ
    if (el.type === 'file' || el.type === 'hidden' || (!v.value && !el.closest('form, .form'))) return el.remove();
    const span = document.createElement('span');
    span.className = 'pv';
    span.textContent = el.type === 'checkbox' || el.type === 'radio' ? (v.checked ? '☑' : '☐')
      : el.tagName === 'SELECT' ? (v.selectedOptions[0]?.textContent || '') : v.value;
    el.replaceWith(span);
  });
  // ปุ่มเลือกแบบกลุ่ม (ชั้น / ตัวกรอง / ช่องทางชำระ) → แสดงเฉพาะตัวที่เลือก
  clone.querySelectorAll('.seg').forEach(s => {
    const on = s.querySelector('.on');
    on ? s.replaceWith(Object.assign(document.createElement('span'), { className: 'pill info', textContent: on.textContent.trim() })) : s.remove();
  });
  clone.querySelectorAll('.btn, .form-acts, .modal-print, .no-print, label.btn, video, canvas').forEach(e => e.remove());
  clone.querySelectorAll('[id]').forEach(e => e.removeAttribute('id'));
  clone.querySelectorAll('details').forEach(d => d.setAttribute('open', ''));
  clone.querySelectorAll('td').forEach(td => { if (td.textContent.trim().length > 28) td.classList.add('wrap'); });   // ข้อความยาวให้ขึ้นบรรทัดใหม่

  const title = (modalOn ? src.querySelector('h3') : src.querySelector('.top h2'))?.textContent.trim() || '';
  const u = auth.current(), now = new Date();
  const when = now.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }) + ' ' + now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  area().innerHTML = `<style>@page{size:A4 ${land ? 'landscape' : 'portrait'};margin:${MARGIN_MM}mm}</style>
    <div class="page sp${land ? ' land' : ''}">
      <header class="ph"><div><b>${esc(M.property()?.name || APP.name)}</b><span>${esc(title)}</span></div>
        <div class="note">พิมพ์ ${esc(when)}${u ? ' · ' + esc(u.name || u.email) : ''}</div></header>
      <div class="pb"></div></div>`;
  const pb = area().querySelector('.pb');
  pb.append(...clone.childNodes);
  if (modalOn) pb.querySelector('h3')?.remove();          // ชื่อป๊อปอัปอยู่ในหัวกระดาษแล้ว
  else pb.querySelector('.top h2')?.remove();

  // ย่อให้พอดีความกว้างกระดาษ A4 (วัดนอกจอ) — ผังแนวนอนย่อให้จบในหน้าเดียวด้วย
  const W = Math.floor(((land ? 297 : 210) - 2 * MARGIN_MM) * PX_PER_MM);
  const H = Math.floor(((land ? 210 : 297) - 2 * MARGIN_MM - 6) * PX_PER_MM);
  const a = area();
  a.style.cssText = `display:block;position:absolute;left:-99999px;top:0;width:${W}px`;
  const needW = pb.scrollWidth, headH = a.querySelector('.ph').offsetHeight + 12, needH = pb.scrollHeight;
  a.style.cssText = '';
  const onePage = !modalOn && LANDSCAPE.has(mod) && landscape == null;   // ผังห้อง/ผังที่จอด → หน้าเดียว
  const z = Math.min(1, W / needW, onePage ? (H - headH) / needH : 1);
  pb.style.zoom = z < 1 ? z.toFixed(3) : '';
}
