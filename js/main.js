// จุดเริ่มต้นของแอป: โหลดฐานข้อมูล → เข้าสู่ระบบ → แสดงเมนูตามสิทธิ์
// เพิ่มโมดูลใหม่: สร้างไฟล์ใน js/modules/ แล้วเพิ่มใน MODULES ด้านล่าง
import { APP } from './core/config.js';
import * as db from './core/db.js';
import * as auth from './core/auth.js';
import * as sync from './core/sync.js';
import { $, esc, toast, openModal, closeModal } from './core/ui.js';
import * as seed from './data/seed.js';
import { renderLogin, renderSetup, renderChangePassword, openReauth } from './modules/login.js';

import dashboard from './modules/dashboard.js';
import floorplan from './modules/floorplan.js';
import parking from './modules/parking.js';
import billing from './modules/billing.js';
import tenants from './modules/tenants.js';
import reports from './modules/reports.js';
import users from './modules/users.js';
import settings from './modules/settings.js';
import { preloadAssets } from './core/docs.js';
import { migrateData } from './core/model.js';
import { checkBirthdays } from './modules/birthdays.js';
import { printScreen } from './core/print.js';

const MODULES = [dashboard, floorplan, parking, billing, tenants, reports, users, settings];
let currentId = 'dashboard', currentArg = null;

export const nav = {
  go(id, arg = null) { currentId = id; currentArg = arg; renderShell(); },
  refresh() { renderView(); },
};

async function boot() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    // เวอร์ชันใหม่ติดตั้งเสร็จ → โหลดหน้าใหม่ครั้งเดียวให้ใช้ไฟล์ใหม่ทันที
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => r.update()).catch(() => {});
  }
  await db.open();
  if (db.isEmpty() && !(await db.meta('seeded'))) await loadSeed();
  await migrateData();
  await sync.init();
  preloadAssets();
  auth.restore();
  route();
  db.onChange(col => {   // ข้อมูลจากเครื่องอื่นเข้ามา → วาดหน้าใหม่ถ้าผู้ใช้ไม่ได้กำลังพิมพ์
    if (col === 'outbox' || !auth.current()) return;
    const a = document.activeElement;
    if (!$('#modal').classList.contains('on') && !(a && /INPUT|SELECT|TEXTAREA/.test(a.tagName))) scheduleRender();
  });
}

// โมดูลอื่นขอเปลี่ยนหน้าได้โดยไม่ต้องรู้จัก nav โดยตรง
document.addEventListener('app-nav', e => nav.go(e.detail.id, e.detail.arg || null));
// ปุ่ม 🖨️ มุมขวาบนของทุกป๊อปอัป
document.addEventListener('click', e => { if (e.target.closest('.modal-print')) printScreen(); });

let rt; const scheduleRender = () => { clearTimeout(rt); rt = setTimeout(renderView, 300); };

async function loadSeed() {
  await db.putMany('rooms', seed.rooms.map(stamp));
  await db.putMany('slots', seed.slots.map(stamp));
  await db.putMany('settings', seed.settings.map(stamp));
  await db.meta('seeded', true);
}
// วันที่เก่าเพื่อให้ข้อมูลจาก server/ไฟล์นำเข้าทับได้เสมอ
function stamp(o) { return { ...o, updatedAt: '2000-01-01T00:00:00.000Z', updatedBy: 'seed' }; }

function route() {
  const root = $('#root');
  if (auth.needsSetup()) return renderSetup(root, route);
  const s = auth.current();
  if (!s) return renderLogin(root, route);
  if (s.mustChange) return renderChangePassword(root, route, { forced: true });
  renderShell();
}

// เมนูซ้ายแบบซ่อนอัตโนมัติ: เหลือแถบไอคอน เลื่อนเมาส์มาแล้วขยาย (จำค่าไว้ในเครื่องนี้)
function autoHide(v) {
  try {
    if (v === undefined) return localStorage.getItem('mappms.autohide') === '1';
    localStorage.setItem('mappms.autohide', v ? '1' : '0');
  } catch { return false; }
}

const visible = () => MODULES.filter(m => !m.perm || auth.can(m.perm));

function renderShell() {
  const s = auth.current(); if (!s) return route();
  if (!visible().some(m => m.id === currentId)) currentId = 'dashboard';
  $('#root').innerHTML = `
  <div class="app ${autoHide() ? 'autohide' : ''}">
    <nav class="side">
      <div class="side-logo"><img src="assets/brand-logo.png" alt="Meechai Apartment"></div>
      <div class="brand"><h1>${esc(APP.name)}</h1><div class="sub">ระบบบริหารห้องพัก (PMS) · v${APP.version}</div></div>
      <div class="items">${visible().map(m => `<button data-m="${m.id}" class="${m.id === currentId ? 'on' : ''}" title="${esc(m.title)}"><i>${m.icon}</i><span>${esc(m.title)}</span></button>`).join('')}</div>
      <div class="me"><div class="who"><b>${esc(s.name || s.email)}</b><br>${auth.ROLES[s.role]}</div>
        <button data-pw title="เปลี่ยนรหัสผ่าน"><i>🔑</i><span>เปลี่ยนรหัสผ่าน</span></button><button data-out title="ออกจากระบบ"><i>⏻</i><span>ออกจากระบบ</span></button>
        <label class="ah" title="ซ่อนเมนูเหลือแค่ไอคอน เลื่อนเมาส์มาที่เมนูเพื่อขยาย"><input type="checkbox" data-autohide ${autoHide() ? 'checked' : ''}><span>ซ่อนเมนูอัตโนมัติ</span></label></div>
    </nav>
    <main>
      <div class="statusbar" id="statusbar"></div>
      <section id="view"></section>
    </main>
  </div>`;
  $('#root').querySelectorAll('[data-m]').forEach(b => b.onclick = () => nav.go(b.dataset.m));
  $('[data-out]').onclick = () => { auth.logout(); route(); };
  $('[data-autohide]').onchange = e => { autoHide(e.target.checked); $('.app').classList.toggle('autohide', e.target.checked); };
  $('[data-pw]').onclick = () => {
    const box = openModal('<div id="pwbox"></div>');
    renderChangePassword(box.querySelector('#pwbox'), () => { closeModal(); toast('เปลี่ยนรหัสผ่านแล้ว'); }, { forced: false });
  };
  if (unsubStatus) unsubStatus();
  unsubStatus = sync.onStatus(renderStatus);
  renderView();
  setTimeout(() => checkBirthdays().catch(console.error), 600);   // เตือนวันเกิดผู้เช่าเดือนนี้ (วันละครั้ง)
}
let unsubStatus = null;

function renderView() {
  const el = $('#view'); if (!el) return;
  const m = MODULES.find(x => x.id === currentId);
  try { m.render(el, nav, currentArg); } catch (e) { console.error(e); el.innerHTML = `<div class="card">เกิดข้อผิดพลาด: ${esc(e.message)}</div>`; }
}

function renderStatus(st) {
  const el = $('#statusbar'); if (!el) return;
  const s = auth.current();
  const mode = st.server ? '' : '<span class="pill idle" title="ข้อมูลอยู่ในเครื่องนี้เท่านั้น ตั้งค่า Google ได้ที่เมนูตั้งค่า">โหมดเครื่องเดียว (ยังไม่เชื่อม Google)</span>';
  const net = `<span class="net ${st.online ? '' : 'off'}"><i></i>${st.online ? 'ออนไลน์' : 'ออฟไลน์'}</span>`;
  const pend = st.pending ? `<span class="pill warn">รออัปโหลด ${st.pending} รายการ</span>` : (st.server ? '<span class="pill ok">ข้อมูลตรงกับ server</span>' : '');
  const btn = st.server ? (st.needAuth || (s && !s.token)
      ? `<button class="btn sm" data-reauth>เข้าสู่ระบบเพื่ออัปโหลด</button>`
      : `<button class="btn sm" data-sync ${st.syncing || !st.online ? 'disabled' : ''}>${st.syncing ? 'กำลังอัปโหลด…' : '☁️ อัปโหลด/ดึงข้อมูล'}</button>`) : '';
  const err = st.error ? `<span class="pill bad" title="${esc(st.error)}">ซิงก์ไม่สำเร็จ</span>` : '';
  el.innerHTML = `${mode}${err}${pend}${net}${btn}<button class="btn sm" data-print title="พิมพ์หน้านี้ (กระดาษ A4)">🖨️ พิมพ์หน้านี้</button>`;
  el.querySelector('[data-print]').onclick = () => printScreen();
  el.querySelector('[data-sync]')?.addEventListener('click', () => sync.run());
  el.querySelector('[data-reauth]')?.addEventListener('click', () => openReauth(() => { sync.tokenReady(); sync.run(); renderShell(); }));
}

boot().catch(e => { console.error(e); $('#root').innerHTML = `<div class="boot">เปิดแอปไม่สำเร็จ: ${esc(e.message)}</div>`; });
