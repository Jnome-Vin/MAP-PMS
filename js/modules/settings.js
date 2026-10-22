// ตั้งค่า (Administrator, Manager): อัตราค่าบริการ, ข้อมูลอาคาร, เชื่อม Google, LINE OA, จัดการห้อง (Admin), สำรองข้อมูล
import * as db from '../core/db.js';
import * as M from '../core/model.js';
import * as auth from '../core/auth.js';
import * as api from '../core/api.js';
import * as sync from '../core/sync.js';
import { getApiUrl, setApiUrl, APP } from '../core/config.js';
import { esc, toast, openModal, closeModal, confirmBox } from '../core/ui.js';
import { randomString } from '../core/auth.js';

const num = (el, id) => Number(el.querySelector('#' + id).value) || 0;
const val = (el, id) => el.querySelector('#' + id).value.trim();

function roomForm(r, done) {
  const isNew = !r;
  r = r || { kind: 'room', type: 'แอร์', rent: 0 };
  const box = openModal(`<h3>${isNew ? 'เพิ่มห้อง' : 'แก้ไขห้อง ' + r.id}</h3>
    <form class="form">
      <label class="req">เลขห้อง</label><input id="r-id" value="${esc(r.id || '')}" ${isNew ? '' : 'disabled'} placeholder="เช่น 210">
      <label>ประเภทพื้นที่</label><select id="r-kind">${[['room', 'ห้องพัก'], ['kiosk', 'Kiosk / ร้านค้า'], ['office', 'สำนักงาน'], ['laundry', 'ห้องซักผ้า']].map(([k, v]) => `<option value="${k}" ${k === r.kind ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <label>ชนิดห้อง</label><select id="r-type">${['แอร์', 'พัดลม', 'Kiosk', 'ส่วนกลาง'].map(t => `<option ${t === r.type ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <label>ค่าเช่า/เดือน</label><input id="r-rent" type="number" min="0" step="100" value="${r.rent || 0}">
      <label>ค่าน้ำเฉพาะห้อง</label><input id="r-w" type="number" min="0" step="0.5" value="${r.wRate ?? ''}" placeholder="ว่าง = ใช้อัตรามาตรฐาน">
      <label>ค่าไฟเฉพาะห้อง</label><input id="r-e" type="number" min="0" step="0.5" value="${r.eRate ?? ''}" placeholder="ว่าง = ใช้อัตรามาตรฐาน">
      <label>ชื่อเรียก</label><input id="r-label" value="${esc(r.label || '')}">
      <label>ยกเว้นน้ำไฟขั้นต่ำ</label><label style="color:inherit"><input type="checkbox" id="r-nomin" ${r.noMin ? 'checked' : ''} style="width:auto"> ยกเว้น</label>
      <div class="err full" id="rerr"></div></form>
    <div class="form-acts">${!isNew ? '<button class="btn danger" id="rdel" style="margin-right:auto">ลบห้อง</button>' : ''}<button class="btn" id="rx">ยกเลิก</button><button class="btn pri" id="rok">บันทึก</button></div>`);
  box.querySelector('#rx').onclick = closeModal;
  box.querySelector('#rok').onclick = async () => {
    const id = val(box, 'r-id');
    if (!/^\d{3,4}$/.test(id)) return box.querySelector('#rerr').textContent = 'เลขห้องต้องเป็นตัวเลข 3-4 หลัก';
    if (isNew && db.get('rooms', id)) return box.querySelector('#rerr').textContent = 'มีห้องนี้อยู่แล้ว';
    const w = val(box, 'r-w'), e = val(box, 'r-e');
    await db.put('rooms', { ...r, id, floor: +id[0], kind: val(box, 'r-kind'), type: val(box, 'r-type'), rent: num(box, 'r-rent'),
      wRate: w === '' ? null : +w, eRate: e === '' ? null : +e, label: val(box, 'r-label'), noMin: box.querySelector('#r-nomin').checked });
    closeModal(); toast('บันทึกห้องแล้ว'); done();
  };
  box.querySelector('#rdel')?.addEventListener('click', async () => {
    if (M.tenantOf(r.id)) return toast('ห้องนี้มีผู้เช่าอยู่ ต้องย้ายออกก่อน');
    if (!await confirmBox(`ลบห้อง ${r.id}? (ประวัติบิลยังอยู่)`, 'ลบห้อง')) return;
    await db.remove('rooms', r.id); closeModal(); done();
  });
}

export default {
  id: 'settings', title: 'ตั้งค่า', icon: '⚙️', perm: 'settings.view',
  async render(el, nav) {
    const rt = M.rates(), p = M.property(), admin = auth.can('rooms.manage');
    const auto = await sync.autoUpload();
    const links = db.all('lineLinks');
    el.innerHTML = `
    <div class="top"><h2>ตั้งค่า</h2><span class="note">เวอร์ชัน ${APP.version}</span></div>
    <div class="grid2">
      <div class="card"><b>อัตราค่าบริการ</b>
        <form class="form" style="margin-top:12px">
          <label>ค่าน้ำ (บาท/หน่วย)</label><input id="water" type="number" step="0.5" value="${rt.water}">
          <label>ค่าไฟ (บาท/หน่วย)</label><input id="elec" type="number" step="0.5" value="${rt.elec}">
          <label>ค่าที่จอดมาตรฐาน</label><input id="pfee" type="number" step="50" value="${rt.parkingFee}">
          <label>ค่าตู้เย็นมาตรฐาน</label><input id="ffee" type="number" step="50" value="${rt.fridgeFee}">
          <label>ครบกำหนดชำระ (วันที่)</label><input id="due" type="number" min="1" max="28" value="${rt.dueDay}">
          <label>ผู้พักร่วมสูงสุด/ห้อง</label><input id="maxocc" type="number" min="0" max="10" value="${rt.maxOccupants ?? 2}">
          <label>น้ำ/ไฟ ขั้นต่ำ</label><label style="color:inherit"><input type="checkbox" id="minon" ${rt.minOn ? 'checked' : ''} style="width:auto"> ใช้ขั้นต่ำ</label>
          <label>น้ำประปา ขั้นต่ำ</label><span><input id="mwu" type="number" min="0" value="${rt.minWaterUnits ?? 1}" style="width:70px"> หน่วย × อัตราตามสัญญา</span>
          <label>ไฟฟ้า ขั้นต่ำ</label><span><input id="meu" type="number" min="0" value="${rt.minElecUnits ?? 1}" style="width:70px"> หน่วย × อัตราตามสัญญา</span>
          <p class="note full" style="margin:0">ใช้น้อยกว่าขั้นต่ำ หรือไม่ได้ใช้เลย (0 หน่วย) คิดเท่าขั้นต่ำ เช่น ขั้นต่ำ 1 หน่วย อัตราน้ำ ฿15 → คิด ฿15</p>
        </form>
        <p class="note">มีผลกับบิลที่สร้างใหม่ · ห้องที่มีอัตราเฉพาะ (เช่น Kiosk 103) หรือยกเว้นขั้นต่ำ ตั้งที่ "จัดการห้อง"</p>
        <div class="form-acts"><button class="btn pri" id="saveRates">บันทึกอัตรา</button></div></div>

      <div class="card"><b>ข้อมูลอาคาร (แสดงบนบิล)</b>
        <form class="form" style="margin-top:12px">
          <label>ชื่ออาคาร</label><input id="pname" value="${esc(p.name)}">
          <label>ชื่ออังกฤษ</label><input id="pnameen" value="${esc(p.nameEn)}">
          <label>ที่อยู่</label><input id="paddr" value="${esc(p.address)}">
          <label>โทร</label><input id="pphone" value="${esc(p.phone)}">
          <label>เลขผู้เสียภาษี</label><input id="ptax" value="${esc(p.taxId)}">
          <label>PromptPay</label><input id="ppp" value="${esc(p.promptpay)}">
          <label>หมายเหตุบิล (ไทย)</label><input id="pnote" value="${esc(p.billNote)}">
          <label>หมายเหตุบิล (อังกฤษ)</label><input id="pnoteen" value="${esc(p.billNoteEn)}">
          <label>อ่านสลิปด้วย Claude</label><label style="color:inherit"><input type="checkbox" id="pclaude" ${p.claudeSlip ? 'checked' : ''} style="width:auto"> แสดงปุ่ม "🤖 Claude อ่าน" (แม่นกว่า มีค่าใช้จ่าย · ต้องใส่ API key ในชีต) — ปกติใช้แบบฟรี</label>
          <label>QR ชำระเงินบนบิล</label><label style="color:inherit"><input type="checkbox" id="pqr" ${p.showQr !== false ? 'checked' : ''} style="width:auto"> แสดง (ไฟล์ app/assets/payment-qr.png)</label>
        </form>
        <div class="form-acts"><button class="btn pri" id="saveProp">บันทึก</button></div></div>

      <div class="card"><b>เชื่อม Google Sheets / Drive</b>
        <p class="note">วาง URL ของ Web App ที่ได้จากการ Deploy Apps Script (ดูขั้นตอนใน docs/SETUP.md)</p>
        <div class="toolbar"><input class="input" id="apiurl" style="flex:1;min-width:220px" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(getApiUrl())}" ${admin ? '' : 'disabled'}>
          ${admin ? '<button class="btn" id="testApi">ทดสอบ</button><button class="btn pri" id="saveApi">บันทึก</button>' : ''}</div>
        <label style="display:flex;gap:8px;align-items:center;margin-top:12px"><input type="checkbox" id="auto" ${auto ? 'checked' : ''}> อัปโหลดอัตโนมัติเมื่อมีสัญญาณอินเทอร์เน็ต</label>
        <p class="note">ถ้าปิด ข้อมูลจะรอในเครื่องจนกว่าจะกด "☁️ อัปโหลด" ที่แถบด้านบน</p>
        ${admin ? '<div class="form-acts"><button class="btn" id="pushAll">อัปโหลดข้อมูลทั้งหมดในเครื่องขึ้น Google Sheet</button></div>' : ''}</div>

      <div class="card"><b>LINE OA</b> <span class="pill ${links.length ? 'ok' : 'idle'}">ผูกแล้ว ${links.filter(l => l.active !== false).length} ห้อง</span>
        <p class="note">ผู้เช่าเพิ่มเพื่อน LINE OA แล้วพิมพ์ <b>เลขห้อง-รหัส</b> เช่น <code>304-482913</code> ระบบจะผูกบัญชีกับห้องและตั้งชื่อเป็น "304-ชื่อผู้เช่า" · Channel access token ตั้งใน Apps Script (Script properties) ไม่เก็บในแอป</p>
        <div class="form-acts"><button class="btn" id="codes">ดู/พิมพ์รหัสผูก LINE ของแต่ละห้อง</button></div></div>

      <div class="card"><b>จัดการห้อง</b> ${admin ? '' : '<span class="pill idle">เฉพาะ Administrator</span>'}
        <div class="chips" style="margin-top:10px">${M.rooms().map(r => `<button class="chip" data-room="${r.id}" ${admin ? '' : 'disabled'}>${r.id}</button>`).join('')}</div>
        ${admin ? '<div class="form-acts"><button class="btn pri" id="addRoom">+ เพิ่มห้อง</button></div>' : ''}</div>

      <div class="card"><b>สำรอง / นำเข้าข้อมูล</b>
        <p class="note">ไฟล์สำรองเป็น JSON (ไม่รวมรูปบัตร) · นำเข้าข้อมูลจากโปรแกรมเดิมด้วยไฟล์ import/initial-data.json</p>
        <div class="form-acts">${admin ? '<label class="btn" for="impf">นำเข้าข้อมูลจากไฟล์…</label><input id="impf" type="file" accept=".json,application/json" hidden>' : ''}
          <button class="btn" id="backup">ดาวน์โหลดไฟล์สำรอง</button></div></div>
    </div>`;
    const re = () => this.render(el, nav);
    const $e = s => el.querySelector(s);

    $e('#saveRates').onclick = async () => { await db.put('settings', { ...rt, id: 'rates', water: num(el, 'water'), elec: num(el, 'elec'), parkingFee: num(el, 'pfee'), fridgeFee: num(el, 'ffee'), dueDay: num(el, 'due') || 5, maxOccupants: num(el, 'maxocc'),
      minOn: $e('#minon').checked, minWaterUnits: num(el, 'mwu'), minElecUnits: num(el, 'meu') }); toast('บันทึกอัตราแล้ว'); };
    $e('#saveProp').onclick = async () => { await db.put('settings', { ...p, id: 'property', name: val(el, 'pname'), nameEn: val(el, 'pnameen'), address: val(el, 'paddr'), phone: val(el, 'pphone'), taxId: val(el, 'ptax'),
      promptpay: val(el, 'ppp'), billNote: val(el, 'pnote'), billNoteEn: val(el, 'pnoteen'), showQr: $e('#pqr').checked, claudeSlip: $e('#pclaude').checked }); toast('บันทึกแล้ว'); };
    $e('#auto').onchange = async e => { await sync.autoUpload(e.target.checked); toast(e.target.checked ? 'เปิดอัปโหลดอัตโนมัติ' : 'ปิดอัปโหลดอัตโนมัติ'); };
    $e('#testApi')?.addEventListener('click', async () => {
      const old = getApiUrl(); setApiUrl(val(el, 'apiurl'));
      try { const r = await api.call('ping'); toast(`เชื่อมต่อสำเร็จ: ${r.sheet || 'OK'}`); } catch (e) { toast('เชื่อมต่อไม่สำเร็จ: ' + e.message, 4000); }
      setApiUrl(old);
    });
    $e('#saveApi')?.addEventListener('click', async () => {
      const u = val(el, 'apiurl');
      if (u && !/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(u)) return toast('URL ต้องเป็น https://script.google.com/macros/s/…/exec');
      if (!await confirmBox(u ? 'เปลี่ยนการเชื่อมต่อ? ผู้ใช้ทุกคนต้องเข้าสู่ระบบใหม่ด้วยบัญชีบน Google Sheet' : 'ยกเลิกการเชื่อม Google และกลับไปโหมดเครื่องเดียว?')) return;
      setApiUrl(u); auth.logout(); location.reload();
    });
    $e('#pushAll')?.addEventListener('click', async () => {
      if (!getApiUrl()) return toast('ยังไม่ได้เชื่อม Google');
      if (!await confirmBox('อัปโหลดข้อมูลทั้งหมด (ห้อง ผู้เช่า ที่จอด บิล) ขึ้น Google Sheet?', 'อัปโหลด')) return;
      await sync.queueEverything(); sync.run(); toast('เข้าคิวอัปโหลดแล้ว');
    });
    $e('#codes').onclick = async () => {
      // สร้างรหัสผูก LINE ให้ห้องที่ยังไม่มี
      for (const r of M.rooms().filter(r => r.kind === 'room' || r.kind === 'kiosk')) if (!r.lineCode) await db.put('rooms', { ...r, lineCode: randomString(6, '0123456789') });
      const box = openModal(`<h3>รหัสผูก LINE OA</h3><p class="note">ให้ผู้เช่าส่งข้อความ <b>เลขห้อง-รหัส</b> มาที่ LINE OA</p>
        <div class="scroll" style="max-height:50vh"><table class="tbl"><thead><tr><th>ห้อง</th><th>ผู้เช่า</th><th>ข้อความที่ต้องส่ง</th><th>สถานะ</th></tr></thead><tbody>
        ${M.rooms().filter(r => r.lineCode).map(r => { const l = M.lineLinkOf(r.id); return `<tr><td>${r.id}</td><td>${esc(M.tenantOf(r.id)?.name || '-')}</td><td><code>${r.id}-${r.lineCode}</code></td><td>${l ? '✅ ' + esc(l.displayName || '') : '-'}</td></tr>`; }).join('')}
        </tbody></table></div><div class="form-acts"><button class="btn" id="cx">ปิด</button><button class="btn pri" id="cp">พิมพ์ใบแจ้งรหัส</button></div>`, { wide: true });
      box.querySelector('#cx').onclick = closeModal;
      box.querySelector('#cp').onclick = () => {
        document.querySelector('#print-area').innerHTML = M.rooms().filter(r => r.lineCode && M.tenantOf(r.id)).map(r => `<div class="bill"><h4>${esc(M.property().name)} — ห้อง ${r.id}</h4>
          <p>รับบิลค่าเช่าทาง LINE: เพิ่มเพื่อน LINE OA ของอาคาร แล้วพิมพ์ข้อความนี้</p><p style="font-size:28px;font-family:monospace"><b>${r.id}-${r.lineCode}</b></p></div>`).join('');
        setTimeout(() => window.print(), 50);
      };
    };
    el.querySelectorAll('[data-room]').forEach(b => b.onclick = () => roomForm(db.get('rooms', b.dataset.room), re));
    $e('#addRoom')?.addEventListener('click', () => roomForm(null, re));
    $e('#impf')?.addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      let data;
      try { data = JSON.parse((await f.text()).replace(/^﻿/, '')); } catch { return toast('อ่านไฟล์ไม่ได้'); }
      if (data.format !== 'map-pms') return toast('ไม่ใช่ไฟล์ข้อมูล MAP-PMS');
      const cols = db.SYNC_COLS.filter(c => Array.isArray(data[c]));
      if (!await confirmBox(`นำเข้า ${cols.map(c => `${c} ${data[c].length}`).join(', ')} รายการ? รายการที่ id ซ้ำจะถูกแทนที่`, 'นำเข้า')) return;
      for (const c of cols) await db.putMany(c, data[c]);
      await M.migrateData();
      if (getApiUrl()) { await sync.queueEverything(); sync.run(); }
      toast('นำเข้าข้อมูลแล้ว'); re();
    });
    $e('#backup').onclick = () => {
      const data = { format: 'map-pms', version: 1, ...Object.fromEntries(db.SYNC_COLS.map(c => [c, db.all(c, { withDeleted: true })])) };
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
      a.download = `map-pms-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    };
  },
};
