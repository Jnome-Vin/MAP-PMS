// หน้าต่างทำสัญญาเช่า: ข้อมูลผู้เช่า (อ่านจากบัตร/Passport) + รายละเอียดสัญญา + รูปแนบ → Word / PDF / พิมพ์ / ส่ง LINE
// เปิดอัตโนมัติหลังบันทึกผู้เช่าเข้าใหม่ และกด "📝 สัญญาเช่า" ที่ผังห้อง / ประวัติผู้เช่า เพื่อทำหรือพิมพ์ใหม่
import * as db from '../core/db.js';
import * as M from '../core/model.js';
import { esc, toast, openModal, closeModal, uid, bahtText } from '../core/ui.js';
import { readIdDocument, occ as occOf } from '../core/idcard.js';
import * as K from '../core/contract.js';
import { compress, fileToDataUrl } from './tenants.js';
import { editImage, dropZone } from '../core/imgedit.js';
import { readMeter, canUseClaude } from '../core/meter.js';

const CSS = `
.ctm{display:grid;grid-template-columns:minmax(360px,440px) 1fr;gap:14px;align-items:start}
.ctm .frm{max-height:72vh;overflow:auto;padding-right:4px}
.ctm .sec{border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-bottom:12px}
.ctm .sec h4{margin:0 0 8px;font-size:15px;display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.ctm .sec h4 small{font-weight:400;color:var(--muted);font-size:12px}
.ctm .g2{display:grid;grid-template-columns:1fr 1fr;gap:8px 10px}.ctm .full{grid-column:1/-1}
.ctm label.l{display:block;font-size:12.5px;color:var(--muted);margin-bottom:2px}
.ctm input,.ctm select{width:100%;font:inherit;font-size:14px;padding:6px 8px;border:1px solid #cdd5de;border-radius:7px;background:#fff}
.ctm .f-blue{color:#0070C0}.ctm .f-red{color:#EE0000}.ctm .f-lblue{color:#4472C4}.ctm .f-orange{color:#ED7D31}
.ctm .auto{font-size:11.5px;color:#2e8b57;margin-top:2px}
.ctm .lang{display:flex;align-items:center;justify-content:space-between;gap:10px;border-radius:10px;padding:9px 12px;background:#f4f8fb;border:1px solid #d6e2ec;margin-bottom:12px;cursor:pointer}
.ctm .lang small{display:block;color:var(--muted);font-size:12px}
.ctm .sw{position:relative;width:46px;height:26px;flex:none}.ctm .sw input{opacity:0;width:0;height:0}
.ctm .sw span{position:absolute;inset:0;background:#c5cfd9;border-radius:20px;transition:.2s}
.ctm .sw span::after{content:'';position:absolute;left:3px;top:3px;width:20px;height:20px;background:#fff;border-radius:50%;transition:.2s;box-shadow:0 1px 2px rgba(0,0,0,.25)}
.ctm .sw input:checked+span{background:var(--brand)}.ctm .sw input:checked+span::after{left:23px}
.ctm .idbox{display:flex;gap:10px;align-items:center;border:1.5px dashed #b8c4d0;border-radius:10px;padding:8px;background:#fafcfe;margin-bottom:8px}
.ctm .idbox .ph{width:110px;height:70px;border-radius:6px;background:#e7eef5;display:flex;align-items:center;justify-content:center;font-size:11px;color:#5a6c7e;flex:none;text-align:center;overflow:hidden}
.ctm .idbox .ph img{width:100%;height:100%;object-fit:cover}
.ctm .msg{font-size:12px;color:#2e8b57;margin-top:4px}
.ctm .idbox,.ctm .thumbs{transition:background .15s,border-color .15s}
.ctm .drop-on{background:#e3f0fb!important;border-color:#1f5f8b!important;outline:2px dashed #1f5f8b;outline-offset:2px}
.ctm .idbox .ph small{display:block;font-size:10px;color:#8a99a8;margin-top:2px}
.ctm .xrow{display:grid;grid-template-columns:1fr 90px 34px;gap:6px;margin-top:6px}
.ctm .thumbs{display:flex;gap:8px;flex-wrap:wrap}
.ctm .thumbs .t{width:76px;text-align:center;font-size:11px;color:var(--muted)}
.ctm .thumbs .t .im{width:76px;height:64px;border-radius:7px;background:#eef2f6;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative;font-size:24px;cursor:pointer;border:1.5px dashed transparent}
.ctm .thumbs .t .im.add{border-color:#b8c4d0;background:#fff;font-size:13px}
.ctm .thumbs .t .im img{width:100%;height:100%;object-fit:cover}
.ctm .thumbs .t .rm{position:absolute;right:2px;top:2px;background:#fff;border-radius:50%;width:20px;height:20px;line-height:18px;font-size:12px;color:#c0392b;border:1px solid #ddd}
.ctm .pv{max-height:72vh;overflow:auto;background:#e9edf2;border-radius:10px;padding:6px}
.ctm .pv .zm{zoom:.62}
.ctm .seg button{flex:1}
@media (max-width:900px){.ctm{grid-template-columns:1fr}.ctm .pv{display:none}}
`;
const FRIDGE = `<svg width="30" height="38" viewBox="0 0 38 46" aria-hidden="true"><defs><linearGradient id="fzf" x1="0" x2="1"><stop offset="0" stop-color="#ff9a7a"/><stop offset=".55" stop-color="#f4643f"/><stop offset="1" stop-color="#e2502d"/></linearGradient><linearGradient id="fzc" x1="0" x2="1"><stop offset="0" stop-color="#fff"/><stop offset=".5" stop-color="#c9d1d8"/><stop offset="1" stop-color="#8d99a4"/></linearGradient></defs><ellipse cx="18" cy="43.2" rx="15" ry="2.2" opacity=".16"/><path d="M27 4 L33 1.5 V38 L27 41 Z" fill="#b73a1d"/><path d="M4 4 L10 1.5 H33 L27 4 Z" fill="#ffb59e"/><rect x="4" y="4" width="23" height="37" rx="2.2" fill="url(#fzf)"/><rect x="4" y="16" width="23" height="1.6" fill="#a8341a"/><rect x="21.5" y="7" width="2.4" height="6.5" rx="1.2" fill="url(#fzc)"/><rect x="21.5" y="20" width="2.4" height="11" rx="1.2" fill="url(#fzc)"/></svg>`;

// tIn = ผู้เช่าเดิม (ทำสัญญาใหม่ / พิมพ์ซ้ำ) หรือ { room } = ผู้เช่าเข้าใหม่: กรอกครั้งเดียวในหน้าต่างนี้ บันทึกแล้วได้ทั้งข้อมูลผู้เช่าและสัญญา
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export async function openContract(tIn = {}, done) {
  let isNew = !(tIn.id && db.get('tenants', tIn.id));
  const vacant = M.rooms().filter(r => !M.tenantOf(r.id));
  if (isNew && !vacant.length) return toast('ไม่มีห้องว่าง');
  const blank = room => { const r = db.get('rooms', room) || {}; const rent = Number(r.rent) || 0;
    return { id: uid('t-'), room, rent, deposit: rent, fridge: 0, parkingFee: 0, occupants: [], lang: 'th', since: todayIso(), active: true }; };
  const firstRoom = (vacant.find(r => r.kind === 'room') || vacant[0]).id;   // ห้องพักว่างห้องแรก (ไม่ใช่สำนักงาน/ซักผ้า)
  let t = isNew ? { ...blank(vacant.some(r => r.id === tIn.room) ? tIn.room : firstRoom), ...tIn, id: uid('t-') } : db.get('tenants', tIn.id);
  const C = { ...K.defaults(t), birthDate: t.birthDate || '', address: t.address || '', ...(t.contract || {}) };
  C.extras = (C.extras || []).map(x => ({ ...x }));
  C.photos = (C.photos || []).map(x => ({ ...x }));
  const maxOcc = Number(M.rates().maxOccupants ?? 2);
  let occs = (t.occupants || []).map(occOf).map(o => ({ ...o }));
  let newId = null;                 // รูปบัตรผู้เช่าใหม่ (ยังไม่บันทึก)
  const newPhotos = {};             // id → dataUrl ของรูปแนบใหม่
  const cache = {};                 // id → dataUrl (แสดงตัวอย่าง)

  const field = (k, label, cls = 'f-blue', attrs = '') => `<div><label class="l">${label}</label><input class="${cls}" data-k="${k}" value="${esc(C[k] ?? '')}" ${attrs}></div>`;
  const title = () => `${isNew ? '🏠 ผู้เช่าเข้าใหม่ · ทำสัญญาเช่า' : '📝 สัญญาเช่า'} · ห้อง ${esc(C.room)}`;
  const box = openModal(`<style>${CSS}</style><h3 style="margin-bottom:6px" id="c-title">${title()}</h3>
    <div class="ctm"><div class="frm" id="cf">
      <label class="lang"><span><b>🌐 ผู้เช่าเป็นชาวต่างชาติ</b><small>เปิด = สัญญาภาษาอังกฤษ · อ่าน Passport แทนบัตรประชาชน</small></span>
        <span class="sw"><input type="checkbox" id="c-en" ${C.lang === 'en' ? 'checked' : ''}><span></span></span></label>
      <div class="sec"><h4>🪪 1. <span id="c-idt">${C.lang === 'en' ? 'Passport' : 'บัตรประชาชน'}</span> <small>อ่านด้วยตัวอ่านในเครื่อง (ฟรี) แล้วตรวจแก้ได้</small></h4>
        <div class="idbox" id="c-idbox"><div class="ph" id="c-ph">${t.idPhoto ? 'กำลังโหลด…' : 'ยังไม่มีรูป<br><small>ลากรูปมาวางที่กรอบนี้ได้</small>'}</div>
          <div style="flex:1"><div style="display:flex;gap:6px;flex-wrap:wrap"><label class="btn sm" for="c-idf">📎 แนบรูป</label><input id="c-idf" type="file" accept="image/*" hidden>
            <label class="btn sm" for="c-idc">📷 ถ่ายรูป</label><input id="c-idc" type="file" accept="image/*" capture="environment" hidden>
            <button class="btn sm" type="button" id="c-idedit" title="หมุน / ครอปรูป">✏️ ปรับรูป</button></div>
            <div class="msg" id="c-idmsg"></div></div></div>
        <div class="g2">
          <div class="full"><label class="l">🔐 รหัสเครื่องสแกนใบหน้า</label><input class="f-blue" data-k="faceCode" value="${esc(C.faceCode)}" placeholder="รหัสสำหรับลงทะเบียนสแกนใบหน้า"></div>
          <div class="full"><label class="l" id="c-nml">${C.lang === 'en' ? 'ชื่อ-นามสกุล (ภาษาอังกฤษ ตาม Passport)' : 'ชื่อ-นามสกุล ผู้เช่า (= ผู้ลงลายมือชื่อ)'}</label><input class="f-blue" data-k="tenantName" value="${esc(C.tenantName)}"></div>
          ${field('tenantId', C.lang === 'en' ? 'เลข Passport' : 'เลขบัตรประชาชน')}${field('phone', 'เบอร์โทร')}
          ${field('birthDate', 'วันเดือนปีเกิด', 'f-blue', `type="date" max="${todayIso()}"`)}
          <div class="full"><label class="l">ที่อยู่ (ตามบัตร)</label><input class="f-blue" data-k="address" value="${esc(C.address)}"></div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;border-top:1px dashed var(--line);padding-top:8px"><b style="font-size:13.5px">ผู้อาศัยร่วม <span class="note">(ไม่เกิน ${maxOcc} คน)</span></b><button class="btn sm" type="button" id="c-occadd">+ เพิ่มผู้อาศัย</button></div>
        <div id="c-occs"></div>
      </div>
      <div class="sec"><h4>🏠 2. รายละเอียดสัญญา <small>เติมจากข้อมูลผู้เช่าให้ก่อน แก้ได้</small></h4>
        <div class="g2">
          <div><label class="l">ห้อง</label>${isNew ? `<select class="f-red" id="c-room">${vacant.map(r => `<option ${r.id === C.room ? 'selected' : ''}>${r.id}</option>`).join('')}</select>` : `<input class="f-red" value="${esc(C.room)}" disabled>`}</div>
          ${field('date', 'วันที่ทำสัญญา', 'f-blue', 'type="date"')}
          <div><label class="l">จำนวนผู้พักอาศัย (คน)</label><input class="f-blue" id="c-occn" disabled><div class="auto">อัตโนมัติ: ผู้เช่า + ผู้อาศัยร่วม</div></div>
          ${field('minMonths', 'สัญญาขั้นต่ำ (เดือน)', 'f-red', 'inputmode="numeric"')}
          <div>${field('rent', 'ค่าเช่า/เดือน (บาท)', 'f-red', 'inputmode="numeric"').slice(5, -6)}<div class="auto" id="c-words"></div></div>
          ${field('firstMonth', 'ค่าเช่าเดือนแรก: เดือน', 'f-lblue', 'type="month"')}
          ${field('eRate', '⚡ ค่าไฟ (บาท/หน่วย)', 'f-blue', 'inputmode="decimal"')}${field('wRate', '💧 ค่าน้ำ (บาท/หน่วย)', 'f-blue', 'inputmode="decimal"')}
          <div class="full"><label class="l">4.1 คิดค่าเช่าเดือนแรกแบบ</label><div class="seg" id="c-mode"><button type="button" data-m="month">เต็มเดือน</button><button type="button" data-m="day">คิดรายวัน (ตามวันเข้าพัก)</button></div></div>
          <div class="dayrow">${field('moveIn', 'วันเข้าพัก', 'f-blue', 'type="date"').slice(5, -6)}</div>
          <div class="dayrow">${field('firstDays', 'จำนวนวัน', 'f-blue', 'inputmode="numeric"').slice(5, -6)}<div class="auto">อัตโนมัติ: ถึงสิ้นเดือน · แก้ได้</div></div>
          <div class="full">${field('firstAmount', '4.1 ค่าเช่าเดือนแรก (บาท)', 'f-blue', 'inputmode="numeric"').slice(5, -6)}<div class="auto" id="c-pro"></div></div>
          <div class="full">${field('depositNote', '4.2 ข้อความในวงเล็บ (ไม่บังคับ · ว่าง = เส้นไข่ปลา)').slice(5, -6)}</div>
          ${field('deposit', '4.2 ประกันความเสียหาย (บาท)', 'f-blue', 'inputmode="numeric"')}${field('clean', '4.3 ประกันความสะอาด (บาท)', 'f-blue', 'inputmode="numeric"')}
          ${field('fridgeDoors', '4.4 ตู้เย็น (ประตู)', 'f-blue', 'placeholder="ไม่มี"')}${field('fridgeFee', '4.4 ค่าเช่าตู้เย็น (บาท)', 'f-blue', 'inputmode="numeric"')}
          ${field('motoKeys', '4.5 กุญแจที่จอดมอไซค์ (ดอก)', 'f-blue', 'placeholder="ไม่มี"')}${field('plate', '4.5 ทะเบียนรถ')}
          ${field('motoFee', '4.5 ค่ากุญแจ (บาท)', 'f-blue', 'inputmode="numeric"')}
          <div><label class="l">กุญแจห้อง / ห้องน้ำ (ดอก)</label><div style="display:flex;gap:6px"><input class="f-blue" data-k="keyRoom" value="${esc(C.keyRoom)}"><input class="f-blue" data-k="keyBath" value="${esc(C.keyBath)}"></div></div>
          <div class="full"><div style="display:flex;justify-content:space-between;align-items:center"><label class="l" style="margin:0">ค่าเช่าอื่นๆ (4.6 เป็นต้นไป)</label><button class="btn sm" type="button" id="c-xadd">+ เพิ่มค่าเช่าอื่น</button></div><div id="c-xs"></div><div class="auto">เช่น ค่าที่จอดรถยนต์ · รวมในยอดข้อ 2 ให้อัตโนมัติ</div></div>
          ${field('meterE', 'มิเตอร์ไฟเริ่มต้น', 'f-orange', 'inputmode="numeric" placeholder="จดวันเข้าพัก"').slice(0, -6)}<div class="auto" id="c-m-meterE">แนบรูปมิเตอร์ไฟ (ข้อ 3) → อ่านเลขให้อัตโนมัติ</div></div>
          ${field('meterW', 'มิเตอร์น้ำเริ่มต้น', 'f-lblue', 'inputmode="numeric" placeholder="จดวันเข้าพัก"').slice(0, -6)}<div class="auto" id="c-m-meterW">แนบรูปมิเตอร์น้ำ (ข้อ 3) → อ่านเลขให้อัตโนมัติ</div></div>
          <div class="full"><label class="l">ยอดรวมวันทำสัญญา (ข้อ 2)</label><input class="f-red" id="c-total" disabled><div class="auto">อัตโนมัติ = 4.1 + 4.2 + 4.3 + 4.4 + 4.5 + ค่าเช่าอื่นๆ</div></div>
        </div>
      </div>
      <div class="sec"><h4>🖼️ 3. รูปแนบ <small>ไม่บังคับ · ลากรูปมาวางได้ · กดรูปเพื่อหมุน/ครอป · ใบตรวจสภาพห้องแนบให้อัตโนมัติ</small></h4>
        <div class="thumbs" id="c-ph3"></div>
        <input id="c-pf" type="file" accept="image/*" multiple hidden>
      </div>
      <p class="note" style="margin:0 0 8px">ช่องจอดรถ (เลือกช่อง/ทะเบียน) ค่าเช่าล่วงหน้า และหมายเหตุ แก้เพิ่มได้ที่ปุ่ม "แก้ไขผู้เช่า" ในผังห้อง</p>
      <div class="err" id="c-err"></div>
    </div>
    <div class="pv"><div class="zm" id="c-pv"><p class="note" style="padding:20px">กำลังสร้างตัวอย่างสัญญา…</p></div></div></div>
    <div class="form-acts">
      <button class="btn" id="c-x">ปิด</button><button class="btn" id="c-save">💾 บันทึก</button>
      <button class="btn" id="c-word">📄 Word</button><button class="btn" id="c-pdf">📕 PDF</button><button class="btn pri" id="c-print">🖨️ พิมพ์</button>
      <button class="btn line" id="c-line" ${M.lineLinkOf(C.room) ? '' : `title="ห้อง ${esc(C.room)} ยังไม่ผูก LINE OA"`}>💬 ส่ง LINE</button></div>`, { wide: true, sticky: true });
  box.style.maxWidth = '1320px'; box.style.width = '96vw';
  // ปุ่ม ✕ ปิด มุมขวาบน (ข้างปุ่มพิมพ์) — หน้าต่างนี้ปิดได้ด้วยปุ่มปิดเท่านั้น
  box.querySelector('.modal-print').style.right = '86px';
  box.querySelector('#c-title').style.paddingRight = '150px';
  box.insertAdjacentHTML('afterbegin', '<button type="button" id="c-xtop" title="ปิดหน้าต่าง" style="position:absolute;top:14px;right:14px;border:1px solid var(--line);background:#fff;border-radius:8px;padding:4px 10px;cursor:pointer;font-size:14px;line-height:1.2;z-index:2">✕ ปิด</button>');
  const q = s => box.querySelector(s);
  const inp = k => box.querySelector(`[data-k="${k}"]`);

  // ---------- รูป (แคชไว้แสดงตัวอย่าง) ----------
  // รูปที่ยังไม่บันทึกใช้ id ชั่วคราว (__new = บัตรผู้เช่า, __oN = บัตรผู้อาศัย) — ตัวสร้างเอกสารขอรูปผ่าน photoUrl
  const photoUrl = async id => {
    if (id === '__new') return newId || '';
    if (/^__o\d+$/.test(id)) return occs[+id.slice(3)]?._new || '';
    return cache[id] || newPhotos[id] || (cache[id] = await K.photoDataDb(id));
  };
  const tenantView = () => ({ ...t, idPhoto: newId ? '__new' : t.idPhoto, occupants: occs.filter(o => o.name || o.photo || o._new).map(o => ({ ...o, photo: o._new ? '__o' + occs.indexOf(o) : o.photo })) });
  const docOf = (forLine = false) => K.build(C, tenantView(), { forLine, getPhoto: photoUrl });

  // ---------- ตัวอย่างสัญญา ----------
  let pvTimer, pvSeq = 0;
  const preview = () => { clearTimeout(pvTimer); pvTimer = setTimeout(async () => {
    const seq = ++pvSeq, html = await K.pagesHtml(await docOf());
    if (seq === pvSeq && q('#c-pv')) q('#c-pv').innerHTML = `<style>${K.previewCss()}</style>${html}`;
  }, 350); };
  if (!document.getElementById('ct-font')) document.head.insertAdjacentHTML('beforeend', '<link id="ct-font" href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet">');

  // ---------- คำนวณ ----------
  const occCount = () => 1 + occs.filter(o => o.name || o.photo || o._new).length;
  const calc = () => {
    q('#c-occn').value = occCount(); C.occCount = String(occCount());
    const words = v => (C.lang === 'en' ? K.enWords(v) : bahtText(v));
    q('#c-total').value = `${K.total(C).toLocaleString('en-US')} บาท (${words(K.total(C))})`;
    q('#c-words').textContent = words(C.rent);
    box.querySelectorAll('.dayrow').forEach(d => d.hidden = C.mode !== 'day');
    box.querySelectorAll('#c-mode button').forEach(b => b.classList.toggle('on', b.dataset.m === C.mode));
    const p = C.mode === 'day' ? K.prorate(C.rent, C.moveIn) : null;
    q('#c-pro').textContent = C.mode === 'day' && p ? `${Number(C.rent).toLocaleString()} ÷ ${p.dim} วัน × ${C.firstDays || p.days} วัน ≈ ${Math.round(Number(C.rent) / p.dim * (Number(C.firstDays) || p.days)).toLocaleString()} บาท (แก้ได้)` : 'เต็มเดือน = ค่าเช่า 1 เดือน';
    preview();
  };
  const setVal = (k, v) => { C[k] = v; const el = inp(k); if (el) el.value = v; };
  const reprorate = () => { const p = K.prorate(C.rent, C.moveIn); if (!p) return; setVal('firstMonth', C.moveIn.slice(0, 7)); setVal('firstDays', String(p.days)); setVal('firstAmount', String(p.amount)); };

  q('#cf').addEventListener('input', e => {
    const k = e.target.dataset.k; if (!k) return;
    C[k] = e.target.value;
    if (k === 'rent') { if (!t.contract) setVal('deposit', C.rent); if (C.mode === 'month') setVal('firstAmount', C.rent); else reprorate(); }
    if (C.mode === 'day' && k === 'moveIn') reprorate();
    if (C.mode === 'day' && k === 'firstDays') { const p = K.prorate(C.rent, C.moveIn); if (p) setVal('firstAmount', String(Math.round(Number(C.rent) / p.dim * (Number(C.firstDays) || 0)))); }
    calc();
  });
  // ผู้เช่าเข้าใหม่: เปลี่ยนห้อง → ค่าเช่า ประกัน อัตราน้ำไฟ และเลขมิเตอร์ตามห้องใหม่
  q('#c-room')?.addEventListener('change', e => {
    const d = K.defaults({ ...t, room: e.target.value, rent: Number(db.get('rooms', e.target.value)?.rent) || 0, wRate: null, eRate: null });
    C.room = t.room = e.target.value;
    for (const k of ['rent', 'deposit', 'firstAmount', 'wRate', 'eRate', 'meterE', 'meterW']) setVal(k, String(d[k] ?? ''));
    if (C.mode === 'day') reprorate();
    q('#c-title').innerHTML = title();
    q('#c-line').title = M.lineLinkOf(C.room) ? '' : `ห้อง ${C.room} ยังไม่ผูก LINE OA`;
    calc();
  });
  box.querySelectorAll('#c-mode button').forEach(b => b.onclick = () => { C.mode = b.dataset.m; if (C.mode === 'day') reprorate(); else { setVal('firstDays', ''); setVal('firstAmount', C.rent); setVal('firstMonth', (C.moveIn || C.date).slice(0, 7)); } calc(); });
  q('#c-en').onchange = e => {
    C.lang = e.target.checked ? 'en' : 'th';
    q('#c-idt').textContent = C.lang === 'en' ? 'Passport' : 'บัตรประชาชน';
    q('#c-nml').textContent = C.lang === 'en' ? 'ชื่อ-นามสกุล (ภาษาอังกฤษ ตาม Passport)' : 'ชื่อ-นามสกุล ผู้เช่า (= ผู้ลงลายมือชื่อ)';
    inp('tenantId').previousElementSibling.textContent = C.lang === 'en' ? 'เลข Passport' : 'เลขบัตรประชาชน';
    calc();
  };

  // ---------- บัตรผู้เช่า: แนบ/ถ่าย → อ่านชื่อ เลขบัตร ----------
  const showIdThumb = url => { q('#c-ph').innerHTML = url ? `<img src="${url}" alt="">` : 'ยังไม่มีรูป'; };
  if (t.idPhoto) photoUrl(t.idPhoto).then(u => q('#c-ph') && showIdThumb(u));
  const readCard = async (url, onDone, msgEl) => {
    msgEl.textContent = '🔍 กำลังอ่านข้อมูลจากบัตร…';
    try {
      const r = await readIdDocument(url, p => { msgEl.textContent = `🔍 กำลังอ่านข้อมูลจากบัตร… ${p}%`; });
      if (!r) { msgEl.textContent = '⚠️ อ่านข้อมูลไม่ได้ — กรอกเอง (รูปควรชัด ไม่เอียง ไม่สะท้อนแสง)'; return; }
      onDone(r);
      msgEl.innerHTML = `✅ อ่านจาก${r.type === 'passport' ? ' Passport' : 'บัตรประชาชน'}แล้ว${r.type === 'thai-id' && r.idNo && !r.validId ? ' · <span style="color:var(--bad)">⚠️ เลขบัตรไม่ผ่านเลขตรวจสอบ</span>' : ''} — กรุณาตรวจทาน`;
    } catch (x) { msgEl.textContent = 'อ่านไม่สำเร็จ: ' + x.message + ' — กรอกเองได้'; }
  };
  // รูปใหม่ (เลือกไฟล์ / ถ่าย / ลากมาวาง) → ปรับรูป (หมุน ครอป) ก่อนใช้
  const pick = async (file, title) => editImage(await compress(await fileToDataUrl(file)), { title });
  const useId = url => {
    newId = url; showIdThumb(newId); preview();
    readCard(newId, r => {
      if (r.name) setVal('tenantName', r.name); if (r.idNo) setVal('tenantId', r.idNo);
      if (r.birthDate) setVal('birthDate', r.birthDate); if (r.address) setVal('address', r.address);
      if (r.type === 'passport' && r.nationality && r.nationality !== 'THA' && C.lang !== 'en') { q('#c-en').checked = true; q('#c-en').onchange({ target: q('#c-en') }); }
      calc();
    }, q('#c-idmsg'));
  };
  const onIdFile = async f => { if (!f) return; const u = await pick(f, 'ปรับรูปบัตรผู้เช่า'); if (u) useId(u); };
  q('#c-idf').onchange = e => { onIdFile(e.target.files[0]); e.target.value = ''; };
  q('#c-idc').onchange = e => { onIdFile(e.target.files[0]); e.target.value = ''; };
  dropZone(q('#c-idbox'), fs => onIdFile(fs[0]));
  q('#c-idedit').onclick = async () => {
    const cur = newId || (t.idPhoto ? await photoUrl(t.idPhoto) : '');
    if (!cur) return toast('ยังไม่มีรูปบัตร — แนบหรือลากรูปมาวางก่อน');
    const u = await editImage(cur, { title: 'ปรับรูปบัตรผู้เช่า' }); if (u) useId(u);
  };

  // ---------- ผู้อาศัยร่วม ----------
  const drawOccs = () => {
    q('#c-occs').innerHTML = occs.map((o, i) => `<div class="idbox" data-odrop="${i}" style="margin-top:8px"><div class="ph" data-oph="${i}">${o._new ? `<img src="${o._new}">` : o.photo ? '…' : `ผู้อาศัย ${i + 1}<br><small>ลากรูปมาวาง</small>`}</div>
      <div style="flex:1"><input class="f-blue" data-on="${i}" value="${esc(o.name)}" placeholder="ชื่อผู้อาศัย ${i + 1}">
        <input class="f-blue" data-ofc="${i}" value="${esc(o.faceCode || '')}" placeholder="🔐 รหัสเครื่องสแกนใบหน้า" style="margin-top:6px">
        <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap"><label class="btn sm" for="c-of${i}">📎 แนบบัตร</label><input id="c-of${i}" data-of="${i}" type="file" accept="image/*" hidden>
        <label class="btn sm" for="c-oc${i}">📷</label><input id="c-oc${i}" data-of="${i}" type="file" accept="image/*" capture="environment" hidden>
        <button class="btn sm" type="button" data-oed="${i}" title="หมุน / ครอปรูป">✏️ ปรับรูป</button>
        <button class="btn sm" type="button" data-orm="${i}" title="ลบ">✕</button></div><div class="msg" data-omsg="${i}"></div></div></div>`).join('');
    occs.forEach((o, i) => { if (o.photo && !o._new) photoUrl(o.photo).then(u => { const el = q(`[data-oph="${i}"]`); if (el && u) el.innerHTML = `<img src="${u}">`; }); });
    box.querySelectorAll('[data-on]').forEach(x => x.oninput = () => { occs[+x.dataset.on].name = x.value; calc(); });
    box.querySelectorAll('[data-ofc]').forEach(x => x.oninput = () => { occs[+x.dataset.ofc].faceCode = x.value; calc(); });
    box.querySelectorAll('[data-orm]').forEach(x => x.onclick = () => { occs.splice(+x.dataset.orm, 1); drawOccs(); calc(); });
    const useOcc = (i, url) => {
      occs[i]._new = url; drawOccs(); calc();
      readCard(url, r => { if (r.name) occs[i].name = r.name; if (r.idNo) occs[i].idNo = r.idNo; const n = q(`[data-on="${i}"]`); if (n) n.value = occs[i].name; calc(); }, q(`[data-omsg="${i}"]`));
    };
    const onOccFile = async (i, f) => { if (!f) return; const u = await pick(f, `ปรับรูปบัตรผู้อาศัย ${i + 1}`); if (u) useOcc(i, u); };
    box.querySelectorAll('[data-of]').forEach(x => x.onchange = e => { onOccFile(+x.dataset.of, e.target.files[0]); e.target.value = ''; });
    box.querySelectorAll('[data-odrop]').forEach(x => dropZone(x, fs => onOccFile(+x.dataset.odrop, fs[0])));
    box.querySelectorAll('[data-oed]').forEach(x => x.onclick = async () => {
      const i = +x.dataset.oed, o = occs[i], cur = o._new || (o.photo ? await photoUrl(o.photo) : '');
      if (!cur) return toast('ยังไม่มีรูปบัตร — แนบหรือลากรูปมาวางก่อน');
      const u = await editImage(cur, { title: `ปรับรูปบัตรผู้อาศัย ${i + 1}` }); if (u) useOcc(i, u);
    });
    q('#c-occadd').disabled = occs.length >= maxOcc;
  };
  q('#c-occadd').onclick = () => { if (occs.length < maxOcc) { occs.push({ name: '', idNo: '', photo: null }); drawOccs(); } };
  drawOccs();

  // ---------- ค่าเช่าอื่นๆ ----------
  const drawExtras = () => {
    q('#c-xs').innerHTML = C.extras.map((x, i) => `<div class="xrow"><input class="f-blue" data-xn="${i}" value="${esc(x.name)}" placeholder="ชื่อรายการ เช่น ค่าที่จอดรถยนต์"><input class="f-blue" data-xa="${i}" value="${esc(x.amt)}" placeholder="บาท" inputmode="numeric"><button class="btn sm" type="button" data-xr="${i}" style="color:var(--bad)">✕</button></div>`).join('');
    box.querySelectorAll('[data-xn]').forEach(x => x.oninput = () => { C.extras[+x.dataset.xn].name = x.value; calc(); });
    box.querySelectorAll('[data-xa]').forEach(x => x.oninput = () => { C.extras[+x.dataset.xa].amt = x.value.replace(/[^\d.]/g, ''); calc(); });
    box.querySelectorAll('[data-xr]').forEach(x => x.onclick = () => { C.extras.splice(+x.dataset.xr, 1); drawExtras(); calc(); });
  };
  q('#c-xadd').onclick = () => { C.extras.push({ name: '', amt: '' }); drawExtras(); box.querySelector(`[data-xn="${C.extras.length - 1}"]`)?.focus(); };
  drawExtras();

  // ---------- รูปแนบ: มิเตอร์ไฟ / มิเตอร์น้ำ / รูปอื่นๆ ----------
  const SLOTS = [['meterE', '⚡', 'มิเตอร์ไฟ'], ['meterW', '💧', 'มิเตอร์น้ำ'], ['fridge', FRIDGE, 'ตู้เย็น']];
  let pickFor = null;
  const drawPhotos = async () => {
    const byTag = tag => C.photos.find(p => p.tag === tag);
    const others = C.photos.filter(p => !SLOTS.some(s => s[0] === p.tag));
    const cell = (p, icon, label, tag) => `<div class="t"><div class="im ${p ? '' : 'add'}" data-pick="${tag}" ${tag === 'fridge' && !p ? 'style="background:#fff1e8"' : ''}>${p ? `<img data-pimg="${p.id}"><button type="button" class="rm" data-prm="${p.id}">✕</button>` : icon}</div>${label}</div>`;
    q('#c-ph3').innerHTML = SLOTS.map(([tag, icon, label]) => cell(byTag(tag), icon, label, tag)).join('') + others.map(p => cell(p, '', p.label || 'รูป', 'x')).join('') + `<div class="t"><div class="im add" data-pick="other">+ เพิ่ม</div>รูปอื่นๆ</div>`;
    for (const img of box.querySelectorAll('[data-pimg]')) img.src = await photoUrl(img.dataset.pimg);
    box.querySelectorAll('[data-pick]').forEach(x => x.onclick = async e => {
      if (e.target.closest('[data-prm]')) return;
      const img = x.querySelector('img[data-pimg]');
      if (img) {   // กดรูปที่มีอยู่ → ปรับรูป (หมุน / ครอป) แล้วแทนรูปเดิม
        const u = await editImage(img.src, { title: 'ปรับรูปแนบ' }); if (!u) return;
        const old = C.photos.find(p => p.id === img.dataset.pimg), id = uid('ct-');
        newPhotos[id] = u; delete newPhotos[old.id]; old.id = id; drawPhotos(); preview();
        if (old.tag === 'meterE' || old.tag === 'meterW') runMeter(old.tag, u);
        return;
      }
      pickFor = x.dataset.pick; q('#c-pf').multiple = pickFor === 'other'; q('#c-pf').click();
    });
    box.querySelectorAll('[data-prm]').forEach(x => x.onclick = e => { e.stopPropagation(); C.photos = C.photos.filter(p => p.id !== x.dataset.prm); delete newPhotos[x.dataset.prm]; drawPhotos(); preview(); });
  };
  const LBL = { meterE: 'มิเตอร์ไฟ', meterW: 'มิเตอร์น้ำ', fridge: 'ตู้เย็น' };
  const addPhotos = async files => {
    for (const f of files) {
      const id = uid('ct-'), url = await pick(f, `ปรับรูปแนบ${LBL[pickFor] ? ' · ' + LBL[pickFor] : ''}`);
      if (!url) continue;
      newPhotos[id] = url;
      if (pickFor !== 'other') C.photos = C.photos.filter(p => p.tag !== pickFor);
      const item = { id, tag: pickFor === 'other' ? '' : pickFor, label: LBL[pickFor] || '' };
      // รูปมิเตอร์ไว้ก่อนรูปอื่น
      pickFor === 'other' ? C.photos.push(item) : C.photos.splice(['meterE', 'meterW', 'fridge'].indexOf(pickFor), 0, item);
      if (pickFor === 'meterE' || pickFor === 'meterW') runMeter(pickFor, url);
    }
    drawPhotos(); preview();
  };
  // อ่านเลขมิเตอร์จากรูป → ใส่ในช่องให้ (แก้ได้) · เทียบกับเลขครั้งก่อนของห้อง
  // ปกติอ่านด้วยตัวอ่านฟรีในเครื่อง · ปุ่ม "ให้ Claude อ่าน" (มีค่าใช้จ่าย) แสดงเฉพาะเมื่อเปิดไว้ในตั้งค่า และกดเองเท่านั้น
  const prevMeter = { meterE: C.meterE, meterW: C.meterW }, meterSeq = {}, meterUrl = {};
  const aiBtn = tag => (M.property().claudeSlip && canUseClaude()
    ? ` <button type="button" class="btn sm" data-mai="${tag}" title="แม่นกว่า มีค่าใช้จ่ายเล็กน้อยต่อรูป">🤖 ให้ Claude อ่าน</button>` : '');
  const runMeter = async (tag, url, ai = false) => {
    meterUrl[tag] = url;
    const st = q(`#c-m-${tag}`), seq = meterSeq[tag] = (meterSeq[tag] || 0) + 1, before = String(C[tag] ?? '');
    if (st) st.innerHTML = ai ? '🤖 Claude กำลังอ่านเลขมิเตอร์…' : '🔍 กำลังอ่านเลขมิเตอร์จากรูป (ฟรี)…';
    let r;
    try { r = await readMeter(url, tag === 'meterE' ? 'electric' : 'water', { ai }); }
    catch (e) { if (seq === meterSeq[tag] && st) { st.innerHTML = `อ่านเลขไม่สำเร็จ (${esc(e.message)}) — กรุณากรอกเอง${aiBtn(tag)}`; bindAi(); } return; }
    if (seq !== meterSeq[tag] || !q(`#c-m-${tag}`)) return;
    if (r.notMeter) { st.innerHTML = '<span style="color:#b45309">⚠️ รูปนี้ไม่น่าจะเป็นมิเตอร์ — กรุณาตรวจรูปหรือกรอกเอง</span>'; return; }
    if (!r.reading) { st.innerHTML = `<span style="color:#b45309">อ่านเลขจากรูปไม่ออก — กรุณากรอกเอง</span>${ai ? '' : aiBtn(tag)}`; bindAi(); return; }
    if (String(C[tag] ?? '') !== before) { st.innerHTML = `อ่านจากรูปได้ <b>${esc(r.reading)}</b> — ไม่ได้ใส่ให้ เพราะแก้ช่องนี้ระหว่างอ่าน`; return; }
    setVal(tag, r.reading); dirty = true; preview();
    const prev = Number(prevMeter[tag]), hasPrev = prevMeter[tag] !== '' && Number.isFinite(prev), v = Number(r.reading);
    const low = hasPrev && v < prev, high = hasPrev && v > prev * 2 + 1000;
    st.innerHTML = `${ai ? '🤖' : '🔍'} อ่านจากรูปได้ <b>${esc(r.reading)}</b> ${ai ? '(Claude)' : '(ตัวอ่านฟรีในเครื่อง)'} · <b>ตรวจกับรูปแล้วแก้ได้</b>${ai ? '' : aiBtn(tag)}`
      + (r.unclear && ai ? '<br><span style="color:#b45309">⚠️ บางหลักไม่ชัด กรุณาตรวจ</span>' : '')
      + (low ? `<br><span style="color:#c00">⚠️ น้อยกว่าเลขครั้งก่อนของห้องนี้ (${esc(prevMeter[tag])}) — ตรวจอีกครั้ง</span>` : '')
      + (high ? `<br><span style="color:#c00">⚠️ สูงกว่าเลขครั้งก่อนของห้องนี้ (${esc(prevMeter[tag])}) มากผิดปกติ — ตรวจอีกครั้ง</span>` : '');
    bindAi();
  };
  const bindAi = () => box.querySelectorAll('[data-mai]').forEach(b => b.onclick = () => meterUrl[b.dataset.mai] && runMeter(b.dataset.mai, meterUrl[b.dataset.mai], true));
  q('#c-pf').onchange = async e => { const fs = [...e.target.files]; e.target.value = ''; await addPhotos(fs); };
  // ลากรูปมาวางที่ช่องรูปแนบ: วางบนช่องมิเตอร์/ตู้เย็น = ใส่ช่องนั้น · วางที่อื่น = รูปอื่นๆ
  dropZone(q('#c-ph3'), fs => addPhotos(fs));
  q('#c-ph3').addEventListener('drop', e => { pickFor = e.target.closest('[data-pick]')?.dataset.pick; if (!pickFor || pickFor === 'x') pickFor = 'other'; }, true);
  drawPhotos();

  // ---------- บันทึก ----------
  const save = async () => {
    if (!String(C.tenantName).trim()) { q('#c-err').textContent = 'กรุณากรอกชื่อผู้เช่า'; q('[data-k=tenantName]').focus(); return false; }
    if (isNew && M.tenantOf(C.room)) { q('#c-err').textContent = `ห้อง ${C.room} มีผู้เช่าแล้ว กรุณาเลือกห้องอื่น`; return false; }
    const rec = { ...db.get('tenants', t.id) || t, room: C.room };
    if (newId) {
      const pid = uid('id-');
      await db.putPhoto({ id: pid, dataUrl: newId, name: `${rec.room}-${C.tenantName}-บัตรประชาชน.jpg`, tenantId: rec.id, createdAt: new Date().toISOString() });
      await db.queue({ kind: 'photo', photoId: pid }); rec.idPhoto = pid; cache[pid] = newId; newId = null;
    }
    const outOcc = [];
    for (const o of occs) {
      if (!o.name && !o.photo && !o._new) continue;
      const { _new, ...rest } = o;
      if (_new) { rest.photo = uid('id-'); cache[rest.photo] = _new;
        await db.putPhoto({ id: rest.photo, dataUrl: _new, name: `${rec.room}-${o.name || 'ผู้พัก'}-บัตร.jpg`, tenantId: rec.id, createdAt: new Date().toISOString() });
        await db.queue({ kind: 'photo', photoId: rest.photo }); }
      outOcc.push({ ...rest, name: String(rest.name || '').trim(), idNo: String(rest.idNo || '').trim() });
    }
    occs = outOcc.map(o => ({ ...o }));
    for (const [id, url] of Object.entries(newPhotos)) {
      const p = C.photos.find(x => x.id === id); if (!p) continue;
      await db.putPhoto({ id, dataUrl: url, name: `${rec.room}-สัญญา-${p.label || 'รูป'}.jpg`, tenantId: rec.id, createdAt: new Date().toISOString() });
      await db.queue({ kind: 'photo', photoId: id, folder: 'contract' }); cache[id] = url; delete newPhotos[id];
    }
    // ข้อมูลในสัญญาที่ตรงกับข้อมูลผู้เช่า → อัปเดตผู้เช่าให้ตรงกัน
    Object.assign(rec, { name: C.tenantName.trim(), idNo: String(C.tenantId).trim(), phone: String(C.phone).trim(), faceCode: String(C.faceCode || '').trim(), lang: C.lang,
      occupants: outOcc, rent: Number(C.rent) || 0, deposit: Number(C.deposit) || 0, fridge: Number(C.fridgeFee) || 0,
      birthDate: C.birthDate || '', address: String(C.address || '').trim(),
      wRate: C.wRate === '' ? null : Number(C.wRate), eRate: C.eRate === '' ? null : Number(C.eRate),
      contract: { ...C, savedAt: new Date().toISOString() } });
    if (isNew) {
      // ผู้เช่าเข้าใหม่: วันเข้าพัก = วันเข้าพักในสัญญา · ค่าที่จอดรายเดือนจากรายการ "ค่าที่จอด…" ในค่าเช่าอื่นๆ
      rec.active = true; rec.since = C.moveIn || C.date;
      rec.parkingFee = C.extras.filter(x => /จอด|park/i.test(x.name)).reduce((a, x) => a + (Number(x.amt) || 0), 0);
    }
    await db.put('tenants', rec); t = rec; drawOccs();
    if (isNew) {
      isNew = false; q('#c-title').innerHTML = title();
      const sel = q('#c-room'); if (sel) sel.disabled = true;
      toast(`บันทึกผู้เช่าห้อง ${rec.room} แล้ว`);
    }
    q('#c-err').textContent = '';
    dirty = false;
    return true;
  };
  const busy = async (btn, label, fn) => {
    const old = btn.textContent; btn.disabled = true; btn.textContent = label;
    try { if (await save()) await fn(); } catch (e) { toast('ทำไม่สำเร็จ: ' + e.message, 5000); } finally { if (btn.isConnected) { btn.disabled = false; btn.textContent = old; } }
  };
  // ปิด: ถ้ามีข้อมูลที่ยังไม่บันทึก ถามก่อน (ซ้อนบนหน้าต่าง ไม่ปิดฟอร์มทิ้ง)
  let dirty = false;
  q('#cf').addEventListener('input', () => { dirty = true; });
  q('#cf').addEventListener('change', () => { dirty = true; });
  q('#c-x').onclick = () => {
    if (dirty || newId || Object.keys(newPhotos).length || occs.some(o => o._new)) {
      if (!window.confirm('ยังไม่ได้บันทึกข้อมูลในหน้าต่างนี้\nปิดโดยไม่บันทึกใช่ไหม?')) return;
    }
    closeModal(); done?.();
  };
  q('#c-xtop').onclick = () => q('#c-x').onclick();
  q('#c-save').onclick = () => busy(q('#c-save'), 'กำลังบันทึก…', async () => toast('บันทึกสัญญาแล้ว'));
  q('#c-print').onclick = () => busy(q('#c-print'), 'กำลังเตรียม…', async () => K.printContract(await docOf()));
  q('#c-pdf').onclick = () => busy(q('#c-pdf'), 'กำลังสร้าง PDF…', async () => { const pdf = await K.contractPdf(await docOf()); K.download(pdf.output('blob'), K.fileName(C, 'pdf')); toast('ดาวน์โหลด PDF แล้ว'); });
  q('#c-word').onclick = () => busy(q('#c-word'), 'กำลังสร้าง Word…', async () => { K.download(await K.contractDocx(await docOf()), K.fileName(C, 'docx')); toast('ดาวน์โหลดไฟล์ Word แล้ว'); });
  q('#c-line').onclick = () => busy(q('#c-line'), 'กำลังส่ง LINE…', async () => {
    const r = await K.sendContractLine(C, tenantView(), photoUrl);
    const rec = db.get('tenants', t.id); await db.put('tenants', { ...rec, contract: { ...rec.contract, lineSentAt: new Date().toISOString(), pdfUrl: r.pdfUrl || '' } });
    toast(r.sent ? `ส่งสัญญาเข้า LINE ห้อง ${C.room} แล้ว` : `ห้อง ${C.room} ยังไม่ผูก LINE OA — เก็บ PDF ไว้ใน Drive แล้ว`, 4000);
  });
  calc();
}
