// ผังห้องรายชั้น (ตามแบบแปลน: แถวบน 6-7-8-บันได-9 / ทางเดิน / แถวล่าง 5-4-3-2-1)
import * as db from '../core/db.js';
import * as M from '../core/model.js';
import { esc, fmt0, thDate, periodLabel } from '../core/ui.js';
import { openTenantForm, moveOut, photoThumb, openTenantHistory, cancelMoveOut, printRefund } from './tenants.js';
import { openPayment, openPaymentDetail, hasSlipIssue } from './billing.js';
import { occ } from '../core/idcard.js';

let floor = 2, sel = null;
const TOP = [6, 7, 8, 'stair', 9], BOTTOM = [5, 4, 3, 2, 1];
// แถบระเบียง + ห้องน้ำของแต่ละห้อง ตามแบบแปลน (เรียงซ้าย→ขวา) — ช่วงบันไดไม่มีห้องน้ำ
const STRIP = { 6: ['bal', 'wc'], 7: ['wc', 'bal'], 8: ['bal', 'wc'], 9: ['wc', 'bal'],
  5: ['bal', 'wc'], 4: ['wc', 'bal'], 3: ['bal', 'wc'], 2: ['wc', 'bal'], 1: ['wc', 'bal'] };
const strip = n => `<div class="strip">${(STRIP[n] || ['bal']).map(p => p === 'wc' ? '<div class="wc">WC</div>' : '<div class="bal">ระเบียง</div>').join('')}</div>`;
// บันไดแบบหักกลับ: ชานพักด้านบน, 2 ช่วงบันได (สิ้นสุดก่อนถึงทางเดิน), เส้นตัด และลูกศรทางขึ้น
// วาดด้วยกล่อง % เพื่อให้ยืดตามขนาดช่องได้ทั้งจอใหญ่และมือถือโดยตัวอักษร/หัวลูกศรไม่เพี้ยน
const STAIR = `<div class="stair" role="img" aria-label="บันได มีชานพัก ลูกศรแสดงทางขึ้น">
  <div class="landing">ชานพัก</div>
  <div class="flight l"></div><div class="flight r"><span class="cut"></span></div>
  <svg viewBox="0 0 100 100" preserveAspectRatio="none"><polyline points="25,90 25,12 75,12 75,60" vector-effect="non-scaling-stroke"/></svg>
  <span class="dot" style="left:25%;top:90%"></span><span class="head" style="left:75%;top:60%"></span>
  <span class="up">ขึ้น</span>
</div>`;
// วางเซลล์ลงตำแหน่งในกริด (คอลัมน์, แถว)
const at_ = (html, col, row) => html.replace('<div', `<div style="grid-column:${col};grid-row:${row}"`);

// ⚠️ ยังไม่มีรูปบัตร / ข้อมูลไม่ครบ (ชี้เมาส์เพื่อดูว่าขาดอะไร)
const warn = t => { const m = M.missingText(t); return m ? `<span class="warn-ic" title="${esc(m)}">⚠️</span>` : ''; };

function cell(r) {
  if (!r) return '<div></div>';
  const st = M.roomState(r), t = M.tenantOf(r.id), sl = M.slotsOf(r.id);
  const car = sl.some(s => s.zone === 'CAR'), moto = sl.filter(s => s.zone !== 'CAR').length;
  return `<div class="room ${M.ROOM_TXT[st][2]} ${sel === r.id ? 'sel' : ''}" data-room="${r.id}" title="${M.ROOM_TXT[st][0]}">
    <div><div class="no">${r.id}</div><div class="nm">${esc(t?.name || r.label || '— ว่าง —')}</div></div>
    <div class="ic">${r.type === 'พัดลม' ? '<span title="ห้องพัดลม">🌀<small>พัดลม</small></span>' : ''}${t?.fridge ? '<span title="เช่าตู้เย็น">🧊</span>' : ''}${moto ? `<span title="ที่จอดมอไซค์">🏍️${moto > 1 ? `<small>×${moto}</small>` : ''}</span>` : ''}${car ? '<span title="ที่จอดรถยนต์">🚗</span>' : ''}${warn(t)}</div></div>`;
}

// ห้องขนาดเล็ก (ชั้น 1): เลขห้อง · ชื่อ ในบรรทัดเดียว
function miniCell(r) {
  if (!r) return '<div></div>';
  const st = M.roomState(r), t = M.tenantOf(r.id);
  return `<div class="room mini ${M.ROOM_TXT[st][2]} ${sel === r.id ? 'sel' : ''}" data-room="${r.id}" title="${M.ROOM_TXT[st][0]}">
    <span class="no">${r.id}</span><span class="nm">${esc(t?.name || r.label || '')}</span>${warn(t)}</div>`;
}
const lot = () => `<div class="lot" data-go-park title="เปิดผังที่จอดรถ"><b>🅿️</b>ที่จอดรถ</div>`;

// ชั้น 1 ตามแบบแปลน (10 คอลัมน์ย่อย = 5 ช่วงเสา + คอลัมน์ 103 ด้านขวา):
//   แถวบน : ที่จอดรถ | ที่จอดรถ | ที่จอดรถ · ออฟฟิศ | บันได | ทางขึ้นอาคาร | 101   (102 รูปตัว L: แถบเหนือ 101 + ขาลงด้านขวา)
//   ทางเดิน: ทางรถ (ไม่มีกรอบ ต่อกับช่องจอด)                | 101 (พื้นที่เดียวกัน รูป L)    | 103
//   แถวล่าง: ที่จอดรถ | ที่จอดรถ | ที่จอดรถ                 | 101
function groundPlan(all) {
  const r = id => all.find(x => x.id === id);
  const office = r('101');
  const officeTop = office ? cell(office).replace('class="room ', 'class="room l-top ').replace(/<div><div class="no">[\s\S]*<\/div>\s*$/, '</div>') : '<div></div>';
  // 102 รูปตัว L: แถบบน (เหนือ 101 ถึงขอบขวา) + ขาลงด้านขวา (เหนือ 103)
  const laundry = r('102');
  const laundryLeg = laundry ? miniCell(laundry).replace('class="room mini ', 'class="room mini l2-leg ').replace(/<span class="no">[\s\S]*<\/div>\s*$/, '</div>') : '<div></div>';
  return `<div class="plan g">
    ${at_(laundry ? miniCell(laundry).replace('class="room mini ', 'class="room mini l2-top ') : '<div></div>', '9 / 12', 1)}
    ${at_(laundryLeg, 11, 2)}
    ${at_(lot(), '1 / 3', 2)}${at_(lot(), '3 / 5', 2)}${at_(lot(), 5, 2)}
    ${at_('<div class="floor office-box">ออฟฟิศ</div>', 6, 2)}
    ${at_(STAIR.replace('class="stair"', 'class="stair g"'), 7, 2)}
    ${at_('<div class="floor vlabel">ทางขึ้นอาคาร</div>', 8, 2)}
    ${at_(officeTop, '9 / 11', 2)}
    <div class="corr open" style="grid-column:1 / 6;grid-row:3">ทางรถ / ทางเดิน</div>
    ${at_(office ? cell(office).replace('class="room ', 'class="room l-bot ') : '<div></div>', '6 / 11', '3 / 5')}
    ${at_(miniCell(r('103')).replace('class="room mini ', 'class="room mini v '), 11, '3 / 5')}
    ${at_(lot(), '1 / 3', 4)}${at_(lot(), '3 / 5', 4)}${at_(lot(), 5, 4)}
  </div>`;
}

function detail(id) {
  if (!id) return '<div class="empty">👆 คลิกห้องเพื่อดูรายละเอียด<br>ผู้เช่า · ค่าเช่า · ตู้เย็น · ที่จอดรถ · บิล</div>';
  const r = db.get('rooms', id), t = M.tenantOf(id), st = M.roomState(r), sl = M.slotsOf(id);
  const last = db.all('bills').filter(b => b.room === id).sort((a, b) => b.period.localeCompare(a.period))[0];
  const link = M.lineLinkOf(id);
  return `<div style="display:flex;justify-content:space-between;align-items:start;gap:8px"><div><h3>ห้อง ${id}</h3><div class="note">${esc(r.label || r.type)}${r.floor > 1 ? ' · ชั้น ' + r.floor : ''}</div></div>
    <span class="pill ${M.ROOM_TXT[st][1]}">${M.ROOM_TXT[st][0]}</span></div>
  ${M.missingText(t) ? `<div class="missing-box">⚠️ <b>${esc(M.missingText(t))}</b> <a href="#" data-a="fill">กรอกเพิ่ม →</a></div>` : ''}
  <dl>
    <dt>ผู้เช่า</dt><dd>${esc(t?.name || '-')}</dd>
    <dt>โทร</dt><dd>${t?.phone ? `<a href="tel:${esc(t.phone)}">${esc(t.phone)}</a>` : '-'}</dd>
    ${t?.occupants?.length ? `<dt>ผู้พักร่วม</dt><dd>${t.occupants.map(o => { o = occ(o); return `${esc(o.name || '-')}${o.idNo ? ` <span class="note">${esc(o.idNo)}</span>` : ''}${o.photo ? ' 📄' : ''}`; }).join('<br>')}</dd>` : ''}
    <dt>เข้าพัก</dt><dd>${thDate(t?.since)}${t?.since ? ` <span class="note">(${M.stayText(t.since)})</span>` : ''}</dd>
    ${t ? `<dt>วันเกิด</dt><dd>${t.birthDate ? thDate(t.birthDate) + (+t.birthDate.slice(5, 7) === new Date().getMonth() + 1 ? ' 🎂' : '') : '<span class="pill warn">ยังไม่ระบุ</span>'}</dd>` : ''}
    <dt>ค่าเช่า</dt><dd>฿${fmt0(t?.rent ?? r.rent)}</dd>
    <dt>น้ำ / ไฟ</dt><dd>฿${M.roomRates(r, t).water} / ฿${M.roomRates(r, t).elec} ต่อหน่วย${t && (t.wRate != null || t.eRate != null) ? ' <span class="note">(ตามสัญญา)</span>' : ''}</dd>
    ${t ? `<dt>เงินประกัน</dt><dd>฿${fmt0(t.deposit)}${M.depositUsed(t) ? ` <span class="note">(หักชำระบิลแล้ว ฿${fmt0(M.depositUsed(t))} · คงเหลือ ฿${fmt0(M.depositLeft(t))})</span>` : ''}${t.rentAdvance ? ` · ล่วงหน้า ฿${fmt0(t.rentAdvance)}` : ''}</dd>` : ''}
    ${t?.note ? `<dt>หมายเหตุ</dt><dd class="note">${esc(t.note)}</dd>` : ''}
    <dt>ตู้เย็น</dt><dd>${t?.fridge ? `🧊 เช่า ฿${fmt0(t.fridge)}/เดือน` : 'ไม่ได้เช่า'}</dd>
    <dt>ค่าที่จอด</dt><dd>${t?.parkingFee ? `฿${fmt0(t.parkingFee)}/เดือน` : '-'}</dd>
    <dt>ที่จอดรถ</dt><dd><div class="chips">${sl.length ? sl.map(s => `<button class="chip" data-slot="${s.id}">${s.zone === 'CAR' ? '🚗' : '🏍️'} ${s.id}${s.plate ? ' · ' + esc(s.plate) : ''}</button>`).join('') : '-'}</div></dd>
    <dt>บิลล่าสุด</dt><dd>${last ? `${periodLabel(last.period, true)} · ฿${fmt0(M.calcBill(last).total)} ${M.billState(last) === 'internal' ? `<span class="pill idle">ส่วนกลาง</span>`
      : `<button class="pill ${M.BILL_TXT[M.billState(last)][1]} pay-btn" data-a="lastbill" title="${['paid', 'partial'].includes(M.billState(last)) ? 'ดูรายละเอียดการโอน / แก้ไข' : 'รับชำระเงิน'}">${M.BILL_TXT[M.billState(last)][0]} ${hasSlipIssue(last) ? '⚠️ ตรวจสลิป' : ['paid', 'partial'].includes(M.billState(last)) ? '🔍' : '💰'}</button>`}` : '-'}</dd>
    <dt>LINE</dt><dd>${link ? `✅ ${esc(link.displayName || M.lineName(id))}` : `<span class="note">ยังไม่ผูก (${esc(M.lineName(id))})</span>`}</dd>
    ${t ? `<dt>บัตร ปชช.</dt><dd id="idthumb">${t.idPhoto ? 'กำลังโหลด…' : '<span class="pill bad">ยังไม่แนบ</span>'}</dd>` : ''}
  </dl>
  ${M.stays(id).length ? `<details open><summary><b>ประวัติการเช่าห้องนี้</b> <span class="note">${M.stays(id).length} ราย · กดชื่อเพื่อดูรายละเอียด/บิล</span></summary>
    <div class="scroll" style="max-height:220px;margin-top:6px"><table class="tbl">${M.stays(id).map(p =>
    `<tr class="click" data-past="${p.id}"><td style="white-space:normal">${esc(p.name)}${p.active ? ' <span class="pill ok">ปัจจุบัน</span>' : ''}</td>
      <td class="note" style="white-space:normal">${thDate(p.since)} – ${p.active ? 'ปัจจุบัน' : thDate(p.moveOut)}<br>${M.stayText(p.since, p.active ? null : p.moveOut)}</td></tr>`).join('')}</table></div></details>` : ''}
  <div class="acts">${t ? `<button class="btn pri" data-a="bill">บิลของห้องนี้</button><button class="btn" data-a="edit">แก้ไขผู้เช่า</button><button class="btn" data-a="out">ย้ายออก</button>`
    : `<button class="btn pri" data-a="in">+ ผู้เช่าเข้าใหม่</button>${r.kind !== 'room' ? '<button class="btn" data-a="bill">บิล/มิเตอร์</button>' : ''}${M.pastTenantsOf(id)[0] ? `<button class="btn" data-a="undo" title="ใช้เมื่อกดย้ายออกผิด">↩ ยกเลิกการย้ายออก (${esc(M.pastTenantsOf(id)[0].name)})</button>` : ''}${M.pastTenantsOf(id)[0]?.moveOutDoc ? '<button class="btn" data-a="refund">🖨️ เอกสารคืนเงิน</button>' : ''}`}</div>`;
}

export default {
  id: 'floorplan', title: 'ผังห้อง', icon: '🏢',
  render(el, nav, arg) {
    if (arg?.room) { sel = arg.room; floor = db.get('rooms', arg.room)?.floor || floor; arg.room = null; }
    const all = M.rooms(), floors = [...new Set(all.map(r => r.floor))].sort();
    const at = (f, n) => all.find(r => r.floor === f && r.id === `${f}0${n}`);
    const extra = all.filter(r => r.floor === floor && floor > 1 && !(+r.id.slice(1) >= 1 && +r.id.slice(1) <= 9));
    const body = floor === 1
      ? `<div>${groundPlan(all)}<div class="acts" style="justify-content:flex-end"><button class="btn pri" data-go-park>เปิดผังที่จอดรถ (ช่องจอดรายห้อง) →</button></div></div>`
      : `<div><div class="plan">
          ${TOP.map((n, i) => n === 'stair' ? at_(STAIR, i + 1, '1 / 3')
            : at_(strip(n), i + 1, 1) + at_(cell(at(floor, n)), i + 1, 2)).join('')}
          <div class="corr" style="grid-row:3">ทางเดิน</div>
          ${BOTTOM.map((n, i) => at_(cell(at(floor, n)), i + 1, 4) + at_(strip(n), i + 1, 5)).join('')}
        </div>${extra.length ? `<div class="ground">${extra.map(cell).join('')}</div>` : ''}</div>`;

    el.innerHTML = `
    <div class="top"><h2>ผังห้อง</h2>
      <div class="seg">${floors.map(f => `<button data-f="${f}" class="${f === floor ? 'on' : ''}">ชั้น ${f}</button>`).join('')}</div></div>
    <div class="legend"><span><i style="background:var(--ok-soft);border:1px solid var(--ok)"></i>ไม่มีค้าง</span><span><i style="background:var(--warn-soft);border:1px solid var(--warn)"></i>รอชำระ</span><span><i style="background:var(--bad-soft);border:1px solid var(--bad)"></i>ค้างชำระ</span><span><i style="background:var(--idle-soft);border:1px solid var(--idle)"></i>ว่าง / ส่วนกลาง</span><span>🧊 ตู้เย็น · 🏍️ มอไซค์ · 🚗 รถยนต์ · ⚠️ ยังไม่มีรูปบัตร / ข้อมูลไม่ครบ</span></div>
    <div class="layout">${body}<div class="card detail">${detail(sel)}</div></div>`;

    el.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { floor = +b.dataset.f; sel = null; this.render(el, nav); });
    el.querySelectorAll('[data-room]').forEach(b => b.onclick = () => { sel = b.dataset.room; this.render(el, nav); });
    el.querySelectorAll('[data-go-park]').forEach(b => b.onclick = () => nav.go('parking'));
    el.querySelectorAll('[data-slot]').forEach(b => b.onclick = () => nav.go('parking', { highlight: [b.dataset.slot] }));
    const t = sel && M.tenantOf(sel);
    if (t?.idPhoto) photoThumb(t.idPhoto).then(h => { const d = el.querySelector('#idthumb'); if (d) d.innerHTML = h; });
    const act = a => el.querySelector(`[data-a="${a}"]`);
    act('bill')?.addEventListener('click', () => nav.go('billing', { room: sel }));
    act('edit')?.addEventListener('click', () => openTenantForm(t, () => this.render(el, nav)));
    act('fill')?.addEventListener('click', e => { e.preventDefault(); openTenantForm(t, () => this.render(el, nav)); });
    act('in')?.addEventListener('click', () => openTenantForm({ room: sel }, () => this.render(el, nav)));
    act('out')?.addEventListener('click', () => moveOut(t, () => this.render(el, nav)));
    act('lastbill')?.addEventListener('click', () => {
      const lb = db.all('bills').filter(b => b.room === sel).sort((a, b) => b.period.localeCompare(a.period))[0];
      ['paid', 'partial'].includes(M.billState(lb)) ? openPaymentDetail(lb, () => this.render(el, nav)) : openPayment(lb, () => this.render(el, nav));
    });
    act('undo')?.addEventListener('click', () => cancelMoveOut(M.pastTenantsOf(sel)[0], () => this.render(el, nav)));
    act('refund')?.addEventListener('click', () => printRefund(M.pastTenantsOf(sel)[0]));
    el.querySelectorAll('[data-past]').forEach(tr => tr.onclick = () => openTenantHistory(db.get('tenants', tr.dataset.past), () => this.render(el, nav)));
  },
};
