// หน้าจอเข้าสู่ระบบ / สร้างผู้ดูแลครั้งแรก / เปลี่ยนรหัสผ่าน
import * as auth from '../core/auth.js';
import { APP } from '../core/config.js';
import { $, esc, openModal, closeModal } from '../core/ui.js';

const wrap = inner => `<div class="auth"><div class="card"><img class="auth-logo" src="assets/brand-logo.png" alt="Meechai Apartment">${inner}</div></div>`;

export function renderLogin(root, done) {
  root.innerHTML = wrap(`
    <h1>${esc(APP.name)}</h1><p class="note">เข้าสู่ระบบด้วยอีเมลที่ผู้ดูแลระบบสร้างให้</p>
    <form class="form" id="f" autocomplete="on">
      <label for="em">อีเมล</label><input id="em" type="email" autocomplete="username" required>
      <label for="pw">รหัสผ่าน</label><input id="pw" type="password" autocomplete="current-password" required>
      <div class="err" id="err"></div>
      <button class="btn pri" type="submit">เข้าสู่ระบบ</button>
    </form>
    <p class="note">ลืมรหัสผ่าน? ติดต่อผู้ดูแลระบบ (Administrator) เพื่อตั้งรหัสใหม่</p>`);
  $('#em').focus();
  $('#f').onsubmit = async e => {
    e.preventDefault(); $('#err').textContent = '';
    const btn = $('#f button[type=submit]'); btn.disabled = true; btn.textContent = 'กำลังตรวจสอบ…';
    try { await auth.login($('#em').value, $('#pw').value); done(); }
    catch (x) { $('#err').textContent = x.message; btn.disabled = false; btn.textContent = 'เข้าสู่ระบบ'; }
  };
}

export function renderSetup(root, done) {
  root.innerHTML = wrap(`
    <h1>ตั้งค่าครั้งแรก</h1><p class="note">สร้างบัญชีผู้ดูแลระบบ (Administrator) สำหรับเครื่องนี้</p>
    <form class="form" id="f">
      <label for="nm">ชื่อ</label><input id="nm" required>
      <label for="em">อีเมล</label><input id="em" type="email" autocomplete="username" required>
      <label for="pw">รหัสผ่าน (อย่างน้อย ${APP.minPasswordLength} ตัว)</label><input id="pw" type="password" autocomplete="new-password" required>
      <label for="pw2">ยืนยันรหัสผ่าน</label><input id="pw2" type="password" autocomplete="new-password" required>
      <div class="err" id="err"></div>
      <button class="btn pri" type="submit">สร้างบัญชีและเริ่มใช้งาน</button>
    </form>`);
  $('#f').onsubmit = async e => {
    e.preventDefault();
    const pw = $('#pw').value;
    if (pw.length < APP.minPasswordLength) return $('#err').textContent = `รหัสผ่านต้องยาวอย่างน้อย ${APP.minPasswordLength} ตัวอักษร`;
    if (pw !== $('#pw2').value) return $('#err').textContent = 'รหัสผ่านทั้งสองช่องไม่ตรงกัน';
    await auth.createFirstAdmin($('#em').value, $('#nm').value.trim(), pw); done();
  };
}

// forced = ผู้ใช้ใหม่/ถูกรีเซ็ตรหัส ต้องเปลี่ยนก่อนใช้งาน
export function renderChangePassword(el, done, { forced }) {
  const inner = `
    <h1 style="font-size:20px">${forced ? 'ตั้งรหัสผ่านใหม่' : 'เปลี่ยนรหัสผ่าน'}</h1>
    ${forced ? '<p class="note">นี่เป็นการเข้าใช้ครั้งแรกด้วยรหัสชั่วคราว กรุณาตั้งรหัสผ่านของคุณเองก่อนใช้งาน</p>' : ''}
    <form class="form" id="cpf" style="grid-template-columns:1fr">
      <label for="op">รหัสผ่าน${forced ? 'ชั่วคราว' : 'เดิม'}</label><input id="op" type="password" autocomplete="current-password" required>
      <label for="np">รหัสผ่านใหม่ (อย่างน้อย ${APP.minPasswordLength} ตัว)</label><input id="np" type="password" autocomplete="new-password" required>
      <label for="np2">ยืนยันรหัสผ่านใหม่</label><input id="np2" type="password" autocomplete="new-password" required>
      <div class="err" id="cperr"></div>
      <div class="form-acts">${forced ? '<button class="btn" type="button" id="cpout">ออกจากระบบ</button>' : '<button class="btn" type="button" id="cpx">ยกเลิก</button>'}<button class="btn pri" type="submit">บันทึกรหัสผ่าน</button></div>
    </form>`;
  el.innerHTML = forced ? wrap(inner) : inner;
  $('#cpout')?.addEventListener('click', () => { auth.logout(); location.reload(); });
  $('#cpx')?.addEventListener('click', closeModal);
  $('#cpf').onsubmit = async e => {
    e.preventDefault();
    if ($('#np').value !== $('#np2').value) return $('#cperr').textContent = 'รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน';
    try { await auth.changePassword($('#op').value, $('#np').value); done(); }
    catch (x) { $('#cperr').textContent = x.message; }
  };
}

// login ซ้ำเพื่อขอ token ใหม่ หลังจากเข้าใช้แบบ offline มาก่อน
export function openReauth(done) {
  const s = auth.current();
  const box = openModal(`<h3>เข้าสู่ระบบเพื่ออัปโหลดข้อมูล</h3><p class="note">${esc(s.email)}</p>
    <form class="form" id="ra" style="grid-template-columns:1fr"><input id="rapw" type="password" placeholder="รหัสผ่าน" autocomplete="current-password" required>
    <div class="err" id="raerr"></div><div class="form-acts"><button class="btn" type="button" id="rax">ยกเลิก</button><button class="btn pri">เข้าสู่ระบบ</button></div></form>`);
  box.querySelector('#rax').onclick = closeModal;
  box.querySelector('#ra').onsubmit = async e => {
    e.preventDefault();
    try { const r = await auth.login(s.email, $('#rapw').value); if (!r.token) throw new Error('ยังออฟไลน์อยู่'); closeModal(); done(); }
    catch (x) { $('#raerr').textContent = x.message; }
  };
}
