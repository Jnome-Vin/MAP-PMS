// ผังที่จอดรถชั้นล่าง — เชื่อมกับห้อง (คลิกช่อง → ห้อง, เลือกห้อง → ไฮไลต์ช่อง)
import * as db from '../core/db.js';
import * as M from '../core/model.js';
import { esc, toast, openModal, closeModal, confirmBox } from '../core/ui.js';

let hl = [];

// ตำแหน่งช่องจอดบนผัง (อ้างอิงแบบแปลนชั้นล่าง) [x, y, w, h]
const POS = {
  'B-7': [242, 117, 75, 38], 'B-14': [105, 160, 42, 34], 'B-13': [148, 160, 40, 34], 'B-10': [190, 160, 44, 34],
  'B-15': [105, 197, 43, 58], 'B-11': [205, 244, 32, 60], 'B-12': [205, 327, 32, 85],
  'B-8': [333, 248, 32, 58], 'B-9': [333, 326, 32, 87],
  // ช่องรถยนต์ขนาดเท่ากันทุกช่อง (58×120, CAR-1/2 วางแนวนอน) · CAR-4 กับ CAR-5 ยาวเท่ากัน · CAR-3/5/6 เริ่มที่ระดับเดียวกัน
  'CAR-4': [250, 172, 58, 120], 'CAR-5': [250, 302, 58, 120], 'CAR-6': [112, 302, 58, 120], 'CAR-3': [392, 302, 58, 120],
  'CAR-2': [460, 446, 120, 58], 'CAR-1': [605, 446, 120, 58],
};
for (let i = 1; i <= 14; i++) POS['A-' + i] = [100 + (14 - i) * 32.5, 62, 31, 44];
for (let i = 1; i <= 6; i++) POS['B-' + i] = [374, 118 + (i - 1) * 21, 82, 20];   // กว้างพอให้ "B-1 · 504" อยู่บรรทัดเดียว
for (let i = 1; i <= 3; i++) POS['C-' + i] = [28, 305 + (i - 1) * 38, 66, 34];

function slotSvg(s) {
  const p = POS[s.id]; if (!p) return '';
  const [x, y, w, h] = p, used = !!s.room;
  return `<g class="slot ${s.zone === 'CAR' ? 'car' : ''} ${used ? 'used' : 'free'} ${hl.includes(s.id) ? 'hl' : ''}" data-slot="${s.id}">
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4"/>
    ${h < 28   // ช่องเตี้ย (B-1..B-6): ช่องจอดกับเลขห้องอยู่บรรทัดเดียว
      ? `<text x="${x + w / 2}" y="${y + h / 2 + 4}" text-anchor="middle">${s.id}${used ? `<tspan class="r" dx="4">· ${s.room}</tspan>` : ''}</text>`
      : `<text x="${x + w / 2}" y="${y + h / 2 + (used ? -3 : 4)}" text-anchor="middle">${s.id}</text>
    ${used ? `<text class="r" x="${x + w / 2}" y="${y + h / 2 + 11}" text-anchor="middle">${s.room}</text>` : ''}`}</g>`;
}
// inline = เลขห้องกับชื่ออยู่บรรทัดเดียว (พื้นที่เตี้ย เช่น Kiosk 103)
const unitSvg = (id, x, y, w, h, label, fill, inline = false) =>
  `<g class="unit ${hl.includes(id) ? 'hl' : ''}" data-unit="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" rx="4"/>
   ${inline ? `<text x="${x + w / 2}" y="${y + h / 2 + 4}" text-anchor="middle" font-size="13"><tspan font-weight="600">${id}</tspan><tspan fill="#66727f" font-size="11"> · ${label}</tspan></text>`
    : `<text x="${x + w / 2}" y="${y + h / 2}" text-anchor="middle" font-size="13" font-weight="600">${id}</text>
   <text x="${x + w / 2}" y="${y + h / 2 + 16}" text-anchor="middle" font-size="${w < 60 ? 9 : 11}" fill="#66727f">${label}</text>`}</g>`;

function editSlot(s, done) {
  const rooms = M.rooms().filter(r => M.tenantOf(r.id));
  const car = s.zone === 'CAR', t = s.room && M.tenantOf(s.room);
  const box = openModal(`<h3>${car ? '🚗' : '🏍️'} ช่องจอด ${s.id}</h3>
    <p class="note" style="margin-top:-8px">${s.room ? `ปัจจุบัน: ห้อง ${s.room}${t ? ' · ' + esc(t.name) : ''}` : 'ช่องนี้ว่างอยู่'}</p>
    <form class="form" id="sf" onsubmit="return false">
      <label>ห้อง</label><select id="s-room"><option value="">— ว่าง —</option>${rooms.map(r => `<option value="${r.id}" ${r.id === s.room ? 'selected' : ''}>${r.id} · ${esc(M.tenantOf(r.id).name)}</option>`).join('')}</select>
      <label>เลขทะเบียน</label><input id="s-plate" value="${esc(s.plate)}" placeholder="เช่น 1กข-1234">
      <label>ยี่ห้อ/รุ่น/สี</label><input id="s-veh" value="${esc(s.vehicle)}" placeholder="เช่น Honda Wave สีน้ำเงิน">
    </form>
    <p class="note">ค่าที่จอดรายเดือนตั้งที่ข้อมูลผู้เช่า (แก้ไขผู้เช่า → ค่าที่จอดรถ/เดือน)</p>
    <div class="form-acts">${s.room ? '<button class="btn danger" id="sclear" style="margin-right:auto">ยกเลิกการจอด</button>' : ''}
      <button class="btn" id="sx">ปิด</button><button class="btn pri" id="sok">บันทึก</button></div>`);
  box.querySelector('#s-room').focus();
  box.querySelector('#sx').onclick = closeModal;
  box.querySelector('#sok').onclick = async () => {
    const room = box.querySelector('#s-room').value;
    await db.put('slots', { ...s, room, plate: room ? box.querySelector('#s-plate').value.trim() : '', vehicle: room ? box.querySelector('#s-veh').value.trim() : '' });
    closeModal(); toast(room ? `ช่อง ${s.id} → ห้อง ${room}` : `ช่อง ${s.id} ว่างแล้ว`); done();
  };
  box.querySelector('#sclear')?.addEventListener('click', async () => {
    if (!await confirmBox(`ยกเลิกการจอดช่อง ${s.id} ของห้อง ${s.room}?`, 'ยกเลิกการจอด')) return;
    await db.put('slots', { ...s, room: '', plate: '', vehicle: '' });
    toast(`ช่อง ${s.id} ว่างแล้ว`); done();
  });
}

export default {
  id: 'parking', title: 'ผังที่จอดรถ', icon: '🏍️',
  render(el, nav, arg) {
    if (arg?.highlight) { hl = arg.highlight; arg.highlight = null; }
    const slots = db.all('slots'), room = hl.find(h => db.get('rooms', h));
    const info = hl.length ? hl.filter(h => !db.get('rooms', h)).map(id => {
      const s = db.get('slots', id); if (!s) return '';
      const t = s.room && M.tenantOf(s.room);
      return s.room ? `<b>${id}</b> → ห้อง <a href="#" data-room="${s.room}">${s.room}</a> · ${esc(t?.name || '')}${s.plate ? ' · ทะเบียน ' + esc(s.plate) : ''}${s.vehicle ? ' · ' + esc(s.vehicle) : ''}`
        : `<b>${id}</b> ว่าง`;
    }).join('<br>') : 'คลิกช่องจอดเพื่อดูว่าเป็นของห้องไหน หรือเลือกห้องเพื่อไฮไลต์ช่องจอดของห้องนั้น';
    const editable = hl.filter(h => db.get('slots', h));
    el.innerHTML = `
    <div class="top"><h2>ผังที่จอดรถ · ชั้น 1</h2>
      <select class="input" id="pick"><option value="">ไฮไลต์ที่จอดของห้อง…</option>${M.rooms().filter(r => M.tenantOf(r.id)).map(r => `<option ${r.id === room ? 'selected' : ''}>${r.id}</option>`).join('')}</select></div>
    <div class="legend"><span><i style="background:#dbeafa;border:1px solid #7f8c99"></i>มอไซค์ (มีเจ้าของ)</span><span><i style="background:#d9efe2;border:1px solid #7f8c99"></i>ที่จอดรถยนต์ (CAR)</span><span><i style="background:#fff;border:1px dashed #7f8c99"></i>ช่องมอไซค์ว่าง</span><span><i style="background:var(--hl)"></i>ที่เลือก</span></div>
    <div class="card" style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center">
      <div style="line-height:1.8;font-size:14px">${info}</div>
      ${editable.length === 1 ? `<button class="btn pri" id="edit">กำหนดห้อง / ทะเบียนรถ</button>` : ''}</div></div>
    <div class="card" style="padding:8px">
    <svg class="park" viewBox="0 0 820 520" role="img" aria-label="ผังที่จอดรถชั้นล่าง">
      <defs><pattern id="st" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M0 4H8" stroke="#c9d2da"/></pattern>
        <pattern id="hatch" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="10" height="10" fill="#eef2f5"/><path d="M0 0V10" stroke="#c3ccd5" stroke-width="2"/></pattern></defs>
      <path d="M20 30 H555 V20 H800 L760 440 H20 Z" fill="none" stroke="#9aa7b4" stroke-width="1.5"/>
      <text x="330" y="52" text-anchor="middle" font-size="12" fill="#66727f">โซน A — หน้าตึก (มอไซค์คันเล็ก)</text>
      <rect x="100" y="110" width="640" height="320" fill="none" stroke="#1d2733" stroke-width="2"/>
      <text x="60" y="296" text-anchor="middle" font-size="11" fill="#66727f">โซน C</text>
      <text x="200" y="440" text-anchor="middle" font-size="11" fill="#66727f">โซน B — ใต้ตึก</text>
      <rect x="459" y="118" width="22" height="120" fill="#f3f5f8" stroke="#9aa7b4"/><text x="470" y="180" text-anchor="middle" dominant-baseline="middle" font-size="11" fill="#66727f" transform="rotate(90 470 180)">Office</text>
      <rect x="484" y="118" width="66" height="120" fill="url(#st)" stroke="#9aa7b4"/><text x="517" y="182" text-anchor="middle" font-size="11" fill="#66727f">บันได</text>
      <text x="580" y="180" text-anchor="middle" font-size="11" fill="#66727f" transform="rotate(90 580 180)">ทางขึ้นอาคาร</text>
      <g class="unit ${hl.includes('101') ? 'hl' : ''}" data-unit="101">
        <path d="M614 110 H740 V426 H484 V244 H614 Z" fill="url(#hatch)" stroke-linejoin="round"/>
        <text x="612" y="335" text-anchor="middle" font-size="13" font-weight="600">101</text>
        <text x="612" y="351" text-anchor="middle" font-size="11" fill="#66727f">สำนักงาน</text></g>
      ${unitSvg('103', 742, 240, 32, 58, 'Kiosk', '#fdf1dc')}
      ${unitSvg('102', 614, 74, 160, 32, 'ห้องซักผ้า', '#e5f0f8', true)}
      ${slots.map(slotSvg).join('')}
    </svg></div>`;
    const re = () => this.render(el, nav);
    el.querySelector('#pick').onchange = e => { const r = e.target.value; hl = r ? [r, ...M.slotsOf(r).map(s => s.id)] : []; re(); };
    // คลิกช่องจอด → ไฮไลต์ + เปิดป๊อปอัปกำหนดห้อง/ทะเบียน/ยกเลิกการจอด
    el.querySelectorAll('[data-slot]').forEach(g => g.onclick = () => { const id = g.dataset.slot; hl = [id]; re(); editSlot(db.get('slots', id), re); });
    el.querySelectorAll('[data-unit]').forEach(g => g.onclick = () => nav.go('floorplan', { room: g.dataset.unit }));
    el.querySelectorAll('a[data-room]').forEach(a => a.onclick = e => { e.preventDefault(); nav.go('floorplan', { room: a.dataset.room }); });
    el.querySelector('#edit')?.addEventListener('click', () => editSlot(db.get('slots', editable[0]), re));
  },
};
