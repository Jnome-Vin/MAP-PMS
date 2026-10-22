// วันเกิดผู้เช่า: เตือนเมื่อเปิดโปรแกรม (วันละครั้ง) รายชื่อคนที่เกิดเดือนนี้ + ระยะเวลาเช่า
// ติ๊ก "ไม่ต้องเตือนอีก 7 วัน" เพื่อเลื่อนการเตือน (จำแยกตามผู้ใช้และเครื่อง)
// เฟสถัดไป: ส่งการ์ดอวยพรวันเกิดผ่าน LINE OA โดยใช้ข้อมูลชุดเดียวกันนี้
import * as db from '../core/db.js';
import * as M from '../core/model.js';
import * as auth from '../core/auth.js';
import { esc, openModal, closeModal } from '../core/ui.js';

const TH_MONTH = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const today = () => new Date().toISOString().slice(0, 10);

// ผู้เช่าปัจจุบันที่เกิดเดือนนี้ เรียงตามวันที่
export function birthdaysThisMonth(d = new Date()) {
  const m = d.getMonth() + 1, day = d.getDate();
  return db.all('tenants').filter(t => t.active && t.birthDate && +t.birthDate.slice(5, 7) === m)
    .map(t => { const bd = +t.birthDate.slice(8, 10);
      return { t, day: bd, age: d.getFullYear() - +t.birthDate.slice(0, 4), daysLeft: bd - day, stay: M.stayText(t.since) }; })
    .sort((a, b) => a.day - b.day);
}
export const missingBirthdays = () => db.all('tenants').filter(t => t.active && !t.birthDate && !t.company).length;

const whenTxt = x => x.daysLeft === 0 ? '<span class="pill ok">🎂 วันนี้</span>' : x.daysLeft > 0 ? `<span class="pill info">อีก ${x.daysLeft} วัน</span>` : `<span class="pill idle">ผ่านมา ${-x.daysLeft} วัน</span>`;

export function birthdayTable(list) {
  return `<div class="scroll" style="max-height:50vh"><table class="tbl"><thead><tr><th>วันเกิด</th><th>ห้อง</th><th>ชื่อ</th><th class="n">อายุ</th><th>เช่ามาแล้ว</th><th>โทร</th><th></th></tr></thead><tbody>
    ${list.map(x => `<tr><td>${x.day} ${TH_MONTH[+x.t.birthDate.slice(5, 7) - 1]}</td><td><b>${x.t.room}</b></td><td>${esc(x.t.name)}</td>
      <td class="n">${x.age} ปี</td><td>${x.stay}</td><td>${esc(x.t.phone || '')}</td><td>${whenTxt(x)}</td></tr>`).join('')}</tbody></table></div>`;
}

const key = () => 'bday:' + (auth.current()?.email || '');

// เรียกหลังเข้าสู่ระบบ: แสดงป๊อปอัปถ้ามีคนเกิดเดือนนี้ วันละครั้ง และยังไม่ได้เลื่อนการเตือน
export async function checkBirthdays() {
  const list = birthdaysThisMonth(); if (!list.length) return;
  const st = (await db.meta(key())) || {};
  if (st.shownOn === today() || (st.snoozeUntil && today() < st.snoozeUntil)) return;
  if (document.querySelector('#modal.on')) return;
  const now = new Date();
  const box = openModal(`<h3>🎂 วันเกิดผู้เช่าเดือน${TH_MONTH[now.getMonth()]} ${now.getFullYear() + 543} (${list.length} คน)</h3>
    ${birthdayTable(list)}
    <p class="note">เฟสถัดไป: ส่งการ์ด Happy Birthday ให้ผู้เช่าทาง LINE OA อัตโนมัติ</p>
    <div class="form-acts" style="justify-content:space-between;align-items:center">
      <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="bd-snooze"> ไม่ต้องเตือนอีก 7 วัน</label>
      <button class="btn pri" id="bd-ok">รับทราบ</button></div>`, { wide: true });
  let saved = false;
  const close = async () => {
    if (saved) return; saved = true;
    const snooze = box.querySelector('#bd-snooze')?.checked;
    const until = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    await db.meta(key(), { shownOn: today(), snoozeUntil: snooze ? until : st.snoozeUntil || '' });
  };
  box.querySelector('#bd-ok').onclick = async () => { await close(); closeModal(); };
  document.addEventListener('modal-closed', close, { once: true });   // ปิดด้วยการคลิกนอกกรอบก็นับว่าเห็นแล้ววันนี้
}
