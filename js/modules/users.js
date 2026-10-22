// จัดการผู้ใช้ (Administrator เท่านั้น): เพิ่มผู้ใช้ + รหัสชั่วคราว, เปลี่ยนระดับ, รีเซ็ตรหัส, ปิดบัญชี
import * as auth from '../core/auth.js';
import { isServerMode } from '../core/config.js';
import { esc, toast, openModal, closeModal, confirmBox, thDate } from '../core/ui.js';

function showTemp(email, temp) {
  const box = openModal(`<h3>รหัสผ่านชั่วคราว</h3>
    <p>แจ้งรหัสนี้ให้ <b>${esc(email)}</b> — ผู้ใช้จะถูกบังคับให้ตั้งรหัสใหม่เมื่อเข้าสู่ระบบครั้งแรก</p>
    <p style="font-size:24px;font-family:monospace;background:#f0f3f6;padding:12px;border-radius:8px;text-align:center;user-select:all">${esc(temp)}</p>
    <p class="note">รหัสนี้จะแสดงครั้งเดียว ถ้าลืมให้กด "รีเซ็ตรหัส" ใหม่</p>
    <div class="form-acts"><button class="btn" id="cp">คัดลอก</button><button class="btn pri" id="ok">เสร็จ</button></div>`);
  box.querySelector('#cp').onclick = () => navigator.clipboard?.writeText(temp).then(() => toast('คัดลอกแล้ว'));
  box.querySelector('#ok').onclick = closeModal;
}

function addForm(done) {
  const box = openModal(`<h3>เพิ่มผู้ใช้</h3>
    <form class="form" id="uf">
      <label class="req">อีเมล</label><input id="u-em" type="email" required>
      <label class="req">ชื่อ</label><input id="u-nm" required>
      <label class="req">ระดับ</label><select id="u-role">${Object.entries(auth.ROLES).map(([k, v]) => `<option value="${k}" ${k === 'operator' ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <div class="full note">Administrator: ทำได้ทุกอย่าง · Manager: เพิ่มผู้ใช้และเพิ่มห้องไม่ได้ · Operator: ลบข้อมูลไม่ได้ และไม่เห็นเมนูตั้งค่า</div>
      <div class="err full" id="uerr"></div></form>
    <div class="form-acts"><button class="btn" id="ux">ยกเลิก</button><button class="btn pri" id="uok">สร้างผู้ใช้</button></div>`);
  box.querySelector('#ux').onclick = closeModal;
  box.querySelector('#uok').onclick = async () => {
    try {
      const email = box.querySelector('#u-em').value, name = box.querySelector('#u-nm').value.trim();
      if (!name) throw new Error('กรุณากรอกชื่อ');
      const temp = await auth.addUser({ email, name, role: box.querySelector('#u-role').value });
      showTemp(email.trim().toLowerCase(), temp); done();
    } catch (e) { box.querySelector('#uerr').textContent = e.message; }
  };
}

export default {
  id: 'users', title: 'ผู้ใช้งาน', icon: '🔐', perm: 'users.manage',
  async render(el, nav) {
    el.innerHTML = `<div class="top"><h2>ผู้ใช้งาน</h2><button class="btn pri" id="add">+ เพิ่มผู้ใช้</button></div><div class="card" id="ul">กำลังโหลด…</div>`;
    const re = () => this.render(el, nav);
    el.querySelector('#add').onclick = () => addForm(re);
    let list;
    try { list = await auth.listUsers(); }
    catch (e) { el.querySelector('#ul').innerHTML = `<p>${esc(e.message)}</p>${isServerMode() ? '<p class="note">การจัดการผู้ใช้ต้องออนไลน์</p>' : ''}`; return; }
    const me = auth.current().email;
    el.querySelector('#ul').outerHTML = `<div class="scroll"><table class="tbl"><thead><tr><th>อีเมล</th><th>ชื่อ</th><th>ระดับ</th><th>สถานะ</th><th>เข้าใช้ล่าสุด</th><th></th></tr></thead><tbody>
      ${list.map(u => `<tr data-u="${esc(u.email)}"><td>${esc(u.email)}${u.email === me ? ' <span class="pill info">คุณ</span>' : ''}</td><td>${esc(u.name)}</td>
        <td><select class="input" data-role ${u.email === me ? 'disabled' : ''}>${Object.entries(auth.ROLES).map(([k, v]) => `<option value="${k}" ${k === u.role ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
        <td>${!u.active ? '<span class="pill idle">ปิดใช้งาน</span>' : u.mustChange ? '<span class="pill warn">รอตั้งรหัสใหม่</span>' : '<span class="pill ok">ใช้งาน</span>'}</td>
        <td>${u.lastLogin ? thDate(u.lastLogin) : '-'}</td>
        <td>${u.email === me ? '' : `<button class="btn sm" data-reset>รีเซ็ตรหัส</button> <button class="btn sm ${u.active ? 'danger' : ''}" data-toggle>${u.active ? 'ปิดบัญชี' : 'เปิดบัญชี'}</button>`}</td></tr>`).join('')}
      </tbody></table></div>`;
    el.querySelectorAll('tr[data-u]').forEach(tr => {
      const email = tr.dataset.u, u = list.find(x => x.email === email);
      tr.querySelector('[data-role]').onchange = async e => { try { await auth.updateUser(email, { role: e.target.value }); toast('เปลี่ยนระดับแล้ว'); } catch (x) { toast(x.message); re(); } };
      tr.querySelector('[data-reset]')?.addEventListener('click', async () => {
        if (!await confirmBox(`รีเซ็ตรหัสผ่านของ ${email}?`, 'รีเซ็ต')) return;
        try { showTemp(email, await auth.resetPassword(email)); re(); } catch (x) { toast(x.message); }
      });
      tr.querySelector('[data-toggle]')?.addEventListener('click', async () => {
        try { await auth.updateUser(email, { active: !u.active }); re(); } catch (x) { toast(x.message); }
      });
    });
  },
};
