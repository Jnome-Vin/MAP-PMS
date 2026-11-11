// หน้าต่างกรอกใบตรวจสภาพห้อง + จัดรูปแนบ (เปิดจากหน้าต่างสัญญาเช่า) — กรอกบนหน้าเอกสารจริง
// 1. พิมพ์ข้อความบนเส้นไข่ปลา · กดบนผังห้องเพื่อมาร์ค ✕ สีแดง (กดซ้ำที่ ✕ เพื่อลบ)
// 2. ติ๊ก ปกติ / ไม่ปกติ และพิมพ์รายละเอียด
// 3. ลากรูปสลับตำแหน่ง (หรือปุ่ม ◀ ▶) และพิมพ์คำอธิบายใต้ภาพ
import * as K from '../core/contract.js';

const CSS = `
.ins-ov{position:fixed;inset:0;z-index:900;background:rgba(15,23,42,.62);display:flex;align-items:center;justify-content:center;padding:1.5vh 1vw}
.ins-box{background:#fff;border-radius:12px;display:flex;flex-direction:column;width:min(1000px,100%);height:97vh;box-shadow:0 10px 40px rgba(0,0,0,.35);overflow:hidden}
.ins-hd{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid #e3e8ee;flex-wrap:wrap}
.ins-hd h3{margin:0;font-size:16px;flex:1;min-width:200px}
.ins-tip{font-size:12.5px;color:#46586a;padding:6px 14px;background:#f6f9fc;border-bottom:1px solid #e3e8ee;line-height:1.6}
.ins-tip b{color:#1f4e79}
.ins-bd{overflow:auto;background:#e9edf2;padding:8px;flex:1}
.ins-bd img[data-room]{cursor:crosshair;outline:2px dashed rgba(238,0,0,.35);outline-offset:3px}
.ins-bd img[data-room]:hover{outline-color:#e00}
.ins-bd .ck[data-ck]{cursor:pointer;border-radius:4px;padding:0 3px;margin:0 -3px}
.ins-bd .ck[data-ck]:hover{background:#fff1c2}
.ins-bd figure[draggable]{cursor:grab;border:1.5px dashed transparent;border-radius:6px;padding:2px}
.ins-bd figure[draggable]:hover{border-color:#9db4c9}
.ins-bd figure.drop{border-color:#1f5f8b;background:#e3f0fb}
.ins-bd figure.drag{opacity:.4}
.ins-bd .ct-mv{display:flex;align-items:center;justify-content:space-between;width:100%;font-size:11px;color:#7a8a9a;margin-bottom:1mm}
.ins-bd .ct-mv button{border:1px solid #c5d0db;background:#fff;border-radius:6px;padding:1px 9px;cursor:pointer;font-size:12px}
.ins-bd .ct-mv button:disabled{opacity:.35;cursor:default}
`;

// คืน Promise เมื่อปิดหน้าต่าง · onChange(structural) แจ้งหน้าต่างสัญญาให้อัปเดตตัวอย่าง (structural = รูปเปลี่ยนลำดับ/คำอธิบาย)
export function openInspect({ C, docOf, onChange }) {
  C.insp = K.inspOf(C);
  const I = C.insp;
  const ov = document.createElement('div');
  ov.className = 'ins-ov';
  ov.innerHTML = `<style>${CSS}</style><div class="ins-box" role="dialog" aria-label="กรอกใบตรวจสภาพห้อง">
    <div class="ins-hd"><h3>📋 ใบตรวจสภาพห้อง · รูปแนบ — ห้อง ${C.room}</h3><button class="btn pri" type="button" data-done>✔ เสร็จ</button></div>
    <div class="ins-tip">✍️ <b>พิมพ์บนเส้นไข่ปลา</b> (ช่องสีเหลือง) · ✕ <b>กดบนผังห้อง</b> เพื่อมาร์คจุดที่ไม่ปกติ (กดที่ ✕ ซ้ำเพื่อลบ) · ☑ <b>กดที่ช่อง</b> ปกติ / ไม่ปกติ ·
      🖼️ <b>ลากรูปสลับตำแหน่ง</b> หรือกด ◀ ▶ แล้วพิมพ์คำอธิบายใต้ภาพ — บันทึกพร้อมสัญญาเมื่อกด 💾 บันทึก</div>
    <div class="ins-bd"><p style="padding:20px;color:#5a6c7e">กำลังโหลด…</p></div></div>`;
  document.body.appendChild(ov);
  const bd = ov.querySelector('.ins-bd');
  let timer;
  const changed = (structural = false) => { clearTimeout(timer); timer = setTimeout(() => onChange?.(structural), structural ? 0 : 300); };

  const fit = () => { const pg = bd.querySelector('.ins-pg'); if (pg) pg.style.zoom = Math.min(1.15, Math.max(0.45, (bd.clientWidth - 24) / 800)).toFixed(3); };
  const render = async () => {
    const st = bd.scrollTop;
    const html = await K.pagesHtml(await docOf(), { edit: true, only: ['insp', 'att'] });
    bd.innerHTML = `<style>${K.previewCss()}</style><div class="ins-pg">${html}</div>`;
    const n = (C.photos || []).length;
    bd.querySelectorAll('[data-mv]').forEach(b => { const to = +b.dataset.pi + +b.dataset.mv; b.disabled = to < 0 || to >= n; });
    fit(); bd.scrollTop = st;
  };
  render();
  window.addEventListener('resize', fit);

  // ข้อความบนเส้น: bed.0 · bath.2 · bal.1 · it.3.0 (รายการที่ 4 บรรทัดแรก) · item10
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
  // Enter = ไปบรรทัดถัดไป
  bd.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || !e.target.matches('input.ct-in')) return;
    e.preventDefault();
    const all = [...bd.querySelectorAll('input.ct-in')], i = all.indexOf(e.target);
    all[i + 1]?.focus();
  });

  const syncTicks = () => bd.querySelectorAll('[data-ck]').forEach(s => {
    const on = s.dataset.ck === 'ph' ? I.phase === s.dataset.v : I.items[+s.dataset.i].s === s.dataset.v;
    s.querySelector('.ct-box')?.classList.toggle('t', on);
  });
  const swap = (a, b) => {
    const P = C.photos; if (a === b || a < 0 || b < 0 || a >= P.length || b >= P.length) return;
    [P[a], P[b]] = [P[b], P[a]]; changed(true); render();
  };
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
      img.src = K.roomPng(def, ms); changed(); return;
    }
    const mv = e.target.closest('[data-mv]');
    if (mv) swap(+mv.dataset.pi, +mv.dataset.pi + +mv.dataset.mv);
  });

  // ลากรูปไปวางบนอีกรูป = สลับตำแหน่ง (ขณะพิมพ์คำอธิบาย ปิดการลากไว้ เพื่อให้เลือกข้อความได้)
  let dragPi = null;
  bd.addEventListener('pointerdown', e => { const f = e.target.closest('figure[data-pi]'); if (f) f.draggable = !e.target.matches('input'); });
  bd.addEventListener('focusout', e => { const f = e.target.closest?.('figure[data-pi]'); if (f) f.draggable = true; });
  bd.addEventListener('dragstart', e => {
    const f = e.target.closest?.('figure[data-pi]'); if (!f || e.target.matches('input')) return;
    dragPi = +f.dataset.pi; f.classList.add('drag'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(dragPi));
  });
  bd.addEventListener('dragover', e => {
    const f = e.target.closest('figure[data-pi]'); if (dragPi == null || !f) return;
    e.preventDefault(); bd.querySelectorAll('figure.drop').forEach(x => x !== f && x.classList.remove('drop')); f.classList.add('drop');
  });
  bd.addEventListener('drop', e => {
    const f = e.target.closest('figure[data-pi]'); if (dragPi == null || !f) return;
    e.preventDefault(); const a = dragPi; dragPi = null; swap(a, +f.dataset.pi);
  });
  bd.addEventListener('dragend', () => { dragPi = null; bd.querySelectorAll('figure.drop,figure.drag').forEach(x => x.classList.remove('drop', 'drag')); });

  return new Promise(res => {
    const close = () => { clearTimeout(timer); onChange?.(true); window.removeEventListener('resize', fit); document.removeEventListener('keydown', esc, true); ov.remove(); res(); };
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
  if (!marks && !ng && !ok && !txt && !caps) return 'ยังไม่ได้กรอก — ว่างไว้ = พิมพ์เป็นเส้นไข่ปลาให้เขียนมือ';
  return [marks && `✕ ${marks} จุด`, txt && `ข้อความ ${txt} บรรทัด`, ok && `ปกติ ${ok}`, ng && `ไม่ปกติ ${ng}`, caps && `คำอธิบายรูป ${caps}`].filter(Boolean).join(' · ');
}
