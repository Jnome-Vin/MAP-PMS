// ปรับรูปก่อนใช้งาน: หมุนซ้าย/ขวา 90° และครอป (ลากกรอบบนรูป) → คืนรูปใหม่เป็น JPEG dataURL
// ใช้กับรูปบัตรประชาชน / Passport และรูปแนบสัญญา · แสดงซ้อนบนหน้าต่างที่เปิดอยู่ (ไม่ปิดหน้าต่างเดิม)
const CSS = `
.ie-ov{position:fixed;inset:0;z-index:1000;background:rgba(15,23,42,.72);display:flex;align-items:center;justify-content:center}
.ie-box{background:#fff;border-radius:14px;padding:14px;width:min(860px,96vw);max-height:94vh;display:flex;flex-direction:column;gap:10px;box-shadow:0 10px 40px rgba(0,0,0,.35)}
.ie-box h3{margin:0;font-size:17px}
.ie-stage{position:relative;align-self:center;user-select:none;touch-action:none;cursor:crosshair;background:#eef2f6;border-radius:8px;overflow:hidden}
.ie-stage canvas{display:block}
.ie-crop{position:absolute;border:2px solid #fff;box-shadow:0 0 0 9999px rgba(0,0,0,.45);outline:1px dashed #1f5f8b;cursor:move}
.ie-crop i{position:absolute;width:14px;height:14px;background:#fff;border:2px solid #1f5f8b;border-radius:3px}
.ie-crop i[data-h=nw]{left:-8px;top:-8px;cursor:nwse-resize}.ie-crop i[data-h=ne]{right:-8px;top:-8px;cursor:nesw-resize}
.ie-crop i[data-h=sw]{left:-8px;bottom:-8px;cursor:nesw-resize}.ie-crop i[data-h=se]{right:-8px;bottom:-8px;cursor:nwse-resize}
.ie-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.ie-bar .sp{flex:1}
.ie-note{font-size:12.5px;color:#66727f}
`;
const load = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

export async function editImage(src, { title = 'ปรับรูป', max = 1600 } = {}) {
  if (!document.getElementById('ie-css')) document.head.insertAdjacentHTML('beforeend', `<style id="ie-css">${CSS}</style>`);
  const img = await load(src);
  let rot = 0, crop = null;   // crop = {x,y,w,h} เป็นสัดส่วน 0..1 ของรูปที่หมุนแล้ว
  const ov = document.createElement('div'); ov.className = 'ie-ov';
  ov.innerHTML = `<div class="ie-box"><h3>✂️ ${title}</h3>
    <div class="ie-note">ลากบนรูปเพื่อเลือกส่วนที่ต้องการ (ครอป) · ลากมุมกรอบเพื่อปรับขนาด · ลากกลางกรอบเพื่อย้าย</div>
    <div class="ie-stage"><canvas></canvas><div class="ie-crop" hidden><i data-h="nw"></i><i data-h="ne"></i><i data-h="sw"></i><i data-h="se"></i></div></div>
    <div class="ie-bar"><button type="button" class="btn" data-a="l">⟲ หมุนซ้าย</button><button type="button" class="btn" data-a="r">⟳ หมุนขวา</button>
      <button type="button" class="btn" data-a="reset">↺ เริ่มใหม่</button><span class="sp"></span>
      <button type="button" class="btn" data-a="x">ยกเลิก</button><button type="button" class="btn pri" data-a="ok">✓ ใช้รูปนี้</button></div></div>`;
  document.body.appendChild(ov);
  const cv = ov.querySelector('canvas'), stage = ov.querySelector('.ie-stage'), box = ov.querySelector('.ie-crop');
  let W = 0, H = 0;
  const draw = () => {
    const sw = rot % 180 ? img.height : img.width, sh = rot % 180 ? img.width : img.height;
    const k = Math.min(Math.min(800, innerWidth * .9) / sw, (innerHeight * .62) / sh, 1);
    W = cv.width = Math.round(sw * k); H = cv.height = Math.round(sh * k);
    const g = cv.getContext('2d'); g.save(); g.translate(W / 2, H / 2); g.rotate(rot * Math.PI / 180);
    const dw = img.width * k, dh = img.height * k; g.drawImage(img, -dw / 2, -dh / 2, dw, dh); g.restore();
    showCrop();
  };
  const showCrop = () => {
    box.hidden = !crop;
    if (crop) Object.assign(box.style, { left: crop.x * W + 'px', top: crop.y * H + 'px', width: crop.w * W + 'px', height: crop.h * H + 'px' });
  };
  // ลากเพื่อสร้าง / ย้าย / ขยายกรอบครอป
  let drag = null;
  const pos = e => { const r = cv.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / W)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / H)) }; };
  stage.addEventListener('pointerdown', e => {
    e.preventDefault(); stage.setPointerCapture(e.pointerId);
    const p = pos(e), h = e.target.dataset?.h;
    if (h && crop) drag = { mode: h, start: p, c: { ...crop } };
    else if (e.target === box && crop) drag = { mode: 'move', start: p, c: { ...crop } };
    else { drag = { mode: 'new', start: p }; crop = { x: p.x, y: p.y, w: 0, h: 0 }; }
  });
  stage.addEventListener('pointermove', e => {
    if (!drag) return; const p = pos(e), s = drag.start, c = drag.c;
    if (drag.mode === 'new') crop = { x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) };
    else if (drag.mode === 'move') crop = { ...c, x: Math.min(1 - c.w, Math.max(0, c.x + p.x - s.x)), y: Math.min(1 - c.h, Math.max(0, c.y + p.y - s.y)) };
    else {
      let x1 = c.x, y1 = c.y, x2 = c.x + c.w, y2 = c.y + c.h;
      if (drag.mode.includes('w')) x1 = p.x; if (drag.mode.includes('e')) x2 = p.x;
      if (drag.mode.includes('n')) y1 = p.y; if (drag.mode.includes('s')) y2 = p.y;
      crop = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
    }
    showCrop();
  });
  stage.addEventListener('pointerup', () => { if (crop && (crop.w < .03 || crop.h < .03)) crop = null; drag = null; showCrop(); });
  draw();
  return new Promise(resolve => {
    const close = v => { ov.remove(); resolve(v); };
    ov.querySelector('[data-a=l]').onclick = () => { rot = (rot + 270) % 360; crop = null; draw(); };
    ov.querySelector('[data-a=r]').onclick = () => { rot = (rot + 90) % 360; crop = null; draw(); };
    ov.querySelector('[data-a=reset]').onclick = () => { rot = 0; crop = null; draw(); };
    ov.querySelector('[data-a=x]').onclick = () => close(null);
    ov.querySelector('[data-a=ok]').onclick = () => {
      // วาดที่ความละเอียดเต็ม: หมุน → ครอป → ย่อไม่เกิน max px
      const sw = rot % 180 ? img.height : img.width, sh = rot % 180 ? img.width : img.height;
      const full = document.createElement('canvas'); full.width = sw; full.height = sh;
      const g = full.getContext('2d'); g.translate(sw / 2, sh / 2); g.rotate(rot * Math.PI / 180); g.drawImage(img, -img.width / 2, -img.height / 2);
      const c = crop || { x: 0, y: 0, w: 1, h: 1 }, cx = Math.round(c.x * sw), cy = Math.round(c.y * sh), cw = Math.max(1, Math.round(c.w * sw)), ch = Math.max(1, Math.round(c.h * sh));
      const k = Math.min(1, max / Math.max(cw, ch));
      const out = document.createElement('canvas'); out.width = Math.round(cw * k); out.height = Math.round(ch * k);
      out.getContext('2d').drawImage(full, cx, cy, cw, ch, 0, 0, out.width, out.height);
      close(out.toDataURL('image/jpeg', 0.85));
    };
  });
}

// ทำให้กล่องรับไฟล์จากการลากวางได้ (ลากรูปจากเครื่องมาวาง) → เรียก onFiles(fileList)
export function dropZone(el, onFiles) {
  if (!el) return;
  const on = e => { e.preventDefault(); el.classList.add('drop-on'); };
  const off = () => el.classList.remove('drop-on');
  el.addEventListener('dragover', on); el.addEventListener('dragenter', on);
  el.addEventListener('dragleave', e => { if (!el.contains(e.relatedTarget)) off(); });
  el.addEventListener('drop', e => { e.preventDefault(); off(); const fs = [...(e.dataTransfer?.files || [])].filter(f => f.type.startsWith('image/')); if (fs.length) onFiles(fs); });
}
