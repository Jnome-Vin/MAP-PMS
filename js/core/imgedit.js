// ปรับรูปก่อนใช้งาน: หมุน 90° · หมุนละเอียด (ปรับเอียง ±45° ทีละ 0.5°) · ครอปโดยลากขอบ/มุมกรอบ พร้อมเส้นแนว
// คืนรูปใหม่เป็น JPEG dataURL · ใช้กับรูปบัตรประชาชน / Passport และรูปแนบสัญญา · แสดงซ้อนบนหน้าต่างที่เปิดอยู่
const CSS = `
.ie-ov{position:fixed;inset:0;z-index:1000;background:rgba(15,23,42,.72);display:flex;align-items:center;justify-content:center}
.ie-box{background:#fff;border-radius:14px;padding:14px;width:min(900px,96vw);max-height:96vh;display:flex;flex-direction:column;gap:10px;box-shadow:0 10px 40px rgba(0,0,0,.35)}
.ie-box h3{margin:0;font-size:17px}
.ie-stage{position:relative;align-self:center;user-select:none;touch-action:none;background:#e3e8ee;border-radius:8px;overflow:hidden;padding:14px}
.ie-stage canvas{display:block}
/* เส้นตารางช่วยจัดภาพให้ตรง (ทั้งรูป) */
.ie-grid{position:absolute;inset:14px;pointer-events:none;
  background-image:linear-gradient(to right,rgba(255,255,255,.55) 1px,transparent 1px),linear-gradient(to bottom,rgba(255,255,255,.55) 1px,transparent 1px);
  background-size:calc(100% / 8) calc(100% / 8);mix-blend-mode:difference;opacity:.55}
.ie-grid[hidden]{display:none}
.ie-crop{position:absolute;border:2px solid #fff;box-shadow:0 0 0 9999px rgba(0,0,0,.45);outline:1px dashed #1f5f8b;cursor:move}
/* เส้นแบ่ง 3 ส่วนในกรอบครอป */
.ie-crop::before,.ie-crop::after{content:'';position:absolute;inset:0;pointer-events:none}
.ie-crop::before{background:linear-gradient(to right,transparent calc(33.33% - .5px),rgba(255,255,255,.85) calc(33.33% - .5px),rgba(255,255,255,.85) calc(33.33% + .5px),transparent calc(33.33% + .5px),transparent calc(66.66% - .5px),rgba(255,255,255,.85) calc(66.66% - .5px),rgba(255,255,255,.85) calc(66.66% + .5px),transparent calc(66.66% + .5px))}
.ie-crop::after{background:linear-gradient(to bottom,transparent calc(33.33% - .5px),rgba(255,255,255,.85) calc(33.33% - .5px),rgba(255,255,255,.85) calc(33.33% + .5px),transparent calc(33.33% + .5px),transparent calc(66.66% - .5px),rgba(255,255,255,.85) calc(66.66% - .5px),rgba(255,255,255,.85) calc(66.66% + .5px),transparent calc(66.66% + .5px))}
.ie-crop i{position:absolute;background:#fff;border:2px solid #1f5f8b;border-radius:3px;z-index:1}
.ie-crop i.c{width:16px;height:16px}
.ie-crop i[data-h=nw]{left:-9px;top:-9px;cursor:nwse-resize}.ie-crop i[data-h=ne]{right:-9px;top:-9px;cursor:nesw-resize}
.ie-crop i[data-h=sw]{left:-9px;bottom:-9px;cursor:nesw-resize}.ie-crop i[data-h=se]{right:-9px;bottom:-9px;cursor:nwse-resize}
/* ขอบ 4 ด้าน: ลากเพื่อตัดทีละด้าน (จับได้ตลอดแนวขอบ) */
.ie-crop b{position:absolute;z-index:0}
.ie-crop b[data-h=n]{left:8px;right:8px;top:-8px;height:16px;cursor:ns-resize}.ie-crop b[data-h=s]{left:8px;right:8px;bottom:-8px;height:16px;cursor:ns-resize}
.ie-crop b[data-h=w]{top:8px;bottom:8px;left:-8px;width:16px;cursor:ew-resize}.ie-crop b[data-h=e]{top:8px;bottom:8px;right:-8px;width:16px;cursor:ew-resize}
.ie-crop b::after{content:'';position:absolute;background:#fff;border:2px solid #1f5f8b;border-radius:3px}
.ie-crop b[data-h=n]::after,.ie-crop b[data-h=s]::after{left:50%;top:4px;width:28px;height:8px;margin-left:-14px}
.ie-crop b[data-h=w]::after,.ie-crop b[data-h=e]::after{top:50%;left:4px;height:28px;width:8px;margin-top:-14px}
.ie-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.ie-bar .sp{flex:1}
.ie-tilt{display:flex;gap:8px;align-items:center;flex-wrap:wrap;background:#f4f8fb;border:1px solid #d6e2ec;border-radius:10px;padding:6px 10px}
.ie-tilt input[type=range]{flex:1;min-width:180px;accent-color:#1f5f8b}
.ie-tilt .v{min-width:52px;text-align:center;font-variant-numeric:tabular-nums;font-weight:600}
.ie-note{font-size:12.5px;color:#66727f}
`;
const load = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
const FULL = () => ({ x: 0, y: 0, w: 1, h: 1 });

export async function editImage(src, { title = 'ปรับรูป', max = 1600 } = {}) {
  if (!document.getElementById('ie-css')) document.head.insertAdjacentHTML('beforeend', `<style id="ie-css">${CSS}</style>`);
  const img = await load(src);
  let rot = 0, tilt = 0, crop = FULL();   // crop เป็นสัดส่วน 0..1 ของรูปที่หมุนแล้ว (เริ่มเต็มรูป ลากขอบเข้ามาเพื่อตัด)
  const ov = document.createElement('div'); ov.className = 'ie-ov';
  ov.innerHTML = `<div class="ie-box"><h3>✂️ ${title}</h3>
    <div class="ie-note">ครอป: ลากขอบหรือมุมกรอบเข้ามาเพื่อตัด · ลากกลางกรอบเพื่อย้าย · ลากบนรูปนอกกรอบเพื่อตีกรอบใหม่ · หมุนละเอียด: เลื่อนแถบ "ปรับเอียง" ให้ขอบบัตรตรงกับเส้นตาราง</div>
    <div class="ie-stage"><canvas></canvas><div class="ie-grid"></div>
      <div class="ie-crop"><b data-h="n"></b><b data-h="s"></b><b data-h="w"></b><b data-h="e"></b><i class="c" data-h="nw"></i><i class="c" data-h="ne"></i><i class="c" data-h="sw"></i><i class="c" data-h="se"></i></div></div>
    <div class="ie-tilt"><b>📐 ปรับเอียง</b><button type="button" class="btn sm" data-t="-1">−1°</button><button type="button" class="btn sm" data-t="-0.5">−0.5°</button>
      <input type="range" min="-45" max="45" step="0.5" value="0"><button type="button" class="btn sm" data-t="0.5">+0.5°</button><button type="button" class="btn sm" data-t="1">+1°</button>
      <span class="v">0.0°</span><label style="display:flex;gap:4px;align-items:center;font-size:13px"><input type="checkbox" class="gridtoggle" checked> เส้นตาราง</label></div>
    <div class="ie-bar"><button type="button" class="btn" data-a="l">⟲ หมุนซ้าย 90°</button><button type="button" class="btn" data-a="r">⟳ หมุนขวา 90°</button>
      <button type="button" class="btn" data-a="reset">↺ เริ่มใหม่</button><span class="sp"></span>
      <button type="button" class="btn" data-a="x">ยกเลิก</button><button type="button" class="btn pri" data-a="ok">✓ ใช้รูปนี้</button></div></div>`;
  document.body.appendChild(ov);
  const cv = ov.querySelector('canvas'), stage = ov.querySelector('.ie-stage'), box = ov.querySelector('.ie-crop'), grid = ov.querySelector('.ie-grid');
  const range = ov.querySelector('input[type=range]'), val = ov.querySelector('.ie-tilt .v');
  // ขนาดกรอบของรูปหลังหมุน (มุมใดก็ได้)
  const bounds = (w, h, deg) => { const a = deg * Math.PI / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a)); return [w * c + h * s, w * s + h * c]; };
  const angle = () => rot + tilt;
  const paint = (g, W, H, k) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    g.save(); g.translate(W / 2, H / 2); g.rotate(angle() * Math.PI / 180);
    g.drawImage(img, -img.width * k / 2, -img.height * k / 2, img.width * k, img.height * k); g.restore();
  };
  let W = 0, H = 0;
  const draw = () => {
    const [bw, bh] = bounds(img.width, img.height, angle());
    // ขนาดแสดงผลคงที่ตามการหมุน 90° (ไม่ให้กรอบกระโดดขณะเลื่อนปรับเอียง)
    const [fw, fh] = bounds(img.width, img.height, rot);
    const k = Math.min(Math.min(800, innerWidth * .88) / fw, (innerHeight * .52) / fh, 1) * Math.min(fw / bw, fh / bh);
    W = cv.width = Math.round(bw * k); H = cv.height = Math.round(bh * k);
    paint(cv.getContext('2d'), W, H, k);
    showCrop();
  };
  const PAD = 14;   // ขอบรอบรูป ให้จับแถบขอบ/มุมกรอบได้เต็มแม้กรอบชิดขอบรูป
  const showCrop = () => Object.assign(box.style, { left: PAD + crop.x * W + 'px', top: PAD + crop.y * H + 'px', width: crop.w * W + 'px', height: crop.h * H + 'px' });
  // ลาก: สร้างกรอบใหม่ / ย้าย / ลากขอบ-มุม
  let drag = null;
  const pos = e => { const r = cv.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / W)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / H)) }; };
  stage.addEventListener('pointerdown', e => {
    e.preventDefault(); stage.setPointerCapture(e.pointerId);
    const p = pos(e), h = e.target.dataset?.h;
    if (h) drag = { mode: h, start: p, c: { ...crop } };
    else if (e.target === box) drag = { mode: 'move', start: p, c: { ...crop } };
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
  stage.addEventListener('pointerup', () => { if (crop.w < .03 || crop.h < .03) crop = FULL(); drag = null; showCrop(); });
  // ปรับเอียง (หมุนละเอียด)
  const setTilt = v => { tilt = Math.max(-45, Math.min(45, Math.round(v * 2) / 2)); range.value = tilt; val.textContent = (tilt > 0 ? '+' : '') + tilt.toFixed(1) + '°'; crop = FULL(); draw(); };
  range.oninput = () => setTilt(+range.value);
  ov.querySelectorAll('[data-t]').forEach(b => b.onclick = () => setTilt(tilt + Number(b.dataset.t)));
  ov.querySelector('.gridtoggle').onchange = e => { grid.hidden = !e.target.checked; };
  draw();
  return new Promise(resolve => {
    const close = v => { ov.remove(); resolve(v); };
    ov.querySelector('[data-a=l]').onclick = () => { rot = (rot + 270) % 360; crop = FULL(); draw(); };
    ov.querySelector('[data-a=r]').onclick = () => { rot = (rot + 90) % 360; crop = FULL(); draw(); };
    ov.querySelector('[data-a=reset]').onclick = () => { rot = 0; setTilt(0); };
    ov.querySelector('[data-a=x]').onclick = () => close(null);
    ov.querySelector('[data-a=ok]').onclick = () => {
      // วาดที่ความละเอียดเต็ม: หมุน (90° + ปรับเอียง) → ครอป → ย่อไม่เกิน max px
      const [bw, bh] = bounds(img.width, img.height, angle()).map(Math.round);
      const full = document.createElement('canvas'); full.width = bw; full.height = bh;
      paint(full.getContext('2d'), bw, bh, 1);
      const cx = Math.round(crop.x * bw), cy = Math.round(crop.y * bh), cw = Math.max(1, Math.round(crop.w * bw)), ch = Math.max(1, Math.round(crop.h * bh));
      const k = Math.min(1, max / Math.max(cw, ch));
      const out = document.createElement('canvas'); out.width = Math.round(cw * k); out.height = Math.round(ch * k);
      out.getContext('2d').drawImage(full, cx, cy, cw, ch, 0, 0, out.width, out.height);
      close(out.toDataURL('image/jpeg', 0.88));
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
