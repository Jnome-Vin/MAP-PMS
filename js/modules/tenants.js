// ผู้เช่า: เพิ่ม/แก้ไข (บังคับแนบรูปบัตรประชาชน — เลือกไฟล์หรือถ่ายจากกล้อง), ย้ายออก, ลบ
import * as db from '../core/db.js';
import * as M from '../core/model.js';
import * as auth from '../core/auth.js';
import * as api from '../core/api.js';
import { isServerMode } from '../core/config.js';
import { $, esc, fmt0, thDate, toast, openModal, closeModal, confirmBox, uid, periodLabel } from '../core/ui.js';
import { readIdDocument, occ, occName } from '../core/idcard.js';
import { printRefundDoc, nextRefundNo } from '../core/docs.js';

let q = '', filter = 'active';

// ---------- รูปบัตร ----------
export async function compress(src, max = 1600) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.82);
}
export const fileToDataUrl = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });

export async function photoThumb(id) {
  let p = await db.getPhoto(id);
  if (!p && isServerMode() && navigator.onLine) {
    try { const r = await api.call('getPhoto', { id }); p = { id, dataUrl: r.dataUrl, driveId: r.fileId, name: r.name }; await db.putPhoto(p); } catch {}
  }
  return p ? `<a href="#" data-view-photo><img class="thumb" src="${p.dataUrl}" alt="บัตรประชาชน"></a>` : '<span class="note">มีรูปบน Google Drive (เปิดได้เมื่อออนไลน์)</span>';
}

// ---------- ฟอร์มผู้เช่า ----------
export function openTenantForm(t, done) {
  const isNew = !t?.id;
  t = { fridge: 0, parkingFee: 0, deposit: 0, rentAdvance: 0, occupants: [], lang: 'th', since: new Date().toISOString().slice(0, 10), ...t };
  const roomRent = id => Number(db.get('rooms', id)?.rent) || 0;
  // อัตราน้ำ/ไฟตามสัญญา: ถ้ายังไม่เคยกำหนด ใส่ค่าดีฟอล์ต (อัตราเฉพาะห้อง หรืออัตรามาตรฐานในตั้งค่า)
  const roomDefault = id => M.roomRates(db.get('rooms', id), null);
  const defRates = x => M.roomRates(db.get('rooms', x.room) || {}, x);
  const vacant = M.rooms().filter(r => !M.tenantOf(r.id) || r.id === t.room);   // ทุกห้องรวมชั้น 1 (101 สำนักงาน / 102 ซักผ้า / 103 Kiosk) ให้เช่าได้
  let photo = null;   // dataURL ใหม่ที่ยังไม่บันทึก
  let stream = null;
  const box = openModal(`
    <h3>${isNew ? 'ผู้เช่าเข้าใหม่' : 'แก้ไขข้อมูลผู้เช่า'}</h3>
    <form class="form" id="tf">
      <label class="req">ห้อง</label><select id="t-room" required>${vacant.map(r => `<option ${r.id === t.room ? 'selected' : ''}>${r.id}</option>`).join('')}</select>
      <label class="req">ชื่อ-นามสกุล / บริษัท</label><input id="t-name" value="${esc(t.name)}" required>
      <label>เบอร์โทร</label><input id="t-phone" type="tel" value="${esc(t.phone)}">
      <label>ที่อยู่</label><textarea id="t-addr" rows="2">${esc(t.address)}</textarea>
      <label>บัตรประชาชน / Passport</label><input id="t-idno" value="${esc(t.idNo)}">
      <label>วันเดือนปีเกิด</label><input id="t-birth" type="date" value="${esc(t.birthDate || '')}" max="${new Date().toISOString().slice(0, 10)}">
      <label class="full" style="display:flex;justify-content:space-between;align-items:center;margin-top:6px"><span>ผู้พักร่วม (บัตรประชาชน / Passport) <span class="note">ไม่เกิน ${Number(M.rates().maxOccupants ?? 2)} คน</span></span><button class="btn sm" type="button" id="t-occadd">＋ เพิ่มผู้พัก</button></label>
      <div class="full" id="t-occs"></div>
      <label>วันที่เข้าพัก</label><input id="t-since" type="date" value="${esc(t.since)}">
      <label>ค่าเช่า/เดือน</label><input id="t-rent" type="number" min="0" step="100" value="${t.rent ?? roomRent(t.room)}">
      <div class="full rate-box"><b>💧⚡ อัตราค่าน้ำ-ค่าไฟ ของห้อง/สัญญานี้</b>
        <div class="rate-row"><label for="t-wrate">💧 ค่าน้ำประปา</label><input id="t-wrate" type="number" min="0" step="0.5" value="${defRates(t).water}"><span>บาท/หน่วย</span><span class="note" id="t-wdef"></span></div>
        <div class="rate-row"><label for="t-erate">⚡ ค่าไฟฟ้า</label><input id="t-erate" type="number" min="0" step="0.5" value="${defRates(t).elec}"><span>บาท/หน่วย</span><span class="note" id="t-edef"></span></div>
        <div class="note">ไม่ได้ใช้เลยหรือใช้น้อยกว่าขั้นต่ำ คิดขั้นต่ำ ${M.minUnits('w')} หน่วย × อัตรานี้</div></div>
      <label>เงินประกัน</label><input id="t-dep" type="number" min="0" step="100" value="${Number(t.deposit) || 0}">
      <label>ค่าเช่าล่วงหน้า</label><input id="t-adv" type="number" min="0" step="100" value="${Number(t.rentAdvance) || 0}">
      <label>ค่าเช่าตู้เย็น/เดือน</label><input id="t-fridge" type="number" min="0" step="50" value="${Number(t.fridge) || 0}">
      <label>ค่าที่จอดรถ/เดือน</label><input id="t-park" type="number" min="0" step="50" value="${Number(t.parkingFee) || 0}">
      <label>ภาษาบนบิล</label><select id="t-lang"><option value="th" ${t.lang !== 'en' ? 'selected' : ''}>ภาษาไทย</option><option value="en" ${t.lang === 'en' ? 'selected' : ''}>English</option></select>
      <label>หมายเหตุ</label><input id="t-note" value="${esc(t.note)}" placeholder="เช่น กุญแจประตู 1 / กุญแจห้องน้ำ 1">
      <label class="full" style="display:flex;justify-content:space-between;align-items:center;margin-top:6px"><span>ที่จอดรถ</span><a href="#" id="t-parkmap">🗺️ เปิดผังที่จอดรถ</a></label>
      <div class="full" id="t-slots"></div>
      <label class="full">รูปบัตรประชาชน / Passport ผู้เช่า</label>
      <div class="full photo-box ${t.idPhoto ? '' : 'missing'}" id="pbox">
        <div id="pview">${t.idPhoto ? 'กำลังโหลดรูป…' : '<p class="note">⚠️ ยังไม่มีรูป — บันทึกได้ แต่จะขึ้นเตือนจนกว่าจะแนบ · แนบแล้วระบบจะอ่านชื่อ เลขบัตร วันเกิด ที่อยู่ ให้อัตโนมัติ</p>'}</div>
        <div class="note" id="pidmsg" style="margin-top:6px"></div>
        <div class="cam" id="cam" hidden><video id="vid" autoplay playsinline muted></video></div>
        <div class="acts" style="justify-content:center">
          <label class="btn" for="pfile">📎 แนบรูป</label><input id="pfile" type="file" accept="image/*" hidden>
          <button class="btn" type="button" id="pcam">📷 ถ่ายจากกล้อง</button>
          <button class="btn pri" type="button" id="psnap" hidden>ถ่ายภาพ</button>
          <button class="btn" type="button" id="pstop" hidden>ยกเลิกกล้อง</button>
        </div>
        <input id="pcap" type="file" accept="image/*" capture="environment" hidden>
      </div>
      <div class="err full" id="terr"></div>
    </form>
    <div class="form-acts">${!isNew && auth.can('data.delete') ? '<button class="btn danger" id="tdel" style="margin-right:auto">ลบข้อมูลผู้เช่า</button>' : ''}
      <button class="btn" id="tx">ยกเลิก</button><button class="btn pri" id="tsave">บันทึก</button></div>`, { wide: true });

  const stopCam = () => {
    stream?.getTracks().forEach(x => x.stop()); stream = null;
    if (!$('#pcam')) return;   // ปิดหน้าต่างไปแล้ว
    ['cam', 'psnap', 'pstop'].forEach(i => $('#' + i).hidden = true); $('#pcam').hidden = false;
  };
  const showPhoto = url => { $('#pview').innerHTML = `<img class="thumb" style="margin:0 auto" src="${url}" alt="บัตรประชาชน">`; $('#pbox').classList.remove('missing'); readMain(url); };

  // ---------- อ่านข้อมูลจากบัตร/พาสปอร์ตของผู้เช่า → เติมช่องที่ว่าง, ช่องที่มีข้อมูลแล้วให้กดแทนที่เอง ----------
  const FIELDS = [['name', 't-name', 'ชื่อ'], ['idNo', 't-idno', 'เลขบัตร/พาสปอร์ต'], ['birthDate', 't-birth', 'วันเกิด'], ['address', 't-addr', 'ที่อยู่']];
  const readMain = async url => {
    const out = $('#pidmsg'); if (!out) return;
    out.textContent = '🔍 กำลังอ่านข้อมูลจากบัตร…';
    try {
      const r = await readIdDocument(url, p => { if ($('#pidmsg')) $('#pidmsg').textContent = `🔍 กำลังอ่านข้อมูลจากบัตร… ${p}%`; });
      if (!$('#pidmsg')) return;
      if (!r) return out.innerHTML = '⚠️ อ่านข้อมูลจากรูปไม่ได้ — กรอกเอง (รูปควรชัด ไม่เอียง ไม่สะท้อนแสง)';
      const filled = [], diff = [];
      for (const [k, id, label] of FIELDS) {
        if (!r[k]) continue;
        const el = $('#' + id);
        if (!el.value.trim()) { el.value = r[k]; el.classList.add('autofill'); filled.push(label); }
        else if (el.value.trim() !== r[k]) diff.push([id, label, r[k]]);
      }
      if (r.type === 'passport' && $('#t-lang').value === 'th' && r.nationality && r.nationality !== 'THA') $('#t-lang').value = 'en';
      out.innerHTML = `✅ อ่านจาก${r.type === 'passport' ? ' Passport' : 'บัตรประชาชน'}แล้ว${filled.length ? ' · เติมให้: ' + filled.join(', ') : ''}
        ${r.type === 'thai-id' && r.idNo ? (r.validId ? ' · เลขบัตรถูกต้องตามเลขตรวจสอบ' : ' · <span style="color:var(--bad)">⚠️ เลขบัตรไม่ผ่านเลขตรวจสอบ กรุณาตรวจ</span>') : ''}
        ${r.type === 'passport' ? ` · สัญชาติ ${esc(r.nationality)}${r.expiry ? ' · หมดอายุ ' + esc(r.expiry) : ''}` : ''}
        ${diff.map(([id, label, v]) => `<div>ต่างจากที่กรอกไว้ — ${label}: <b>${esc(v)}</b> <button class="btn sm" type="button" data-use="${id}" data-v="${esc(v)}">ใช้ค่านี้</button></div>`).join('')}
        <div><b>กรุณาตรวจทานก่อนบันทึก</b></div>`;
      out.querySelectorAll('[data-use]').forEach(b => b.onclick = () => { $('#' + b.dataset.use).value = b.dataset.v; b.parentElement.remove(); });
    } catch (e) { if ($('#pidmsg')) out.textContent = 'อ่านข้อมูลไม่สำเร็จ: ' + e.message + ' — กรอกเองได้'; }
  };

  // ---------- ผู้พักร่วม: ชื่อ + เลขบัตร/พาสปอร์ต + รูป (อ่านอัตโนมัติ) ----------
  let occs = (t.occupants || []).map(occ);
  const maxOcc = Number(M.rates().maxOccupants ?? 2);   // ผู้พักร่วมสูงสุดต่อห้อง (ตั้งค่าได้ที่เมนูตั้งค่า)
  const drawOccs = () => {
    $('#t-occs').innerHTML = occs.map((o, i) => `<div class="card" style="padding:10px;margin-bottom:8px">
      <div class="toolbar"><b style="min-width:60px">ผู้พัก ${i + 2}</b>
        <input class="input" data-o="${i}" data-k="name" value="${esc(o.name)}" placeholder="ชื่อ-นามสกุล" style="flex:1;min-width:160px">
        <input class="input" data-o="${i}" data-k="idNo" value="${esc(o.idNo)}" placeholder="เลขบัตรประชาชน / Passport" style="width:210px">
        <label class="btn sm" for="ofile-${i}">📎</label><input id="ofile-${i}" data-of="${i}" type="file" accept="image/*" hidden>
        <label class="btn sm" for="ocam-${i}">📷</label><input id="ocam-${i}" data-of="${i}" type="file" accept="image/*" capture="environment" hidden>
        <button class="btn sm" type="button" data-orm="${i}" title="ลบผู้พัก">✕</button></div>
      <div class="note" data-omsg="${i}">${o._new || o.photo ? '📄 มีรูปบัตรแล้ว' : 'แนบรูปบัตร/พาสปอร์ตเพื่ออ่านชื่อและเลขบัตรอัตโนมัติ'}</div></div>`).join('') || '<p class="note" style="margin:0">ไม่มีผู้พักร่วม</p>';
    $('#t-occs').querySelectorAll('[data-o]').forEach(inp => inp.oninput = () => { occs[+inp.dataset.o][inp.dataset.k] = inp.value; });
    $('#t-occs').querySelectorAll('[data-orm]').forEach(b => b.onclick = () => { occs.splice(+b.dataset.orm, 1); drawOccs(); });
    $('#t-occs').querySelectorAll('[data-of]').forEach(inp => inp.onchange = async e => {
      const i = +inp.dataset.of, f = e.target.files[0]; if (!f) return;
      const o = occs[i]; o._new = await compress(await fileToDataUrl(f));
      const msg = h => { const m = $('#t-occs').querySelector(`[data-omsg="${i}"]`); if (m) m.innerHTML = h; };
      msg('🔍 กำลังอ่านบัตร…');
      try {
        const r = await readIdDocument(o._new, p => msg(`🔍 กำลังอ่านบัตร… ${p}%`));
        if (r) { if (!o.name && r.name) o.name = r.name; if (!o.idNo && r.idNo) o.idNo = r.idNo; if (r.birthDate) o.birthDate = r.birthDate; if (r.nationality) o.nationality = r.nationality; }
        drawOccs();
        msg(r ? `✅ อ่านจาก${r.type === 'passport' ? ' Passport' : 'บัตร'}แล้ว: ${esc(r.name || '-')} · ${esc(r.idNo || '-')}${r.type === 'thai-id' && r.idNo && !r.validId ? ' <span style="color:var(--bad)">⚠️ เลขบัตรไม่ผ่านเลขตรวจสอบ</span>' : ''} — ตรวจทานก่อนบันทึก`
          : '📄 แนบรูปแล้ว · ⚠️ อ่านข้อมูลไม่ได้ กรุณากรอกเอง');
      } catch (x) { msg('📄 แนบรูปแล้ว · อ่านไม่สำเร็จ: ' + esc(x.message)); }
    });
    const full = occs.length >= maxOcc;
    $('#t-occadd').disabled = full;
    $('#t-occadd').title = full ? `ครบ ${maxOcc} คนแล้ว` : '';
    if (occs.length > maxOcc) $('#t-occs').insertAdjacentHTML('beforeend', `<p class="note" style="color:var(--bad);margin:0">⚠️ เกินกำหนด ${maxOcc} คนต่อห้อง กรุณาลบออก ${occs.length - maxOcc} คน</p>`);
  };
  drawOccs();
  $('#t-occadd').onclick = () => { if (occs.length >= maxOcc) return toast(`ผู้พักร่วมได้ไม่เกิน ${maxOcc} คนต่อห้อง`); occs.push(occ({})); drawOccs(); $('#t-occs').querySelector(`[data-o="${occs.length - 1}"][data-k="name"]`)?.focus(); };
  if (t.idPhoto) photoThumb(t.idPhoto).then(h => { $('#pview') && ($('#pview').innerHTML = h); });

  const onFile = async e => { const f = e.target.files[0]; if (!f) return; photo = await compress(await fileToDataUrl(f)); showPhoto(photo); };
  $('#pfile').onchange = onFile; $('#pcap').onchange = onFile;
  $('#pcam').onclick = async () => {
    if (!navigator.mediaDevices?.getUserMedia) return $('#pcap').click();          // มือถือรุ่นเก่า: ใช้กล้องของระบบ
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 } } });
      $('#vid').srcObject = stream; ['cam', 'psnap', 'pstop'].forEach(i => $('#' + i).hidden = false); $('#pcam').hidden = true;
    } catch { toast('เปิดกล้องไม่ได้ — ใช้กล้องของเครื่องแทน'); $('#pcap').click(); }
  };
  $('#psnap').onclick = async () => {
    const v = $('#vid'), c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0); photo = await compress(c.toDataURL('image/jpeg', 0.92)); stopCam(); showPhoto(photo);
  };
  $('#pstop').onclick = stopCam;
  document.addEventListener('modal-closed', stopCam, { once: true });
  $('#tx').onclick = closeModal;

  // ---------- ที่จอดรถของห้องนี้ (เพิ่ม / แก้ทะเบียน / เอาออก) ----------
  const origSlots = t.room ? M.slotsOf(t.room).map(s => s.id) : [];
  let parking = t.room ? M.slotsOf(t.room).map(s => ({ id: s.id, plate: s.plate || '', vehicle: s.vehicle || '' })) : [];
  const kindTxt = id => id.startsWith('CAR') ? '🚗 รถยนต์' : '🏍️ มอไซค์';
  const drawSlots = () => {
    const taken = new Set(parking.map(p => p.id));
    const free = db.all('slots').filter(s => (!s.room || origSlots.includes(s.id)) && !taken.has(s.id)).sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
    $('#t-slots').innerHTML = `${parking.map((p, i) => `<div class="toolbar" style="margin-bottom:6px">
        <span class="chip" style="min-width:92px;cursor:default">${kindTxt(p.id).split(' ')[0]} ${p.id}</span>
        <input class="input" data-pi="${i}" data-k="plate" value="${esc(p.plate)}" placeholder="ทะเบียนรถ" style="width:130px">
        <input class="input" data-pi="${i}" data-k="vehicle" value="${esc(p.vehicle)}" placeholder="ยี่ห้อ/รุ่น/สี" style="flex:1;min-width:120px">
        <button class="btn sm" type="button" data-prm="${i}" title="ยกเลิกการจอดช่องนี้">✕</button></div>`).join('') || '<p class="note" style="margin:0 0 6px">ยังไม่มีที่จอด</p>'}
      <div class="toolbar"><select class="input" id="t-slotadd"><option value="">＋ เลือกช่องจอดว่าง…</option>
        ${free.map(s => `<option value="${s.id}">${s.id} (${kindTxt(s.id).split(' ')[1]})</option>`).join('')}</select></div>`;
    $('#t-slots').querySelectorAll('[data-pi]').forEach(inp => inp.oninput = () => { parking[+inp.dataset.pi][inp.dataset.k] = inp.value; });
    $('#t-slots').querySelectorAll('[data-prm]').forEach(b => b.onclick = () => { parking.splice(+b.dataset.prm, 1); drawSlots(); });
    $('#t-slotadd').onchange = e => { if (!e.target.value) return; parking.push({ id: e.target.value, plate: '', vehicle: '' }); drawSlots();
      $('#t-slots').querySelector(`[data-pi="${parking.length - 1}"][data-k="plate"]`)?.focus(); };
  };
  drawSlots();
  // อัตราน้ำ/ไฟ: แสดงค่าดีฟอล์ตของห้อง · เปลี่ยนห้องแล้วอัตราตามห้องใหม่ (ถ้ายังไม่ได้แก้เอง)
  const rateTouched = { w: t.wRate != null, e: t.eRate != null };
  const showDefRates = () => {
    const d = roomDefault($('#t-room').value);
    if (!rateTouched.w) $('#t-wrate').value = d.water;
    if (!rateTouched.e) $('#t-erate').value = d.elec;
    $('#t-wdef').textContent = `ดีฟอล์ต ฿${d.water}`; $('#t-edef').textContent = `ดีฟอล์ต ฿${d.elec}`;
  };
  $('#t-wrate').oninput = () => { rateTouched.w = true; };
  $('#t-erate').oninput = () => { rateTouched.e = true; };
  $('#t-room').addEventListener('change', showDefRates);
  showDefRates();

  $('#t-parkmap').onclick = e => { e.preventDefault(); const room = $('#t-room').value; stopCam(); closeModal();
    document.dispatchEvent(new CustomEvent('app-nav', { detail: { id: 'parking', arg: { highlight: [room, ...M.slotsOf(room).map(s => s.id)] } } })); };
  const saveSlots = async roomId => {
    for (const id of origSlots) if (!parking.some(p => p.id === id)) { const s = db.get('slots', id); if (s?.room) await db.put('slots', { ...s, room: '', plate: '', vehicle: '' }); }
    for (const p of parking) { const s = db.get('slots', p.id);
      if (s && (s.room !== roomId || s.plate !== p.plate.trim() || s.vehicle !== p.vehicle.trim())) await db.put('slots', { ...s, room: roomId, plate: p.plate.trim(), vehicle: p.vehicle.trim() }); }
  };

  $('#tsave').onclick = async () => {
    const v = id => $('#' + id).value.trim();
    if (!v('t-name')) return $('#terr').textContent = 'กรุณากรอกชื่อผู้เช่า';   // ข้อมูลอื่นไม่ครบก็บันทึกได้ — จะขึ้น ⚠️ ให้ตามเก็บภายหลัง
    const occCount = occs.filter(o => o.name.trim() || o.idNo.trim() || o._new).length;
    if (occCount > maxOcc) return $('#terr').textContent = `ผู้พักร่วมได้ไม่เกิน ${maxOcc} คนต่อห้อง (ตอนนี้ ${occCount} คน)`;
    const rec = { ...t, id: t.id || uid('t-'), room: v('t-room'), name: v('t-name'), phone: v('t-phone'), address: v('t-addr'), idNo: v('t-idno'), birthDate: v('t-birth'),
      occupants: [], since: v('t-since'), rent: Number(v('t-rent')) || 0,
      wRate: v('t-wrate') === '' ? null : Number(v('t-wrate')), eRate: v('t-erate') === '' ? null : Number(v('t-erate')),
      deposit: Number(v('t-dep')) || 0, rentAdvance: Number(v('t-adv')) || 0, lang: v('t-lang'),
      fridge: Number(v('t-fridge')) || 0, parkingFee: Number(v('t-park')) || 0, note: v('t-note'), active: true };
    if (photo) {
      const pid = uid('id-');
      await db.putPhoto({ id: pid, dataUrl: photo, name: `${rec.room}-${rec.name}-บัตรประชาชน.jpg`, tenantId: rec.id, createdAt: new Date().toISOString() });
      await db.queue({ kind: 'photo', photoId: pid });
      rec.idPhoto = pid;
    }
    for (const o of occs) {
      if (!o.name.trim() && !o.idNo.trim() && !o._new) continue;
      const { _new, ...rest } = o;
      if (_new) {
        rest.photo = uid('id-');
        await db.putPhoto({ id: rest.photo, dataUrl: _new, name: `${rec.room}-${o.name || 'ผู้พัก'}-บัตร.jpg`, tenantId: rec.id, createdAt: new Date().toISOString() });
        await db.queue({ kind: 'photo', photoId: rest.photo });
      }
      rec.occupants.push({ ...rest, name: rest.name.trim(), idNo: rest.idNo.trim() });
    }
    await db.put('tenants', rec);
    await saveSlots(rec.room);
    // บิลร่างที่ยังไม่ออกของผู้เช่านี้ → ใช้อัตราน้ำ/ไฟตามสัญญาใหม่
    const nr = M.roomRates(db.get('rooms', rec.room), rec);
    for (const b of db.all('bills').filter(b => b.room === rec.room && b.status === 'draft' && (!b.tenantId || b.tenantId === rec.id)))
      if (b.wRate !== nr.water || b.eRate !== nr.elec) await db.put('bills', { ...b, wRate: nr.water, eRate: nr.elec });
    const miss = M.missingInfo(rec);
    stopCam(); closeModal();
    toast((isNew ? `บันทึกผู้เช่าห้อง ${rec.room} แล้ว` : 'บันทึกการแก้ไขแล้ว') + (miss.length ? ` — ⚠️ ยังขาด: ${miss.join(', ')}` : ''), miss.length ? 5000 : 2500); done?.();
  };
  $('#tdel')?.addEventListener('click', async () => {
    if (!await confirmBox(`ลบข้อมูลผู้เช่า ${t.name} ห้อง ${t.room}? (ใช้กรณีบันทึกผิด ถ้าย้ายออกให้ใช้ "ย้ายออก")`, 'ลบ')) return;
    await db.remove('tenants', t.id); toast('ลบข้อมูลแล้ว'); done?.();
  });
}

// ย้ายออก: จดมิเตอร์น้ำ-ไฟตอนออก + รายการหักค่าเสียหาย → ยอดคืนเงินประกัน → พิมพ์เอกสารคืนเงิน
// เลขมิเตอร์ตอนออกจะเป็นเลขเริ่มต้นของผู้เช่าคนถัดไป (model.prevMeters)
export async function moveOut(t, done) {
  const room = db.get('rooms', t.room), rt = M.roomRates(room, t), last = M.readings(t.room)[0] || {};
  let items = [{ name: '', amount: '' }];
  const box = openModal(`<h3>ย้ายออก — ห้อง ${t.room}</h3><p style="margin-top:-8px">${esc(t.name)}</p>
    <form class="form" onsubmit="return false">
      <label>วันที่ย้ายออก</label><input id="mo-date" type="date" value="${new Date().toISOString().slice(0, 10)}">
    </form>
    <table class="tbl" style="margin:12px 0"><thead><tr><th>มิเตอร์</th><th class="n">เลขเดิม</th><th class="n">เลขตอนออก</th><th class="n">หน่วย</th><th class="n">ราคา/หน่วย</th><th class="n">เงิน</th></tr></thead><tbody>
      <tr><td>น้ำประปา</td><td class="n"><input id="mo-wp" type="number" value="${last.w ?? ''}"></td><td class="n"><input id="mo-wc" type="number" placeholder="เลขใหม่"></td><td class="n" id="mo-wu">-</td><td class="n">${rt.water}</td><td class="n" id="mo-wa">-</td></tr>
      <tr><td>ไฟฟ้า</td><td class="n"><input id="mo-ep" type="number" value="${last.e ?? ''}"></td><td class="n"><input id="mo-ec" type="number" placeholder="เลขใหม่"></td><td class="n" id="mo-eu">-</td><td class="n">${rt.elec}</td><td class="n" id="mo-ea">-</td></tr>
    </tbody></table>
    <p class="note" style="margin-top:-6px">เลขเดิม = จดล่าสุด${last.date ? ' ' + thDate(last.date) : ''} (แก้ได้) · เลขตอนออกจะเป็นเลขเริ่มของผู้เช่าคนถัดไป</p>
    <div class="toolbar" style="justify-content:space-between"><b>เงินประกัน${M.depositUsed(t) ? ` <span class="note" style="font-weight:400">(฿${fmt0(t.deposit)} หักชำระบิลไปแล้ว ฿${fmt0(M.depositUsed(t))})</span>` : ''}</b><input class="input" id="mo-dep" type="number" value="${M.depositLeft(t)}" style="width:140px;text-align:right"></div>
    <b style="display:block;margin:12px 0 6px">รายการหัก</b>
    <div id="mo-items"></div>
    <button class="btn sm" id="mo-add" type="button" style="margin-top:6px">＋ เพิ่มรายการ</button>
    <div class="card" style="margin-top:12px;padding:12px"><div class="toolbar" style="justify-content:space-between"><span>รวมหัก (ค่าน้ำ ค่าไฟ และรายการหัก)</span><b id="mo-ded">0</b></div>
      <div class="toolbar" style="justify-content:space-between;font-size:18px;margin-top:6px"><span id="mo-lbl">คงเหลือคืนเงินประกันทั้งสิ้น</span><b id="mo-ref">0</b></div></div>
    <div id="mo-howbox" style="margin-top:10px">
      <div class="toolbar"><b>คืนเงินโดย</b>
        <div class="seg" id="mo-how"><button type="button" data-how="" class="on">ยังไม่ระบุ</button><button type="button" data-how="cash">💵 เงินสด</button><button type="button" data-how="transfer">🏦 โอนเข้าบัญชี</button></div></div>
      <div class="form" id="mo-acct" hidden style="margin-top:8px">
        <label>ธนาคาร</label><input id="mo-bank" placeholder="เช่น กสิกรไทย" value="${esc(t.refundBank || '')}">
        <label>เลขที่บัญชี</label><input id="mo-acctno" inputmode="numeric" placeholder="xxx-x-xxxxx-x" value="${esc(t.refundAcctNo || '')}">
        <label>ชื่อบัญชี</label><input id="mo-acctname" value="${esc(t.refundAcctName || t.name || '')}"></div>
      <p class="note" style="margin:6px 0 0">พิมพ์ลงใบคืนเงินประกัน · ถ้ายังไม่ระบุ จะเว้นช่องให้เขียนเอง</p></div>
    <label style="display:flex;gap:8px;align-items:center;margin-top:10px"><input id="mo-slot" type="checkbox" checked> ปล่อยช่องจอด ${M.slotsOf(t.room).map(s => s.id).join(', ') || '-'} ให้ว่าง</label>
    <div class="err" id="mo-err"></div>
    <div class="form-acts"><button class="btn" id="mox">ยกเลิก</button><button class="btn" id="mook">บันทึกย้ายออก</button><button class="btn pri" id="moprint">บันทึก + พิมพ์เอกสารคืนเงิน</button></div>`, { wide: true });
  const v = id => box.querySelector('#' + id).value, n = id => v(id) === '' ? null : Number(v(id));

  const drawItems = () => {
    box.querySelector('#mo-items').innerHTML = items.map((o, i) => `<div class="toolbar" style="margin-bottom:6px">
      <input class="input" data-i="${i}" data-k="name" value="${esc(o.name)}" placeholder="รายการ เช่น ค่าทำความสะอาด, ค่าซ่อมประตู" style="flex:1;min-width:180px">
      <input class="input" data-i="${i}" data-k="amount" type="number" value="${o.amount}" placeholder="บาท" style="width:120px;text-align:right">
      <button class="btn sm" type="button" data-rm="${i}" title="ลบรายการ">✕</button></div>`).join('');
    box.querySelectorAll('#mo-items input').forEach(inp => inp.oninput = () => { items[+inp.dataset.i][inp.dataset.k] = inp.value; calc(); });
    box.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { items.splice(+b.dataset.rm, 1); if (!items.length) items.push({ name: '', amount: '' }); drawItems(); calc(); });
  };
  const doc = () => {
    const c = M.calcBill({ room: t.room, period: '0000-00', wPrev: n('mo-wp'), wCur: n('mo-wc'), wRate: rt.water, ePrev: n('mo-ep'), eCur: n('mo-ec'), eRate: rt.elec });
    const ded = items.filter(o => o.name || Number(o.amount)).map(o => ({ name: o.name.trim(), amount: Number(o.amount) || 0 }));
    const deposit = n('mo-dep') || 0, totalDed = c.water + c.elec + ded.reduce((a, o) => a + o.amount, 0);
    return { date: v('mo-date'), deposit, wPrev: n('mo-wp'), wCur: n('mo-wc'), wu: c.wu, wRate: rt.water, water: c.water, wMin: c.wMin ? c.wBilled : null,
      ePrev: n('mo-ep'), eCur: n('mo-ec'), eu: c.eu, eRate: rt.elec, elec: c.elec, eMin: c.eMin ? c.eBilled : null, items: ded, totalDed, refund: Math.round((deposit - totalDed) * 100) / 100,
      refundMethod: how, ...(how === 'transfer' ? { bank: v('mo-bank').trim(), acctNo: v('mo-acctno').trim(), acctName: v('mo-acctname').trim() } : {}) };
  };
  // วิธีคืนเงิน: เงินสด / โอนเข้าบัญชี (แสดงช่องบัญชีเมื่อเลือกโอน)
  let how = '';
  box.querySelectorAll('[data-how]').forEach(b => b.onclick = () => {
    how = b.dataset.how;
    box.querySelectorAll('[data-how]').forEach(x => x.classList.toggle('on', x === b));
    box.querySelector('#mo-acct').hidden = how !== 'transfer';
  });
  const calc = () => {
    const d = doc();
    box.querySelector('#mo-wu').textContent = d.wu ?? '-'; box.querySelector('#mo-wa').textContent = d.wu != null ? fmt0(d.water) : '-';
    box.querySelector('#mo-eu').textContent = d.eu ?? '-'; box.querySelector('#mo-ea').textContent = d.eu != null ? fmt0(d.elec) : '-';
    box.querySelector('#mo-ded').textContent = '฿' + d.totalDed.toLocaleString('th-TH');
    box.querySelector('#mo-lbl').textContent = d.refund >= 0 ? 'คงเหลือคืนเงินประกันทั้งสิ้น' : 'ผู้เช่าต้องชำระเพิ่ม';
    box.querySelector('#mo-ref').textContent = '฿' + Math.abs(d.refund).toLocaleString('th-TH');
    box.querySelector('#mo-ref').style.color = d.refund >= 0 ? 'var(--ok)' : 'var(--bad)';
    box.querySelector('#mo-howbox').hidden = d.refund < 0;   // ผู้เช่าต้องจ่ายเพิ่ม → ไม่มีการคืนเงิน
  };
  drawItems(); calc();
  ['mo-wp', 'mo-wc', 'mo-ep', 'mo-ec', 'mo-dep', 'mo-date'].forEach(id => box.querySelector('#' + id).oninput = calc);
  box.querySelector('#mo-add').onclick = () => { items.push({ name: '', amount: '' }); drawItems(); box.querySelector(`[data-i="${items.length - 1}"][data-k="name"]`).focus(); };
  box.querySelector('#mox').onclick = closeModal;

  const save = async print => {
    const d = doc();
    if (d.wCur == null || d.eCur == null) return box.querySelector('#mo-err').textContent = 'กรุณาจดเลขมิเตอร์น้ำและไฟตอนย้ายออก';
    if (d.refund >= 0 && how === 'transfer' && !d.acctNo) return box.querySelector('#mo-err').textContent = 'กรุณาใส่เลขที่บัญชีสำหรับโอนคืนเงิน';
    if (d.refund < 0) { delete d.bank; delete d.acctNo; delete d.acctName; d.refundMethod = ''; }
    d.no = nextRefundNo(d.date, db.all('tenants'));   // เลขที่ใบคืนเงินประกัน RF6910-1
    if ((d.wu ?? 0) < 0 || (d.eu ?? 0) < 0) return box.querySelector('#mo-err').textContent = 'เลขมิเตอร์ตอนออกน้อยกว่าเลขเดิม กรุณาตรวจสอบ';
    const releaseSlots = box.querySelector('#mo-slot').checked ? M.slotsOf(t.room) : [];
    const rec = { ...t, active: false, moveOut: d.date, moveOutAt: new Date().toISOString(), moveOutMeter: { w: d.wCur, e: d.eCur },
      moveOutDoc: d, moveOutSlots: releaseSlots.map(s => ({ id: s.id, plate: s.plate, vehicle: s.vehicle })) };
    await db.put('tenants', rec);
    for (const s of releaseSlots) await db.put('slots', { ...s, room: '', plate: '', vehicle: '' });
    closeModal(); toast(`ห้อง ${t.room} ว่างแล้ว`);
    if (print) printRefund(rec);
    done?.();
  };
  box.querySelector('#mook').onclick = () => save(false);
  box.querySelector('#moprint').onclick = () => save(true);
}

// ใบคืนเงินประกัน A4 รูปแบบเดียวกับใบแจ้งหนี้ (core/docs.js)
export const printRefund = t => printRefundDoc(t);

// ยกเลิกการย้ายออก: คืนสถานะผู้เช่า + ช่องจอดเดิม (ถ้ายังว่าง)
export async function cancelMoveOut(t, done) {
  if (M.tenantOf(t.room)) return toast(`ห้อง ${t.room} มีผู้เช่าใหม่แล้ว ยกเลิกไม่ได้`);
  if (!await confirmBox(`ยกเลิกการย้ายออกของ ${t.name} ห้อง ${t.room}? ผู้เช่าจะกลับมาเป็นผู้เช่าปัจจุบัน`, 'ยกเลิกการย้ายออก')) return;
  const { moveOut: _a, moveOutAt: _b, moveOutMeter: _c, moveOutDoc: _d, moveOutSlots, ...rest } = t;
  await db.put('tenants', { ...rest, active: true });
  const back = [];
  for (const s of moveOutSlots || []) { const cur = db.get('slots', s.id); if (cur && !cur.room) { await db.put('slots', { ...cur, room: t.room, plate: s.plate, vehicle: s.vehicle }); back.push(s.id); } }
  toast(`ยกเลิกการย้ายออกแล้ว${back.length ? ' · คืนช่องจอด ' + back.join(', ') : (moveOutSlots ? '' : ' · กรุณาตรวจสอบช่องจอดรถอีกครั้ง')}`, 4000);
  done?.();
}

// ข้อมูลผู้เช่า + ประวัติบิลทั้งหมดของคนนี้
export function openTenantHistory(t, done) {
  const bills = db.all('bills').filter(b => b.tenantId === t.id).sort((a, b) => b.period.localeCompare(a.period));
  const sum = bills.reduce((a, b) => a + M.calcBill(b).total, 0);
  const box = openModal(`<h3>${esc(t.name)} — ห้อง ${t.room}</h3>
    <div class="detail"><dl>
      <dt>สถานะ</dt><dd>${t.active ? '<span class="pill ok">พักอยู่</span>' : '<span class="pill idle">ย้ายออกแล้ว</span>'}</dd>
      <dt>เข้า – ออก</dt><dd>${thDate(t.since)} – ${t.active ? 'ปัจจุบัน' : thDate(t.moveOut)}</dd>
      <dt>โทร</dt><dd>${esc(t.phone || '-')}</dd><dt>ที่อยู่</dt><dd>${esc(t.address || '-')}</dd>
      <dt>บัตร/Passport</dt><dd>${esc(t.idNo || '-')}</dd>
      <dt>วันเกิด</dt><dd>${t.birthDate ? thDate(t.birthDate) : '-'}</dd>
      <dt>ระยะเวลาเช่า</dt><dd>${M.stayText(t.since, t.active ? null : t.moveOut)}</dd>
      ${t.occupants?.length ? `<dt>ผู้พักร่วม</dt><dd>${t.occupants.map(o => { o = occ(o); return esc(o.name || '-') + (o.idNo ? ` (${esc(o.idNo)})` : ''); }).join(', ')}</dd>` : ''}
      <dt>เงินประกัน</dt><dd>฿${fmt0(t.deposit)}</dd>${t.note ? `<dt>หมายเหตุ</dt><dd class="note">${esc(t.note)}</dd>` : ''}</dl></div>
    <b>ประวัติบิล ${bills.length} เดือน · รวม ฿${fmt0(sum)}</b>
    <div class="scroll" style="max-height:36vh;margin-top:6px"><table class="tbl"><thead><tr><th>เดือน</th><th>เลขที่</th><th class="n">ค่าเช่า</th><th class="n">น้ำ</th><th class="n">ไฟ</th><th class="n">รวม</th><th>สถานะ</th></tr></thead><tbody>
    ${bills.map(b => { const c = M.calcBill(b), s = M.billState(b); return `<tr><td>${periodLabel(b.period, true)}</td><td>${esc(b.invoiceNo || '')}</td><td class="n">${fmt0(b.rent)}</td>
      <td class="n">${fmt0(c.water)}</td><td class="n">${fmt0(c.elec)}</td><td class="n">${fmt0(c.total)}</td><td>${['paid', 'partial'].includes(s) ? `<button class="pill ${M.BILL_TXT[s][1]} pay-btn" data-pd="${b.id}" title="ดูรายละเอียดการโอน / แก้ไข">${M.BILL_TXT[s][0]} 🔍</button>` : `<span class="pill ${M.BILL_TXT[s][1]}">${M.BILL_TXT[s][0]}</span>`}</td></tr>`; }).join('') || '<tr><td colspan="7" class="note">ไม่มีบิลที่ผูกกับผู้เช่ารายนี้</td></tr>'}
    </tbody></table></div>
    <div class="form-acts">${t.moveOutDoc ? '<button class="btn" id="hrefund">🖨️ เอกสารคืนเงิน</button>' : ''}
      ${!t.active && !M.tenantOf(t.room) && M.pastTenantsOf(t.room)[0]?.id === t.id ? '<button class="btn" id="hcancel">↩ ยกเลิกการย้ายออก</button>' : ''}
      <button class="btn" id="hx">ปิด</button><button class="btn pri" id="hedit">แก้ไขข้อมูล</button></div>`, { wide: true });
  box.querySelector('#hx').onclick = closeModal;
  box.querySelector('#hedit').onclick = () => openTenantForm(t, done);
  box.querySelector('#hrefund')?.addEventListener('click', () => printRefund(t));
  // ดูรายละเอียดการโอนของบิล (import แบบ dynamic เพื่อเลี่ยงการอ้างอิงวนกับ billing.js)
  box.querySelectorAll('[data-pd]').forEach(x => x.onclick = () => import('./billing.js').then(m => m.openPaymentDetail(db.get('bills', x.dataset.pd), done)));
  box.querySelector('#hcancel')?.addEventListener('click', () => { closeModal(); cancelMoveOut(t, done); });
}

export default {
  id: 'tenants', title: 'ผู้เช่า', icon: '👥',
  render(el, nav) {
    const all = db.all('tenants');
    const list = all.filter(t => filter === 'old' ? !t.active : filter === 'nophoto' ? t.active && !t.idPhoto : filter === 'incomplete' ? M.missingInfo(t).length : t.active)
      .filter(t => !q || [t.room, t.name, t.phone, t.idNo, ...M.slotsOf(t.room).map(s => s.id + s.plate)].join(' ').toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => a.room.localeCompare(b.room));
    const cnt = { active: all.filter(t => t.active).length, nophoto: all.filter(t => t.active && !t.idPhoto).length, incomplete: all.filter(t => M.missingInfo(t).length).length, old: all.filter(t => !t.active).length };
    el.innerHTML = `
    <div class="top"><h2>ผู้เช่า</h2><div class="toolbar">
      <input class="search" id="q" placeholder="ค้นหา ห้อง / ชื่อ / เบอร์ / ทะเบียนรถ" value="${esc(q)}">
      <button class="btn pri" id="add">+ ผู้เช่าเข้าใหม่</button></div></div>
    <div class="seg" style="margin-bottom:12px">
      <button data-flt="active" class="${filter === 'active' ? 'on' : ''}">ปัจจุบัน (${cnt.active})</button>
      <button data-flt="nophoto" class="${filter === 'nophoto' ? 'on' : ''}">⚠️ ยังไม่มีรูปบัตร (${cnt.nophoto})</button>
      <button data-flt="incomplete" class="${filter === 'incomplete' ? 'on' : ''}">⚠️ ข้อมูลไม่ครบ (${cnt.incomplete})</button>
      <button data-flt="old" class="${filter === 'old' ? 'on' : ''}">ย้ายออกแล้ว (${cnt.old})</button></div>
    <div class="scroll"><table class="tbl"><thead><tr><th>ห้อง</th><th>ชื่อ</th><th>โทร</th><th>${filter === 'old' ? 'เข้า – ออก' : 'เข้าพัก'}</th><th class="n">ค่าเช่า</th><th class="n">ประกัน</th><th class="n">ตู้เย็น</th><th class="n">ค่าจอด</th><th>ที่จอด</th><th>บัตร</th><th>LINE</th><th>หมายเหตุ</th></tr></thead><tbody>
    ${list.map(t => { const r = db.get('rooms', t.room);
      const miss = M.missingText(t);
      return `<tr class="click" data-t="${t.id}"><td><b>${t.room}</b></td><td>${esc(t.name)}${t.occupants?.length ? ` <span class="note">+${t.occupants.length}</span>` : ''}${miss ? ` <span class="pill warn" title="${esc(miss)}">⚠️ ${esc(miss)}</span>` : ''}</td><td>${esc(t.phone)}</td>
      <td>${thDate(t.since)}${filter === 'old' ? ' – ' + thDate(t.moveOut) : ''}</td>
      <td class="n">${fmt0(t.rent ?? r?.rent)}</td><td class="n">${t.deposit ? fmt0(t.deposit) : '-'}</td><td class="n">${t.fridge ? fmt0(t.fridge) : '-'}</td><td class="n">${t.parkingFee ? fmt0(t.parkingFee) : '-'}</td>
      <td>${t.active ? M.slotsOf(t.room).map(s => s.id).join(', ') : ''}</td><td>${t.idPhoto ? '✅' : (t.idNo ? '<span class="pill warn">มีเลข ไม่มีรูป</span>' : '<span class="pill bad">ไม่มี</span>')}</td>
      <td>${t.active && M.lineLinkOf(t.room) ? '✅' : '-'}</td><td class="note" style="max-width:220px;overflow:hidden;text-overflow:ellipsis">${esc(t.note || '')}</td></tr>`; }).join('') || '<tr><td colspan="12" class="empty">ไม่พบข้อมูล</td></tr>'}
    </tbody></table></div>`;
    const re = () => this.render(el, nav);
    const qi = el.querySelector('#q');
    qi.oninput = () => { q = qi.value; re(); const n = el.querySelector('#q'); n.focus(); n.setSelectionRange(q.length, q.length); };
    el.querySelectorAll('[data-flt]').forEach(b => b.onclick = () => { filter = b.dataset.flt; re(); });
    el.querySelector('#add').onclick = () => openTenantForm({}, re);
    el.querySelectorAll('[data-t]').forEach(tr => tr.onclick = () => {
      const t = db.get('tenants', tr.dataset.t);
      t.active ? nav.go('floorplan', { room: t.room }) : openTenantHistory(t, re);
    });
  },
};

// เปิดรูปบัตรขนาดใหญ่
document.addEventListener('click', e => {
  const a = e.target.closest('[data-view-photo]'); if (!a) return;
  e.preventDefault(); const src = a.querySelector('img').src;
  const w = window.open(); if (w) w.document.write(`<title>บัตรประชาชน</title><img src="${src}" style="max-width:100%">`);
});
