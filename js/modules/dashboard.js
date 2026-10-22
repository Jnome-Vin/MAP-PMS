// ภาพรวม: อัตราเข้าพัก ยอดค้าง ที่จอด และงานประจำเดือน
import * as db from '../core/db.js';
import * as M from '../core/model.js';
import { esc, fmt0, periodLabel, periodOf, thDate, openModal, closeModal } from '../core/ui.js';
import { birthdaysThisMonth, birthdayTable, missingBirthdays } from './birthdays.js';
import { openPayment, openPaymentDetail, hasSlipIssue } from './billing.js';

const ZONES = { A: 'A หน้าตึก (มอไซค์)', B: 'B ใต้ตึก (มอไซค์)', C: 'C หลังตึก (มอไซค์ใหญ่)', CAR: 'CAR ที่จอดรถยนต์' };

export default {
  id: 'dashboard', title: 'ภาพรวม', icon: '📊',
  render(el, nav) {
    const res = M.rooms().filter(r => r.kind === 'room');
    const occ = res.filter(r => M.tenantOf(r.id));
    const unpaid = db.all('bills').filter(b => ['due', 'late', 'partial'].includes(M.billState(b)));
    const late = unpaid.filter(b => M.billState(b) === 'late');
    const tenants = db.all('tenants').filter(t => t.active);
    const fixed = M.rooms().reduce((a, r) => a + (M.tenantOf(r.id) || r.kind === 'kiosk' ? Number(r.rent) || 0 : 0), 0)
      + tenants.reduce((a, t) => a + (Number(t.fridge) || 0) + (Number(t.parkingFee) || 0), 0);
    const bdays = birthdaysThisMonth();
    const slipBad = db.all('bills').filter(hasSlipIssue);
    const noPhoto = tenants.filter(t => !t.idPhoto);
    const incomplete = tenants.filter(t => M.missingInfo(t).some(x => x !== 'รูปบัตร')).length;
    const slots = db.all('slots');
    const cur = periodOf(), billed = M.billsOf(cur).filter(b => b.status !== 'draft').length;

    el.innerHTML = `
    <div class="top"><h2>ภาพรวม · ${periodLabel(cur)}</h2><button class="btn pri" data-go="billing">จดมิเตอร์ / ออกบิล →</button></div>
    <div class="kpis">
      <button class="card kpi click" data-kpi="rooms"><div class="v">${occ.length}/${res.length}</div><div class="l">ห้องพักมีผู้เช่า · ว่าง ${res.length - occ.length} ห้อง ›</div></button>
      <button class="card kpi click" data-kpi="late"><div class="v" style="color:var(--bad)">${late.length}</div><div class="l">บิลเกินกำหนด ›</div></button>
      <button class="card kpi click" data-kpi="due"><div class="v" style="color:var(--warn)">${unpaid.length - late.length}</div><div class="l">บิลรอชำระ ›</div></button>
      <button class="card kpi click" data-kpi="fridge"><div class="v">${tenants.filter(t => t.fridge).length}</div><div class="l">ตู้เย็นให้เช่า ›</div></button>
      <button class="card kpi click" data-kpi="fixed"><div class="v">฿${fmt0(fixed)}</div><div class="l">รายรับคงที่/เดือน (ค่าเช่า+ตู้เย็น+จอดรถ) ›</div></button>
    </div>
    <div class="grid2">
      <div class="card"><b>อัตราเข้าพักรายชั้น</b>
        ${[2, 3, 4, 5].map(f => { const rs = res.filter(r => r.floor === f), o = rs.filter(r => M.tenantOf(r.id)).length;
          return `<div class="rowbar"><span>ชั้น ${f}</span><div class="bar"><b style="width:${rs.length ? o / rs.length * 100 : 0}%"></b></div><span>${o}/${rs.length}</span></div>`; }).join('')}
        <p class="note">ชั้น 1: 101 สำนักงาน · 102 ห้องซักผ้า · 103 Kiosk</p></div>
      <div class="card"><b>ที่จอดรถ</b>
        ${Object.keys(ZONES).map(z => { const zs = slots.filter(s => s.zone === z), u = zs.filter(s => s.room).length;
          return `<div class="rowbar"><span>${ZONES[z]}</span><div class="bar"><b style="width:${zs.length ? u / zs.length * 100 : 0}%;${z === 'CAR' ? 'background:var(--ok)' : ''}"></b></div><span>${u}/${zs.length}</span></div>`; }).join('')}
        <p class="note"><a href="#" data-go="parking">เปิดผังที่จอดรถ →</a></p></div>
      <div class="card"><b>บิลค้าง / รอชำระ</b>
        ${unpaid.length ? `<table class="tbl" style="margin-top:8px">${unpaid.sort((a, b) => a.room.localeCompare(b.room)).slice(0, 12).map(b => {
          const s = M.billState(b), t = M.tenantOf(b.room);
          return `<tr><td><b>${b.room}</b></td><td>${esc(t?.name || b.tenantName || '')}</td><td>${periodLabel(b.period, true)}</td><td class="n">฿${fmt0(M.calcBill(b).balance)}</td><td><button class="pill ${M.BILL_TXT[s][1]} pay-btn" data-pay="${b.id}" title="กดเพื่อรับชำระเงิน">${M.BILL_TXT[s][0]} 💰</button></td></tr>`; }).join('')}</table>
          ${unpaid.length > 12 ? `<p class="note">และอีก ${unpaid.length - 12} รายการ</p>` : ''}` : '<p class="note">ไม่มีบิลค้าง 🎉</p>'}</div>
      <div class="card"><b>งานที่ต้องทำ</b>
        <ul style="margin:8px 0 0;padding-left:20px;line-height:2">
          <li>บิล${periodLabel(cur)}: ออกแล้ว ${billed} ห้อง <a href="#" data-go="billing">ไปจดมิเตอร์ →</a></li>
          ${noPhoto.length ? `<li>⚠️ ผู้เช่า <b>${noPhoto.length}</b> ราย ยังไม่มีรูปบัตรประชาชน <a href="#" data-go="tenants">แนบรูป →</a></li>` : ''}
          ${incomplete ? `<li>⚠️ ผู้เช่า <b>${incomplete}</b> ราย ข้อมูลไม่ครบ (เบอร์โทร / เลขบัตร / วันเกิด / ที่อยู่ / รูปบัตร) <a href="#" data-go="tenants">ดูรายชื่อ →</a></li>` : ''}
          ${slipBad.length ? `<li style="color:var(--bad)">⛔ สลิปไม่ตรงกับยอด/งวด <b>${slipBad.length}</b> รายการ: ${slipBad.map(b => `<a href="#" data-pdet="${b.id}">${b.room}</a>`).join(', ')}</li>` : ''}
          ${missingBirthdays() ? `<li>ผู้เช่า <b>${missingBirthdays()}</b> ราย ยังไม่มีวันเดือนปีเกิด <a href="#" data-go="tenants">เพิ่มข้อมูล →</a></li>` : ''}
          <li>ผู้เช่าที่ผูก LINE แล้ว ${db.all('lineLinks').filter(l => l.active !== false).length}/${tenants.length} ห้อง</li>
        </ul></div>
      <div class="card" style="grid-column:1/-1"><b>🎂 วันเกิดผู้เช่าเดือนนี้ (${bdays.length} คน)</b>
        ${bdays.length ? `<div style="margin-top:8px">${birthdayTable(bdays)}</div>` : '<p class="note">ไม่มีผู้เช่าเกิดเดือนนี้ หรือยังไม่ได้บันทึกวันเกิด</p>'}</div>
    </div>`;
    el.querySelectorAll('[data-go]').forEach(a => a.onclick = e => { e.preventDefault(); nav.go(a.dataset.go); });
    el.querySelectorAll('[data-pdet]').forEach(a => a.onclick = e => { e.preventDefault(); openPaymentDetail(db.get('bills', a.dataset.pdet), () => this.render(el, nav)); });
    el.querySelectorAll('[data-pay]').forEach(x => x.onclick = () => openPayment(db.get('bills', x.dataset.pay), () => this.render(el, nav)));
    el.querySelectorAll('[data-kpi]').forEach(x => x.onclick = () => kpiDetail(x.dataset.kpi, { unpaid, late }, nav, () => this.render(el, nav)));
  },
};

// ---------- กดการ์ดตัวเลขด้านบน → ป๊อปอัปรายละเอียด (กดแถวเพื่อไปที่ห้อง / รับชำระ) ----------
function kpiDetail(kind, { unpaid, late }, nav, rerender) {
  const roomRow = (r, cols) => `<tr class="click" data-goroom="${r.id}">${cols}</tr>`;
  const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
  let title, body;
  if (kind === 'rooms') {
    const all = M.rooms(), vac = all.filter(r => !M.tenantOf(r.id) && r.kind === 'room');
    const view = f => {
      const list = all.filter(r => f === 'vac' ? !M.tenantOf(r.id) && r.kind === 'room' : f === 'occ' ? M.tenantOf(r.id) : true);
      return `<table class="tbl"><thead><tr><th>ห้อง</th><th>สถานะ</th><th>ผู้เช่า</th><th>โทร</th><th>เข้าพัก</th><th class="n">ค่าเช่า</th></tr></thead><tbody>${list.map(r => {
        const t = M.tenantOf(r.id), st = M.roomState(r);
        return roomRow(r, `<td><b>${r.id}</b>${r.kind !== 'room' ? ` <span class="note">${esc(r.label)}</span>` : ''}</td><td><span class="pill ${M.ROOM_TXT[st][1]}">${M.ROOM_TXT[st][0]}</span></td>
          <td>${esc(t?.name || '-')}</td><td>${esc(t?.phone || '')}</td><td>${t?.since ? thDate(t.since) : ''}</td><td class="n">${fmt0(t?.rent ?? r.rent)}</td>`);
      }).join('')}</tbody></table>`;
    };
    title = '🏢 ห้องพัก';
    body = `<div class="seg" id="kf" style="margin-bottom:10px"><button data-kf="all" class="on">ทั้งหมด (${all.length})</button><button data-kf="occ">มีผู้เช่า (${all.filter(r => M.tenantOf(r.id)).length})</button><button data-kf="vac">ห้องว่าง (${vac.length})</button></div>
      ${vac.length ? `<p class="note" style="margin-top:0">ห้องว่าง: <b>${vac.map(r => r.id).join(', ')}</b></p>` : '<p class="note" style="margin-top:0">ไม่มีห้องพักว่าง</p>'}
      <div id="kbody">${view('all')}</div>`;
    const box = show(title, body);
    box.querySelectorAll('[data-kf]').forEach(b => b.onclick = () => {
      box.querySelectorAll('[data-kf]').forEach(x => x.classList.toggle('on', x === b));
      box.querySelector('#kbody').innerHTML = view(b.dataset.kf); wire(box);
    });
    return;
  }
  if (kind === 'late' || kind === 'due') {
    const list = (kind === 'late' ? late : unpaid.filter(b => !late.includes(b))).sort((a, b) => a.room.localeCompare(b.room) || a.period.localeCompare(b.period));
    title = kind === 'late' ? '⏰ บิลเกินกำหนด' : '🧾 บิลรอชำระ';
    body = list.length ? `<table class="tbl"><thead><tr><th>ห้อง</th><th>ผู้เช่า</th><th>งวด</th><th>ครบกำหนด</th><th class="n">ยอดบิล</th><th class="n">คงค้าง</th><th></th></tr></thead><tbody>${list.map(b => {
      const c = M.calcBill(b), s = M.billState(b), dd = b.dueDate || M.dueDate(b.period);
      const days = Math.floor((Date.now() - new Date(dd)) / 864e5);
      return `<tr><td><b>${b.room}</b></td><td>${esc(M.tenantOf(b.room)?.name || b.tenantName || '')}</td><td>${periodLabel(b.period, true)}</td>
        <td>${thDate(dd)}${days > 0 ? ` <span class="note" style="color:var(--bad)">(${days} วัน)</span>` : ''}</td><td class="n">${fmt0(c.total)}</td><td class="n"><b>${fmt0(c.balance)}</b></td>
        <td><button class="pill ${M.BILL_TXT[s][1]} pay-btn" data-kpay="${b.id}">${M.BILL_TXT[s][0]} 💰</button></td></tr>`;
    }).join('')}</tbody><tfoot><tr><td colspan="5"><b>รวม ${list.length} บิล</b></td><td class="n"><b>${fmt0(sum(list, b => M.calcBill(b).balance))}</b></td><td></td></tr></tfoot></table>`
      : '<p class="note">ไม่มีรายการ 🎉</p>';
  }
  if (kind === 'fridge') {
    const list = db.all('tenants').filter(t => t.active && t.fridge).sort((a, b) => a.room.localeCompare(b.room));
    title = '🧊 ตู้เย็นให้เช่า';
    body = `<table class="tbl"><thead><tr><th>ห้อง</th><th>ผู้เช่า</th><th>โทร</th><th class="n">ค่าเช่าตู้เย็น/เดือน</th></tr></thead><tbody>${list.map(t =>
      roomRow({ id: t.room }, `<td><b>${t.room}</b></td><td>${esc(t.name)}</td><td>${esc(t.phone || '')}</td><td class="n">${fmt0(t.fridge)}</td>`)).join('')}</tbody>
      <tfoot><tr><td colspan="3"><b>รวม ${list.length} ตู้</b></td><td class="n"><b>${fmt0(sum(list, t => Number(t.fridge) || 0))}</b></td></tr></tfoot></table>`;
  }
  if (kind === 'fixed') {
    const list = M.rooms().map(r => {
      const t = M.tenantOf(r.id), rent = t || r.kind === 'kiosk' ? Number(r.rent) || 0 : 0;
      return { r, t, rent, fridge: Number(t?.fridge) || 0, park: Number(t?.parkingFee) || 0 };
    }).filter(x => x.rent + x.fridge + x.park);
    const tot = k => sum(list, x => x[k]);
    title = '💵 รายรับคงที่/เดือน';
    body = `<table class="tbl"><thead><tr><th>ห้อง</th><th>ผู้เช่า</th><th class="n">ค่าเช่า</th><th class="n">ตู้เย็น</th><th class="n">ที่จอดรถ</th><th class="n">รวม</th></tr></thead><tbody>${list.map(x =>
      roomRow(x.r, `<td><b>${x.r.id}</b></td><td>${esc(x.t?.name || x.r.label || '')}</td><td class="n">${fmt0(x.rent)}</td><td class="n">${x.fridge ? fmt0(x.fridge) : '-'}</td><td class="n">${x.park ? fmt0(x.park) : '-'}</td><td class="n">${fmt0(x.rent + x.fridge + x.park)}</td>`)).join('')}</tbody>
      <tfoot><tr><td colspan="2"><b>รวม</b></td><td class="n"><b>${fmt0(tot('rent'))}</b></td><td class="n"><b>${fmt0(tot('fridge'))}</b></td><td class="n"><b>${fmt0(tot('park'))}</b></td><td class="n"><b>${fmt0(tot('rent') + tot('fridge') + tot('park'))}</b></td></tr></tfoot></table>
      <p class="note">ไม่รวมค่าน้ำ ค่าไฟ ซึ่งคิดตามมิเตอร์แต่ละเดือน</p>`;
  }
  show(title, body);

  function show(h, html) {
    const box = openModal(`<h3>${h}</h3><div class="scroll" style="max-height:62vh">${html}</div>
      <p class="note">กดที่แถวเพื่อเปิดห้องในผังห้อง</p><div class="form-acts"><button class="btn" id="k-x">ปิด</button></div>`, { wide: true });
    box.querySelector('#k-x').onclick = closeModal;
    wire(box);
    return box;
  }
  function wire(box) {
    box.querySelectorAll('[data-goroom]').forEach(tr => tr.onclick = () => { closeModal(); nav.go('floorplan', { room: tr.dataset.goroom }); });
    box.querySelectorAll('[data-kpay]').forEach(x => x.onclick = () => openPayment(db.get('bills', x.dataset.kpay), rerender));
  }
}
