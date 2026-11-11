// หน้าต่างกรอกใบตรวจสภาพห้อง + จัดรูปแนบ (เปิดจากหน้าต่างสัญญาเช่า) — กรอกบนหน้าเอกสารจริง
// 1. พิมพ์ข้อความบนเส้นไข่ปลา · กดบนผังห้องเพื่อมาร์ค ✕ สีแดง (กดซ้ำที่ ✕ เพื่อลบ)
// 2. ติ๊ก ปกติ / ไม่ปกติ และพิมพ์รายละเอียด
// 3. รูปแนบวางอิสระ: ลากรูปย้ายที่ (ข้ามหน้าได้) · ลากมุมขวาล่างย่อ/ขยาย · พิมพ์คำอธิบายใต้ภาพ · เพิ่มหน้า · จัดอัตโนมัติ
// แถบซูม − / + ปรับขนาดการแสดงผล (จำค่าไว้ในเครื่อง)
import * as K from '../core/contract.js';

const CSS = `
.ins-ov{position:fixed;inset:0;z-index:900;background:rgba(15,23,42,.62);display:flex;align-items:center;justify-content:center;padding:1.5vh 1vw}
.ins-box{background:#fff;border-radius:12px;display:flex;flex-direction:column;width:min(1100px,100%);height:97vh;box-shadow:0 10px 40px rgba(0,0,0,.35);overflow:hidden;position:relative}
.ins-hd{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid #e3e8ee;flex-wrap:wrap}
.ins-hd h3{margin:0;font-size:16px;flex:1;min-width:200px}
.ins-tip{font-size:12.5px;color:#46586a;padding:6px 14px;background:#f6f9fc;border-bottom:1px solid #e3e8ee;line-height:1.6}
.ins-tip b{color:#1f4e79}
.ins-bd{overflow:auto;background:#e9edf2;padding:8px 8px 70px;flex:1}
.ins-zm{position:absolute;right:18px;bottom:16px;z-index:5;display:flex;align-items:center;gap:8px;background:#fff;border-radius:22px;padding:6px 14px;box-shadow:0 2px 10px rgba(0,0,0,.18)}
.ins-zm button{border:0;background:none;font-size:18px;width:28px;height:28px;border-radius:50%;cursor:pointer;line-height:1}
.ins-zm button:hover{background:#eef2f6}
.ins-zm input{width:130px;accent-color:#2b3a8c}
.ins-zm span{min-width:44px;text-align:right;font-size:13.5px;color:#333}
.ins-bd .ct-pg{overflow:visible}
.ins-bd img[data-room]{cursor:crosshair;outline:2px dashed rgba(238,0,0,.35);outline-offset:3px}
.ins-bd img[data-room]:hover{outline-color:#e00}
.ins-bd .ck[data-ck]{cursor:pointer;border-radius:4px;padding:0 3px;margin:0 -3px}
.ins-bd .ck[data-ck]:hover{background:#fff1c2}
.ins-bd .ct-free{outline:1.5px dashed #a9bccd;outline-offset:1px}
.ins-bd .ct-free.on{outline:2px solid #1f5f8b;background:rgba(31,95,139,.05)}
.ins-bd .ct-fp{cursor:move;touch-action:none}
.ins-bd .ct-fp:hover .ct-fim{outline:2px solid #4a90c8}
.ins-bd .ct-fp.drag{z-index:50;opacity:.85}.ins-bd .ct-fp.drag .ct-fim{outline:2px solid #1f5f8b;box-shadow:0 6px 18px rgba(0,0,0,.3)}
.ins-bd .ct-rs{position:absolute;right:-11px;bottom:-11px;width:22px;height:22px;background:#1f5f8b;border:2px solid #fff;border-radius:3px;cursor:nwse-resize;box-shadow:0 1px 3px rgba(0,0,0,.4)}
.ins-bd .ct-pgno{font-size:12px;color:#5a6c7e;text-align:right;margin:2px 0 -6px}
`;
const ZKEY = 'mappms.inspZoom';

export function openInspect({ C, docOf, onChange }) {
  C.insp = K.inspOf(C);
  const I = C.insp;
  const ov = document.createElement('div');
  ov.className = 'ins-ov';
  ov.innerHTML = `<style>${CSS}</style><div class="ins-box" role="dialog" aria-label="กรอกใบตรวจสภาพห้อง">
    <div class="ins-hd"><h3>📋 ใบตรวจสภาพห้อง · รูปแนบ — ห้อง ${C.room}</h3>
      <button class="btn sm" type="button" data-auto title="วางรูปทั้งหมดใหม่ หน้าละ 4 รูป">↺ จัดรูปอัตโนมัติ</button>
      <button class="btn sm" type="button" data-addpg title="เพิ่มหน้ารูปแนบว่าง แล้วลากรูปไปวาง">+ เพิ่มหน้ารูป</button>
      <button class="btn pri" type="button" data-done>✔ เสร็จ</button></div>
    <div class="ins-tip">✍️ <b>พิมพ์บนเส้นไข่ปลา</b> (ช่องสีเหลือง) · ✕ <b>กดบนผังห้อง</b> เพื่อมาร์คจุดที่ไม่ปกติ (กดที่ ✕ ซ้ำเพื่อลบ) · ☑ <b>กดที่ช่อง</b> ปกติ / ไม่ปกติ ·
      🖼️ <b>ลากรูปไปวางตรงไหนก็ได้</b> (ข้ามหน้าได้) · <b>ลากมุม ◢ สีน้ำเงิน</b> เพื่อย่อ/ขยาย · พิมพ์คำอธิบายใต้ภาพ — บันทึกพร้อมสัญญาเมื่อกด 💾 บันทึก</div>
    <div class="ins-bd"><p style="padding:20px;color:#5a6c7e">กำลังโหลด…</p></div>
    <div class="ins-zm"><button type="button" data-z="-1" title="ย่อ">−</button><input type="range" min="40" max="200" step="5" aria-label="ซูม"><button type="button" data-z="1" title="ขยาย">+</button><span></span></div></div>`;
  document.body.appendChild(ov);
  const bd = ov.querySelector('.ins-bd'), zr = ov.querySelector('.ins-zm input'), zt = ov.querySelector('.ins-zm span');
  let timer;
  const changed = (structural = false) => { clearTimeout(timer); timer = setTimeout(() => onChange?.(structural), structural ? 0 : 300); };

  // ---------- ซูม: 100% = ขนาดกระดาษจริง · ครั้งแรกพอดีความกว้างหน้าต่าง ----------
  let zoom = 0;
  try { zoom = Number(localStorage.getItem(ZKEY)) || 0; } catch {}
  const fitZoom = () => Math.round(Math.min(150, Math.max(40, (bd.clientWidth - 30) / 794 * 100)) / 5) * 5;
  const applyZoom = z => {
    zoom = Math.min(200, Math.max(40, Math.round(z)));
    zr.value = zoom; zt.textContent = zoom + '%';
    const pg = bd.querySelector('.ins-pg'); if (pg) pg.style.zoom = zoom / 100;
  };
  const setZoom = z => { applyZoom(z); try { localStorage.setItem(ZKEY, String(zoom)); } catch {} };
  zr.oninput = () => setZoom(+zr.value);
  ov.querySelectorAll('[data-z]').forEach(b => b.onclick = () => setZoom(zoom + 10 * +b.dataset.z));
  bd.addEventListener('wheel', e => { if (!e.ctrlKey) return; e.preventDefault(); setZoom(zoom + (e.deltaY < 0 ? 10 : -10)); }, { passive: false });

  const render = async () => {
    const st = bd.scrollTop;
    const html = await K.pagesHtml(await docOf(), { edit: true, only: ['insp', 'att'] });
    bd.innerHTML = `<style>${K.previewCss()}</style><div class="ins-pg">${html}</div>`;
    // เลขหน้ารูปแนบ (ช่วยตอนลากข้ามหน้า)
    const fr = [...bd.querySelectorAll('.ct-free')];
    fr.forEach((a, i) => a.closest('.ct-pg')?.querySelector('.ct-atttl')?.insertAdjacentHTML('beforebegin', `<div class="ct-pgno">หน้ารูปแนบ ${i + 1}/${fr.length}${a.children.length ? '' : ' · หน้าว่าง (ไม่พิมพ์ออกจนกว่าจะมีรูป)'}</div>`));
    applyZoom(zoom || fitZoom()); bd.scrollTop = st;
  };
  render();

  // ---------- ข้อความ ----------
  const setPath = (path, v) => {
    const [a, b, c] = path.split('.');
    if (a === 'item10') I.item10 = v;
    else if (a === 'it') I.items[+b].l[+c] = v;
    else if (I[a]) I[a][+b] = v;
  };
  bd.addEventListener('input', e => {
    const el = e.target;
    if (el.dataset.ip) { setPath(el.dataset.ip, el.value); changed(); }
    else if (el.dataset.cap != null) { const p = C.photos[+el.dataset.cap]; if (p) { p.label = el.value; p.custom = 1; changed(); } }
  });
  bd.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || !e.target.matches('input.ct-in')) return;
    e.preventDefault();
    const all = [...bd.querySelectorAll('input.ct-in')], i = all.indexOf(e.target);
    all[i + 1]?.focus();
  });

  // ---------- ติ๊ก / มาร์ค ✕ ----------
  const syncTicks = () => bd.querySelectorAll('[data-ck]').forEach(s => {
    const on = s.dataset.ck === 'ph' ? I.phase === s.dataset.v : I.items[+s.dataset.i].s === s.dataset.v;
    s.querySelector('.ct-box')?.classList.toggle('t', on);
  });
  bd.addEventListener('click', e => {
    const ck = e.target.closest('[data-ck]');
    if (ck) {
      if (ck.dataset.ck === 'ph') I.phase = ck.dataset.v;
      else { const it = I.items[+ck.dataset.i]; it.s = it.s === ck.dataset.v ? '' : ck.dataset.v; }
      syncTicks(); changed(); return;
    }
    const img = e.target.closest('img[data-room]');
    if (img) {
      const key = img.dataset.room, def = K.ROOMS[key], r = img.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width * (def[0] + 4), y = (e.clientY - r.top) / r.height * (def[1] + 4);
      const ms = I.marks[key], near = ms.findIndex(([a, b]) => Math.hypot(a - x, b - y) < 9);
      if (near >= 0) ms.splice(near, 1); else ms.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
      img.src = K.roomPng(def, ms); changed();
    }
  });

  // ---------- รูปแนบวางอิสระ ----------
  const areas = () => [...bd.querySelectorAll('.ct-free')];
  // ครั้งแรกที่ย้ายรูป: ตรึงตำแหน่งที่จัดอัตโนมัติไว้ทุกรูป (รูปอื่นจะไม่ขยับตาม)
  const freeze = () => {
    bd.querySelectorAll('.ct-fp[data-pi]').forEach(f => {
      const p = C.photos[+f.dataset.pi];
      if (p && !p.lay) p.lay = { pg: +f.dataset.pg, x: +f.dataset.x, y: +f.dataset.y, w: +f.dataset.w };
    });
    C.attPages = Math.max(Number(C.attPages) || 0, areas().length);
  };
  const r1 = v => Math.round(v * 10) / 10;
  let drag = null;
  bd.addEventListener('pointerdown', e => {
    const f = e.target.closest('.ct-fp[data-pi]');
    if (!f || e.button !== 0 || e.target.matches('input')) return;
    e.preventDefault();
    const area = f.parentElement, k = area.getBoundingClientRect().width / K.AREA_W, fr = f.getBoundingClientRect();
    drag = { f, pi: +f.dataset.pi, k, resize: !!e.target.closest('.ct-rs'), sx: e.clientX, sy: e.clientY,
      x0: +f.dataset.x, y0: +f.dataset.y, w0: +f.dataset.w, ar: +f.dataset.ar, offX: (e.clientX - fr.left) / k, offY: (e.clientY - fr.top) / k, moved: false };
    f.setPointerCapture(e.pointerId); f.classList.add('drag');
  });
  const areaAt = y => { let best = null, bd0 = Infinity; for (const a of areas()) { const r = a.getBoundingClientRect(), d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0; if (d < bd0) { bd0 = d; best = a; } } return best; };
  bd.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = (e.clientX - drag.sx) / drag.k, dy = (e.clientY - drag.sy) / drag.k;
    if (Math.abs(dx) + Math.abs(dy) > 0.5) drag.moved = true;
    if (drag.resize) drag.f.style.width = Math.min(K.AREA_W - drag.x0, Math.max(20, drag.w0 + dx)) + 'mm';
    else {
      drag.f.style.left = drag.x0 + dx + 'mm'; drag.f.style.top = drag.y0 + dy + 'mm';
      const a = areaAt(e.clientY); areas().forEach(x => x.classList.toggle('on', x === a));
    }
    // เลื่อนหน้าจออัตโนมัติเมื่อลากใกล้ขอบบน/ล่าง
    const br = bd.getBoundingClientRect();
    if (e.clientY > br.bottom - 40) bd.scrollTop += 14; else if (e.clientY < br.top + 40) bd.scrollTop -= 14;
  });
  const endDrag = e => {
    if (!drag) return;
    const d = drag; drag = null;
    areas().forEach(x => x.classList.remove('on'));
    if (!d.moved) { d.f.classList.remove('drag'); d.f.style.left = d.x0 + 'mm'; d.f.style.top = d.y0 + 'mm'; d.f.style.width = d.w0 + 'mm'; return; }
    freeze();
    const p = C.photos[d.pi]; if (!p) return render();
    if (d.resize) {
      const w = Math.min(K.AREA_W - d.x0, Math.max(20, d.w0 + (e.clientX - d.sx) / d.k));
      p.lay = { ...p.lay, w: r1(w) };
    } else {
      const a = areaAt(e.clientY), r = a.getBoundingClientRect(), k = r.width / K.AREA_W, H = +a.dataset.h, h = d.w0 * d.ar + K.CAP;
      const x = (e.clientX - r.left) / k - d.offX, y = (e.clientY - r.top) / k - d.offY;
      p.lay = { pg: +a.dataset.pg, w: d.w0, x: r1(Math.min(K.AREA_W - d.w0, Math.max(0, x))), y: r1(Math.min(Math.max(0, H - h), Math.max(0, y))) };
    }
    changed(true); render();
  };
  bd.addEventListener('pointerup', endDrag);
  bd.addEventListener('pointercancel', endDrag);

  ov.querySelector('[data-addpg]').onclick = () => { freeze(); C.attPages = areas().length + 1; changed(true); render().then(() => { const a = areas().at(-1); a?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }); };
  ov.querySelector('[data-auto]').onclick = () => {
    if (!window.confirm('จัดรูปแนบทั้งหมดใหม่ (หน้าละ 4 รูป)?\nตำแหน่งและขนาดที่จัดไว้จะหายไป · คำอธิบายใต้ภาพยังอยู่')) return;
    (C.photos || []).forEach(p => delete p.lay); delete C.attPages; changed(true); render();
  };

  return new Promise(res => {
    const close = () => { clearTimeout(timer); onChange?.(true); document.removeEventListener('keydown', esc, true); ov.remove(); res(); };
    const esc = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', esc, true);
    ov.querySelector('[data-done]').onclick = close;
  });
}

// สรุปสั้นๆ แสดงในหน้าต่างสัญญา
export function inspSummary(C) {
  const I = K.inspOf(C);
  const marks = I.marks.bed.length + I.marks.bath.length + I.marks.bal.length;
  const ng = I.items.filter(x => x.s === 'ng').length, ok = I.items.filter(x => x.s === 'ok').length;
  const txt = [...I.bed, ...I.bath, ...I.bal, ...I.items.flatMap(x => x.l)].filter(s => s.trim()).length;
  const caps = (C.photos || []).filter(p => p.custom && String(p.label || '').trim()).length;
  const moved = (C.photos || []).some(p => p.lay);
  if (!marks && !ng && !ok && !txt && !caps && !moved) return 'ยังไม่ได้กรอก — ว่างไว้ = พิมพ์เป็นเส้นไข่ปลาให้เขียนมือ';
  return [marks && `✕ ${marks} จุด`, txt && `ข้อความ ${txt} บรรทัด`, ok && `ปกติ ${ok}`, ng && `ไม่ปกติ ${ng}`, caps && `คำอธิบายรูป ${caps}`, moved && 'จัดตำแหน่งรูปเอง'].filter(Boolean).join(' · ');
}
