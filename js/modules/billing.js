// จดมิเตอร์ → ออกใบแจ้งหนี้ → พิมพ์ / ส่ง LINE OA → รับชำระ (เต็ม/บางส่วน) → ใบเสร็จ
// รอบบิลแบบโปรแกรมเดิม: บิลเดือน M = ค่าเช่าเดือน M + น้ำไฟจากมิเตอร์ที่จดปลายเดือน M-1
import * as db from '../core/db.js';
import * as M from '../core/model.js';
import * as auth from '../core/auth.js';
import { isServerMode } from '../core/config.js';
import { docHtml, docCss, printDocs } from '../core/docs.js';
import { esc, fmt, fmt0, toast, openModal, closeModal, confirmBox, periodLabel, periodOf, shiftPeriod, thDate, uid } from '../core/ui.js';
import * as api from '../core/api.js';
import { compress, fileToDataUrl, photoThumb } from './tenants.js';
import { decodeQR, parseSlipQR, parseSlipText, imageHash, findDuplicate, ocrLocal, verifySlip, slipIssues } from '../core/slip.js';

// บิลที่มีการรับชำระซึ่งผลตรวจสลิปไม่ผ่าน (และยังไม่ได้ยืนยัน)
export const hasSlipIssue = b => (b.payments || []).some(p => p.slipCheck && !p.slipCheck.acknowledged && slipIssues(p.slipCheck.checks).length);
// ผลตรวจสลิปเป็นรายการ ✅ / ⚠️ / ⛔
export const verifyHtml = checks => (checks || []).length ? `<div class="verify">${checks.map(c =>
  `<div class="v-${c.level}">${c.level === 'ok' ? '✅' : c.level === 'warn' ? '⚠️' : '⛔'} ${esc(c.text)}</div>`).join('')}</div>` : '';

let period = M.workingPeriod(), focusRoom = null, meterDate = new Date().toISOString().slice(0, 10);
const LINE_TXT = { queued: '⏳ รอส่ง LINE', sent: '✅ ส่ง LINE แล้ว', 'no-link': '⚠️ ห้องยังไม่ผูก LINE' };
const isCommon = room => ['office', 'laundry'].includes(db.get('rooms', room)?.kind) && !M.tenantOf(room);

// บิลของห้องในเดือนที่เลือก (ถ้ายังไม่มีให้สร้างร่างในหน่วยความจำ)
function billFor(r) {
  const ex = db.get('bills', M.billId(period, r.id));
  if (ex) return ex;
  const t = M.tenantOf(r.id), pm = M.prevMeters(r.id, period), rt = M.roomRates(r, t);   // อัตราน้ำ/ไฟตามสัญญาผู้เช่า
  const lastName = db.all('bills').filter(b => b.room === r.id).sort((a, b) => b.period.localeCompare(a.period))[0]?.tenantName;
  return { id: M.billId(period, r.id), period, room: r.id, tenantId: t?.id || '', tenantName: t?.name || lastName || r.label || '', lang: t?.lang || 'th',
    rent: t ? Number(t.rent ?? r.rent) || 0 : (r.kind === 'room' ? 0 : Number(r.rent) || 0),
    wPrev: pm.w, wCur: null, wRate: rt.water, ePrev: pm.e, eCur: null, eRate: rt.elec,
    fridge: Number(t?.fridge) || 0, parking: Number(t?.parkingFee) || 0, items: [], payments: [], status: 'draft', _new: true };
}
const rowsFor = () => M.rooms().filter(r => r.kind !== 'room' || M.tenantOf(r.id) || db.get('bills', M.billId(period, r.id))).map(billFor);

function prevUnits(room) {
  const b = db.all('bills').filter(x => x.room === room && x.period < period).sort((a, c) => c.period.localeCompare(a.period))[0];
  return b ? M.calcBill(b) : null;
}
const odd = b => { const c = M.calcBill(b), p = prevUnits(b.room);
  return (c.wu != null && c.wu < 0) || (c.eu != null && c.eu < 0) || (p && c.eu != null && p.eu > 0 && c.eu > p.eu * 2.5) || (p && c.wu != null && p.wu > 0 && c.wu > p.wu * 3); };

// เก็บยอดที่คำนวณไว้ในบิลด้วย (ให้ Google Sheet อ่านง่าย)
async function save(b) {
  const { _new, ...rec } = b, c = M.calcBill(rec);
  return db.put('bills', { ...rec, water: c.water, elec: c.elec, total: c.total, paidTotal: c.paid });
}

async function issue(b) {
  if (b.status !== 'draft') return b;
  return save({ ...b, status: 'issued', issuedAt: new Date().toISOString(), dueDate: M.dueDate(b.period), invoiceNo: b.invoiceNo || M.nextInvoiceNo(b.period) });
}

async function sendLine(list) {
  if (!isServerMode()) { toast('ต้องเชื่อม Google และตั้งค่า LINE OA ก่อน (เมนูตั้งค่า)', 4000); return false; }
  for (const b0 of list) {
    const b = await issue(b0);
    await save({ ...b, lineStatus: 'queued' });
    await db.queue({ kind: 'line', billId: b.id });
  }
  toast(navigator.onLine ? `กำลังส่ง ${list.length} บิลเข้า LINE…` : `บันทึกแล้ว — จะส่ง LINE ${list.length} บิลเมื่อมีอินเทอร์เน็ต`, 3500);
  return true;
}

// ---------- รับชำระเงิน: ช่องทาง ยอด ค่าปรับ รายการอื่น ชำระบางส่วน แนบสลิป / ให้ AI อ่านสลิป ----------
const METHODS = ['โอนเงิน', 'พร้อมเพย์ / สแกน QR', 'เงินสด', 'เช็ค', M.DEPOSIT_METHOD];
const METHOD_ICON = { 'โอนเงิน': '🏦', 'พร้อมเพย์ / สแกน QR': '📱', 'เงินสด': '💵', 'เช็ค': '🧾', [M.DEPOSIT_METHOD]: '🔐' };
export async function openPayment(b, done) {
  if (!M.calcBill(b).ready) return toast('ยังจดมิเตอร์ไม่ครบ ออกบิลไม่ได้');
  const c = M.calcBill(b), today = new Date().toISOString().slice(0, 10);
  const lateDays = Math.max(0, Math.floor((new Date(today) - new Date(b.dueDate || M.dueDate(b.period))) / 864e5));
  let extras = [], slip = null, ai = null;
  const box = openModal(`<h3>💰 รับชำระเงิน — ห้อง ${b.room}</h3>
    <p class="note" style="margin-top:-8px">${esc(b.tenantName)} · บิล${periodLabel(b.period)} · เลขที่ ${esc(b.invoiceNo || '-')}</p>
    <div class="kpis" style="margin-bottom:8px">
      <div class="card kpi"><div class="v" style="font-size:20px">฿${fmt(c.total)}</div><div class="l">ยอดบิล</div></div>
      <div class="card kpi"><div class="v" style="font-size:20px">฿${fmt(c.paid)}</div><div class="l">ชำระแล้ว</div></div>
      <div class="card kpi"><div class="v" style="font-size:20px;color:var(--bad)">฿${fmt(c.balance)}</div><div class="l">ค้างชำระ${lateDays ? ` · เกินกำหนด ${lateDays} วัน` : ''}</div></div></div>
    <form class="form" onsubmit="return false">
      <label>ค่าปรับ</label><input id="py-fine" type="number" min="0" step="10" value="0" placeholder="บาท">
      <label class="full" style="display:flex;justify-content:space-between;align-items:center"><span>รายการอื่น</span><button class="btn sm" type="button" id="py-add">＋ เพิ่มรายการ</button></label>
      <div class="full" id="py-extras"></div>
      <label>ช่องทางชำระ</label><div class="seg" id="py-methods" style="flex-wrap:wrap">${METHODS.map((m, i) => `<button type="button" data-m="${m}" class="${i === 0 ? 'on' : ''}">${METHOD_ICON[m]} ${m}</button>`).join('')}</div>
      <label class="py-dep" hidden>เงินประกัน</label><div class="py-dep note" hidden id="py-depinfo"></div>
      <label class="py-cash" hidden>รับเงินมา</label><div class="py-cash toolbar" hidden><input class="input" id="py-given" type="number" min="0" step="1" placeholder="บาท" style="width:140px;text-align:right">
        <span>เงินทอน <b id="py-change" style="font-size:18px">-</b></span></div>
      <label class="full py-slip" style="margin-top:4px">หลักฐานการโอน (สลิป)</label>
      <div class="full photo-box py-slip" id="py-slipbox"><div id="py-slipview"><p class="note" style="margin:0">ไม่บังคับ — แนบสลิปแล้วระบบอ่าน QR ตรวจสลิปซ้ำ และอ่านยอด วันที่ เลขอ้างอิงให้</p></div>
        <div class="acts" style="justify-content:center">
          <label class="btn" for="py-file">📎 แนบสลิป</label><input id="py-file" type="file" accept="image/*" hidden>
          <label class="btn" for="py-cam">📷 ถ่ายรูป</label><input id="py-cam" type="file" accept="image/*" capture="environment" hidden>
          <button class="btn" type="button" id="py-ocr" disabled title="ฟรี — ใช้ Google OCR (ต้องเชื่อม Google)">🔍 อ่านซ้ำด้วย Google</button>
          ${M.property().claudeSlip ? '<button class="btn" type="button" id="py-ai" disabled title="แม่นกว่า มีค่าใช้จ่ายต่อสลิป">🤖 Claude อ่าน</button>' : ''}</div>
        <div class="note" id="py-aimsg"></div></div>
      <label>วันที่ชำระ</label><input id="py-date" type="date" value="${today}" max="${today}">
      <label class="req">จำนวนเงินที่รับ</label><input id="py-amt" type="number" min="0" step="0.01">
      <label>เลขอ้างอิง / หมายเหตุ</label><input id="py-ref" placeholder="เช่น เลขที่รายการจากสลิป">
    </form>
    <div class="card" style="margin-top:12px;padding:12px">
      <div class="toolbar" style="justify-content:space-between"><span>ยอดที่ต้องชำระทั้งหมด</span><b id="py-due"></b></div>
      <div class="toolbar" style="justify-content:space-between;margin-top:4px;font-size:17px"><span id="py-lbl"></span><b id="py-left"></b></div></div>
    <div id="py-verify"></div>
    <div class="err" id="py-err"></div>
    <div class="form-acts"><button class="btn" id="py-x">ยกเลิก</button>
      <button class="btn cash" id="py-cashfull" title="รับเงินสดเต็มยอด บันทึก และพิมพ์ใบเสร็จทันที">💵 รับเงินสดเต็มจำนวน</button>
      <button class="btn" id="py-ok">บันทึกรับชำระ</button><button class="btn pri" id="py-print">บันทึก + พิมพ์ใบเสร็จ</button></div>`, { wide: true });
  const $b = s => box.querySelector(s), num = s => Number($b(s).value) || 0;
  const due = () => Math.round((c.balance + num('#py-fine') + extras.reduce((a, o) => a + (Number(o.amount) || 0), 0)) * 100) / 100;
  let amtTouched = false;
  let calc = () => {
    const d = due(); if (!amtTouched) $b('#py-amt').value = d;
    const left = Math.round((d - num('#py-amt')) * 100) / 100;
    $b('#py-due').textContent = '฿' + fmt(d);
    $b('#py-lbl').textContent = left > 0 ? 'ชำระบางส่วน — คงเหลือค้างชำระ' : left < 0 ? 'ชำระเกิน' : 'ชำระครบ';
    $b('#py-left').textContent = left ? '฿' + fmt(Math.abs(left)) : '✔';
    $b('#py-left').style.color = left > 0 ? 'var(--warn)' : left < 0 ? 'var(--bad)' : 'var(--ok)';
  };
  const drawExtras = () => {
    $b('#py-extras').innerHTML = extras.map((o, i) => `<div class="toolbar" style="margin-bottom:6px">
      <input class="input" data-x="${i}" data-k="name" value="${esc(o.name)}" placeholder="รายการ เช่น ค่ากุญแจหาย" style="flex:1;min-width:160px">
      <input class="input" data-x="${i}" data-k="amount" type="number" value="${o.amount}" placeholder="บาท" style="width:110px;text-align:right">
      <button class="btn sm" type="button" data-xrm="${i}">✕</button></div>`).join('');
    box.querySelectorAll('[data-x]').forEach(inp => inp.oninput = () => { extras[+inp.dataset.x][inp.dataset.k] = inp.value; calc(); });
    box.querySelectorAll('[data-xrm]').forEach(x => x.onclick = () => { extras.splice(+x.dataset.xrm, 1); drawExtras(); calc(); });
  };
  $b('#py-add').onclick = () => { extras.push({ name: '', amount: '' }); drawExtras(); box.querySelector(`[data-x="${extras.length - 1}"][data-k="name"]`).focus(); };
  $b('#py-fine').oninput = calc;
  $b('#py-amt').oninput = () => { amtTouched = true; calc(); };

  // ช่องทางชำระ: เงินสด → แสดงช่องรับเงินมา/เงินทอน · หักเงินประกัน → แสดงยอดประกันคงเหลือ · ทั้งสองแบบซ่อนส่วนสลิป
  const tenant = db.get('tenants', b.tenantId) || M.tenantOf(b.room), depLeft = M.depositLeft(tenant);
  let method = METHODS[0];
  const setMethod = m => {
    method = m;
    box.querySelectorAll('#py-methods [data-m]').forEach(x => x.classList.toggle('on', x.dataset.m === m));
    const cash = m === 'เงินสด', dep = m === M.DEPOSIT_METHOD;
    box.querySelectorAll('.py-cash').forEach(x => x.hidden = !cash);
    box.querySelectorAll('.py-dep').forEach(x => x.hidden = !dep);
    box.querySelectorAll('.py-slip').forEach(x => x.hidden = cash || dep);
    if (dep) {
      $b('#py-depinfo').innerHTML = tenant ? `เงินประกัน ฿${fmt(tenant.deposit)} · หักไปแล้ว ฿${fmt(M.depositUsed(tenant))} · <b style="color:var(--ok)">คงเหลือใช้ได้ ฿${fmt(depLeft)}</b>`
        : '<span style="color:var(--bad)">ไม่พบผู้เช่าของบิลนี้</span>';
      if (!amtTouched || num('#py-amt') > depLeft) { $b('#py-amt').value = Math.min(due(), depLeft); amtTouched = true; }
    }
    if (cash) $b('#py-given').focus();
    calc();
  };
  box.querySelectorAll('#py-methods [data-m]').forEach(x => x.onclick = () => setMethod(x.dataset.m));
  const calcChange = () => {
    const given = num('#py-given'), amt = num('#py-amt');
    $b('#py-change').textContent = given ? (given >= amt ? '฿' + fmt(given - amt) : 'รับเงินไม่พอ') : '-';
    $b('#py-change').style.color = given && given < amt ? 'var(--bad)' : 'var(--ok)';
  };
  $b('#py-given').oninput = calcChange;
  const calc0 = calc; calc = () => { calc0(); calcChange(); };
  calc();

  // สลิป
  // สลิป: แนบแล้วอ่าน QR ทันที (ฟรี ในเครื่อง) + ตรวจสลิปซ้ำ → ปุ่มอ่านยอดด้วย OCR ฟรี / Claude (ถ้าเปิดใช้)
  let slipRef = '', slipHash = '', dup = null, slipRead = null, checks = [];
  const msg = h => { $b('#py-aimsg').innerHTML = h; };
  // ตรวจสลิปเทียบยอดที่ต้องชำระ / ยอดที่บันทึก / งวดของบิล
  const renderVerify = () => {
    const acked = !!$b('#py-ack')?.checked;   // คงสถานะติ๊กยืนยันไว้เมื่อวาดใหม่
    if (!slipRead) { checks = []; $b('#py-verify').innerHTML = ''; return; }
    checks = verifySlip(slipRead, { amount: num('#py-amt'), date: $b('#py-date').value }, { ...M.payWindow(b), expected: due() });
    const bad = slipIssues(checks).length;
    $b('#py-verify').innerHTML = `<div class="card" style="margin-top:10px;padding:10px 12px"><b>ผลตรวจสลิป</b>${verifyHtml(checks)}
      ${bad ? `<label style="display:flex;gap:8px;align-items:center;margin-top:6px;color:var(--bad)"><input type="checkbox" id="py-ack" ${acked ? 'checked' : ''}> ตรวจสอบแล้ว ยืนยันบันทึกแม้ผลตรวจไม่ผ่าน</label>` : ''}</div>`;
  };
  ['#py-amt', '#py-date', '#py-fine'].forEach(s => $b(s).addEventListener('input', renderVerify));
  const showDup = () => dup && msg(`⛔ <b>สลิปนี้เคยใช้แล้ว</b> — ห้อง ${dup.bill.room} บิล${periodLabel(dup.bill.period, true)} รับเมื่อ ${thDate(dup.payment.date)} ฿${fmt(dup.payment.amount)} (${esc(dup.payment.receiptNo || '')})`);
  const applyRead = (r, source) => {
    if (r.amount > 0) { $b('#py-amt').value = r.amount; amtTouched = true; }
    if (/^\d{4}-\d{2}-\d{2}$/.test(r.date)) $b('#py-date').value = r.date;
    if (r.reference && !slipRef) { slipRef = r.reference; dup = findDuplicate({ ref: slipRef }); }
    $b('#py-ref').value = [slipRef || r.reference, r.from_bank && 'จาก ' + r.from_bank].filter(Boolean).join(' · ');
    setMethod('โอนเงิน'); calc();
    slipRead = { amount: r.amount, date: r.date, time: r.time, ref: r.reference, source };
    renderVerify();
    if (dup) return showDup();
    msg(`✅ ${source}: ${r.amount > 0 ? `<b>฿${fmt(r.amount)}</b>` : '<span style="color:var(--warn)">อ่านยอดไม่ได้ กรุณากรอกเอง</span>'}${r.date ? ' · ' + esc(r.date) : ''} ${esc(r.time || '')}${slipRef ? ' · อ้างอิง ' + esc(slipRef) : ''} — <b>กรุณาตรวจทานก่อนบันทึก</b>`);
  };
  const onSlip = async e => {
    const f = e.target.files[0]; if (!f) return;
    slip = await compress(await fileToDataUrl(f), 1600); ai = null; slipRef = ''; dup = null; slipRead = null; renderVerify();
    $b('#py-slipview').innerHTML = `<img class="thumb" style="margin:0 auto;max-height:260px;width:auto" src="${slip}" alt="สลิป">`;
    $b('#py-ocr').disabled = false; if ($b('#py-ai')) $b('#py-ai').disabled = false;
    msg('🔍 กำลังอ่าน QR บนสลิป…');
    slipHash = await imageHash(slip);
    let qr = null;
    try { qr = parseSlipQR(await decodeQR(slip)); } catch {}
    if (qr) { slipRef = qr.ref; $b('#py-ref').value = `${qr.ref} · จาก ${qr.bank}`; setMethod('โอนเงิน'); }
    dup = findDuplicate({ ref: slipRef, hash: slipHash });
    if (dup) return showDup();
    const qrTxt = qr ? `QR สลิป: ธนาคาร${esc(qr.bank)} · เลขอ้างอิง ${esc(qr.ref)} · ยังไม่เคยใช้` : 'ไม่พบ QR ของสลิป';
    // อ่านยอด/วันที่ในเครื่อง (ฟรี) ทันที
    msg(`${qrTxt}<br>🔍 กำลังอ่านยอดและวันที่จากสลิป…`);
    try {
      const text = await ocrLocal(slip, p => msg(`${qrTxt}<br>🔍 กำลังอ่านยอดและวันที่จากสลิป… ${p}%`));
      applyRead(parseSlipText(text), 'อ่านจากสลิป (ในเครื่อง)');
    } catch (e) { msg(`${qrTxt}<br>อ่านยอดในเครื่องไม่สำเร็จ (${esc(e.message)}) — กด "อ่านซ้ำด้วย Google" หรือกรอกเอง`); }
  };
  $b('#py-file').onchange = onSlip; $b('#py-cam').onchange = onSlip;
  const needServer = () => {
    if (!isServerMode()) { msg('การอ่านข้อความจากสลิปใช้ได้เมื่อเชื่อม Google แล้ว (ตั้งค่า → เชื่อม Google) — ตอนนี้กรอกเองได้'); return false; }
    if (!navigator.onLine) { msg('ออฟไลน์อยู่ — กรอกข้อมูลเองได้ แล้วสลิปจะอัปโหลดเมื่อมีสัญญาณ'); return false; }
    return true;
  };
  $b('#py-ocr').onclick = async () => {   // ฟรี: Google Drive OCR
    if (!needServer()) return;
    $b('#py-ocr').disabled = true; msg('🔍 กำลังอ่านข้อความจากสลิป (Google OCR)…');
    try { applyRead(parseSlipText((await api.call('ocrSlip', { dataUrl: slip })).text), 'อ่านจากสลิป (ฟรี)'); }
    catch (e) { msg('อ่านสลิปไม่สำเร็จ: ' + esc(e.message) + ' — กรอกเองได้'); }
    finally { $b('#py-ocr').disabled = false; }
  };
  $b('#py-ai')?.addEventListener('click', async () => {   // ทางเลือก: Claude (มีค่าใช้จ่าย)
    if (!needServer()) return;
    $b('#py-ai').disabled = true; msg('🤖 Claude กำลังอ่านสลิป…');
    try {
      const r = (await api.call('readSlip', { dataUrl: slip })).slip;
      if (!r.is_slip) return msg('⚠️ รูปนี้ไม่น่าจะเป็นสลิปโอนเงิน กรุณาตรวจสอบหรือกรอกเอง');
      ai = r; applyRead(r, `Claude อ่านแล้ว (${esc(r.from_name)} → ${esc(r.to_name)})`);
    } catch (e) { msg('อ่านสลิปไม่สำเร็จ: ' + esc(e.message) + ' — กรอกเองได้'); }
    finally { $b('#py-ai').disabled = false; }
  });
  $b('#py-x').onclick = closeModal;

  const commit = async print => {
    const amt = num('#py-amt');
    if (!(amt > 0)) return $b('#py-err').textContent = 'กรุณาใส่จำนวนเงินที่รับ';
    if (extras.some(o => (Number(o.amount) || 0) && !o.name.trim())) return $b('#py-err').textContent = 'กรุณาใส่ชื่อรายการอื่นให้ครบ';
    if (method === M.DEPOSIT_METHOD && amt > depLeft) return $b('#py-err').textContent = `เงินประกันคงเหลือไม่พอ (ใช้ได้ ฿${fmt(depLeft)})`;
    if (slip && (dup = findDuplicate({ ref: slipRef, hash: slipHash }))) { showDup(); return $b('#py-err').textContent = 'สลิปนี้เคยใช้รับชำระแล้ว บันทึกซ้ำไม่ได้'; }
    renderVerify();
    if (slipIssues(checks).length && !$b('#py-ack')?.checked) return $b('#py-err').textContent = 'ผลตรวจสลิปไม่ผ่าน — ตรวจสอบยอด/วันที่ หรือติ๊กยืนยันก่อนบันทึก';
    let nb = await issue(b);
    const add = [];
    if (num('#py-fine') > 0) add.push({ name: lateDays ? `ค่าปรับชำระล่าช้า (${lateDays} วัน)` : 'ค่าปรับ', qty: 1, price: num('#py-fine'), amount: num('#py-fine') });
    for (const o of extras) if (Number(o.amount)) add.push({ name: o.name.trim(), qty: 1, price: Number(o.amount), amount: Number(o.amount) });
    let slipId = '';
    if (slip) {
      slipId = uid('slip-');
      await db.putPhoto({ id: slipId, dataUrl: slip, name: `สลิป-${b.room}-${b.period}-${$b('#py-date').value}.jpg`, billId: b.id, createdAt: new Date().toISOString() });
      await db.queue({ kind: 'photo', photoId: slipId, folder: 'slip' });
    }
    const pay = { date: $b('#py-date').value, amount: amt, method, ref: $b('#py-ref').value.trim(), slipId, slipRef, slipHash, aiRead: !!ai,
      slipRead: slipRead || null, slipCheck: checks.length ? { at: new Date().toISOString(), checks, acknowledged: !!$b('#py-ack')?.checked } : null,
      by: auth.current().email, receiptNo: M.nextInvoiceNo(b.period, 'R') };
    const items = [...(nb.items || []), ...add], payments = [...(nb.payments || []), pay], cc = M.calcBill({ ...nb, items, payments });
    nb = await save({ ...nb, items, payments, status: cc.balance <= 0 ? 'paid' : 'issued', paidAt: cc.balance <= 0 ? pay.date : '' });
    closeModal();
    toast(cc.balance <= 0 ? `ห้อง ${b.room} ชำระครบแล้ว` : `รับชำระบางส่วน — คงค้าง ฿${fmt(cc.balance)}`, 3500);
    if (print) printDocs([nb], { type: 'receipt', payment: pay });
    done?.(nb);
  };
  $b('#py-ok').onclick = () => commit(false);
  $b('#py-print').onclick = () => commit(true);
  // รับเงินสดเต็มยอด (รวมค่าปรับ/รายการอื่นที่ใส่ไว้) → บันทึก + พิมพ์ใบเสร็จในคลิกเดียว
  $b('#py-cashfull').onclick = () => { setMethod('เงินสด'); amtTouched = false; calc(); commit(true); };
}

// ---------- รายละเอียดการชำระ: ดูการโอน/สลิป · แก้ไข · ลบ · พิมพ์ใบเสร็จ ----------
export function openPaymentDetail(b, done) {
  const c = M.calcBill(b), pays = b.payments || [];
  const box = openModal(`<h3>🧾 การชำระเงิน — ห้อง ${b.room}</h3>
    <p class="note" style="margin-top:-8px">${esc(b.tenantName)} · บิล${periodLabel(b.period)} · เลขที่ ${esc(b.invoiceNo || '-')} ·
      <span class="pill ${M.BILL_TXT[M.billState(b)][1]}">${M.BILL_TXT[M.billState(b)][0]}</span></p>
    <div class="kpis" style="margin-bottom:8px">
      <div class="card kpi"><div class="v" style="font-size:20px">฿${fmt(c.total)}</div><div class="l">ยอดบิล</div></div>
      <div class="card kpi"><div class="v" style="font-size:20px;color:var(--ok)">฿${fmt(c.paid)}</div><div class="l">ชำระแล้ว ${pays.length} ครั้ง</div></div>
      <div class="card kpi"><div class="v" style="font-size:20px;color:${c.balance > 0 ? 'var(--bad)' : 'inherit'}">฿${fmt(Math.max(0, c.balance))}</div><div class="l">คงค้าง</div></div></div>
    ${pays.map((p, i) => `<div class="card" style="margin-bottom:10px" data-p="${i}">
      <div style="display:flex;gap:14px;flex-wrap:wrap">
        <div style="flex:1;min-width:240px"><dl class="kvs">
          <dt>ใบเสร็จ</dt><dd><b>${esc(p.receiptNo || '-')}</b></dd>
          <dt>วันที่ชำระ</dt><dd>${p.date ? thDate(p.date) : '-'}</dd>
          <dt>จำนวนเงิน</dt><dd><b>฿${fmt(p.amount)}</b></dd>
          <dt>ช่องทาง</dt><dd>${METHOD_ICON[p.method] || ''} ${esc(p.method || p.note || '-')}</dd>
          <dt>เลขอ้างอิง</dt><dd>${esc(p.ref || p.slipRef || '-')}</dd>
          <dt>บันทึกโดย</dt><dd class="note">${esc(p.by || (b.legacy ? 'นำเข้าจากโปรแกรมเดิม' : '-'))}${p.aiRead ? ' · อ่านสลิปด้วย AI' : ''}${p.editedBy ? ` · แก้ไขโดย ${esc(p.editedBy)}` : ''}</dd>
          ${p.slipRead ? `<dt>ในสลิป</dt><dd>฿${fmt(p.slipRead.amount)} · ${esc(p.slipRead.date || '-')} ${esc(p.slipRead.time || '')}</dd>` : ''}</dl>
          ${p.slipCheck ? `<div style="margin-top:6px"><b style="font-size:13px">ผลตรวจสลิป</b> <span class="note">${thDate(p.slipCheck.at)}${p.slipCheck.acknowledged ? ' · ยืนยันแล้วแม้ไม่ผ่าน' : ''}</span>${verifyHtml(p.slipCheck.checks)}</div>` : ''}
          <div data-vmsg="${i}" class="note"></div></div>
        <div style="width:200px;text-align:center" data-slip="${esc(p.slipId || '')}">${p.slipId ? '<span class="note">กำลังโหลดสลิป…</span>' : '<span class="note">ไม่มีสลิป</span>'}</div>
      </div>
      <div class="acts" style="margin-top:8px">${p.slipId ? `<button class="btn sm pri" data-verify="${i}">🔍 ตรวจสลิป</button>` : ''}
        ${p.slipRead?.amount > 0 && p.slipRead.amount !== p.amount ? `<button class="btn sm" data-useslip="${i}">ใช้ยอดตามสลิป ฿${fmt(p.slipRead.amount)}</button>` : ''}
        <button class="btn sm" data-edit="${i}">✏️ แก้ไข</button><button class="btn sm" data-rc="${i}">🖨️ พิมพ์ใบเสร็จ</button>
        ${auth.can('data.delete') ? `<button class="btn sm danger" data-del="${i}">ลบรายการนี้</button>` : ''}</div>
      <div data-form="${i}"></div></div>`).join('') || '<p class="note">ยังไม่มีการชำระ</p>'}
    <div class="form-acts">${c.balance > 0 && b.status !== 'draft' ? '<button class="btn pri" id="pd-more">💰 รับชำระเพิ่ม</button>' : ''}<button class="btn" id="pd-x">ปิด</button></div>`, { wide: true });
  box.querySelector('#pd-x').onclick = closeModal;
  box.querySelector('#pd-more')?.addEventListener('click', () => openPayment(b, nb => { done?.(nb); if (nb) openPaymentDetail(nb, done); }));
  // รูปสลิป (ในเครื่อง หรือดึงจาก Google Drive)
  box.querySelectorAll('[data-slip]').forEach(async el => { if (el.dataset.slip) el.innerHTML = await photoThumb(el.dataset.slip); });
  box.querySelectorAll('[data-rc]').forEach(x => x.onclick = () => printDocs([b], { type: 'receipt', payment: pays[+x.dataset.rc] }));

  const savePays = async (payments, msg) => {
    const cc = M.calcBill({ ...b, payments }), last = [...payments].sort((a, z) => String(z.date).localeCompare(String(a.date)))[0];
    const nb = await save({ ...b, payments, status: b.status === 'draft' ? 'draft' : cc.balance <= 0 && payments.length ? 'paid' : 'issued', paidAt: cc.balance <= 0 ? last?.date || '' : '' });
    toast(msg); done?.(nb); openPaymentDetail(nb, done);
  };
  // ตรวจสลิปย้อนหลัง: อ่านรูปสลิปที่เก็บไว้ (ฟรี ในเครื่อง) → เทียบยอดที่บันทึก / ยอดที่ต้องชำระ / งวด
  box.querySelectorAll('[data-verify]').forEach(x => x.onclick = async () => {
    const i = +x.dataset.verify, p = pays[i], out = box.querySelector(`[data-vmsg="${i}"]`);
    x.disabled = true; out.textContent = '🔍 กำลังอ่านสลิป…';
    try {
      let photo = await db.getPhoto(p.slipId);
      if (!photo && isServerMode() && navigator.onLine) { const r = await api.call('getPhoto', { id: p.slipId }); photo = { id: p.slipId, dataUrl: r.dataUrl }; await db.putPhoto(photo); }
      if (!photo) throw new Error('ไม่พบรูปสลิปในเครื่อง (เชื่อม Google เพื่อดึงจาก Drive)');
      const text = await ocrLocal(photo.dataUrl, pc => { out.textContent = `🔍 กำลังอ่านสลิป… ${pc}%`; });
      const r = parseSlipText(text);
      const read = { amount: r.amount, date: r.date, time: r.time, ref: r.reference, source: 'ตรวจย้อนหลัง (ในเครื่อง)' };
      const checks = verifySlip(read, { amount: p.amount, date: p.date }, M.payWindow(b, p));
      savePays(pays.map((q, k) => k === i ? { ...q, slipRead: read, slipCheck: { at: new Date().toISOString(), checks } } : q),
        slipIssues(checks).length ? '⛔ ตรวจสลิปแล้ว: พบรายการไม่ตรง' : '✅ ตรวจสลิปแล้ว: ผ่าน');
    } catch (e) { out.textContent = 'ตรวจสลิปไม่สำเร็จ: ' + e.message; x.disabled = false; }
  });
  box.querySelectorAll('[data-useslip]').forEach(x => x.onclick = async () => {
    const i = +x.dataset.useslip, p = pays[i];
    if (!await confirmBox(`แก้ยอดรับชำระ ${p.receiptNo || ''} จาก ฿${fmt(p.amount)} เป็น ฿${fmt(p.slipRead.amount)} ตามสลิป?`, 'แก้ยอด')) return openPaymentDetail(b, done);
    const np = { ...p, amount: p.slipRead.amount, editedBy: auth.current().email, editedAt: new Date().toISOString() };
    np.slipCheck = { at: new Date().toISOString(), checks: verifySlip(p.slipRead, { amount: np.amount, date: np.date }, M.payWindow(b, p)) };
    savePays(pays.map((q, k) => k === i ? np : q), 'แก้ยอดตามสลิปแล้ว');
  });
  box.querySelectorAll('[data-del]').forEach(x => x.onclick = async () => {
    const p = pays[+x.dataset.del];
    if (!await confirmBox(`ลบรายการชำระ ฿${fmt(p.amount)} (${p.receiptNo || '-'}) ของห้อง ${b.room}?`, 'ลบ')) return openPaymentDetail(b, done);
    savePays(pays.filter((_, i) => i !== +x.dataset.del), 'ลบรายการชำระแล้ว');
  });
  box.querySelectorAll('[data-edit]').forEach(x => x.onclick = () => {
    const i = +x.dataset.edit, p = pays[i], holder = box.querySelector(`[data-form="${i}"]`);
    if (holder.innerHTML) return holder.innerHTML = '';
    holder.innerHTML = `<form class="form" style="margin-top:10px;border-top:1px dashed var(--line);padding-top:10px" onsubmit="return false">
      <label>วันที่ชำระ</label><input data-k="date" type="date" value="${esc(p.date || '')}">
      <label>จำนวนเงิน</label><input data-k="amount" type="number" step="0.01" min="0" value="${p.amount}">
      <label>ช่องทาง</label><select data-k="method">${METHODS.map(m => `<option ${m === p.method ? 'selected' : ''}>${m}</option>`).join('')}</select>
      <label>เลขอ้างอิง / หมายเหตุ</label><input data-k="ref" value="${esc(p.ref || '')}">
      <label>สลิป</label><span><label class="btn sm" for="pd-file-${i}">📎 แนบ/เปลี่ยนสลิป</label><input id="pd-file-${i}" type="file" accept="image/*" hidden> <span class="note" data-newslip></span></span>
      <div class="full form-acts"><button class="btn" type="button" data-cancel>ยกเลิก</button><button class="btn pri" type="button" data-ok>บันทึกการแก้ไข</button></div></form>`;
    let newSlip = null;
    holder.querySelector(`#pd-file-${i}`).onchange = async e => { const f = e.target.files[0]; if (!f) return; newSlip = await compress(await fileToDataUrl(f), 1600); holder.querySelector('[data-newslip]').textContent = '✔ เลือกรูปใหม่แล้ว'; };
    holder.querySelector('[data-cancel]').onclick = () => { holder.innerHTML = ''; };
    holder.querySelector('[data-ok]').onclick = async () => {
      const v = k => holder.querySelector(`[data-k="${k}"]`).value;
      if (!(Number(v('amount')) > 0)) return toast('จำนวนเงินไม่ถูกต้อง');
      if (v('method') === M.DEPOSIT_METHOD) {
        const left = M.depositLeft(db.get('tenants', b.tenantId) || M.tenantOf(b.room), p);
        if (Number(v('amount')) > left) return toast(`เงินประกันคงเหลือไม่พอ (ใช้ได้ ฿${fmt(left)})`, 4000);
      }
      const np = { ...p, date: v('date'), amount: Number(v('amount')), method: v('method'), ref: v('ref').trim(), editedBy: auth.current().email, editedAt: new Date().toISOString() };
      if (newSlip) {
        const hash = await imageHash(newSlip), d = findDuplicate({ hash });
        if (d && d.payment !== p) return toast(`สลิปนี้เคยใช้แล้วที่ห้อง ${d.bill.room} (${d.payment.receiptNo || ''})`, 4000);
        np.slipId = uid('slip-'); np.slipHash = hash;
        await db.putPhoto({ id: np.slipId, dataUrl: newSlip, name: `สลิป-${b.room}-${b.period}-${np.date}.jpg`, billId: b.id, createdAt: new Date().toISOString() });
        await db.queue({ kind: 'photo', photoId: np.slipId, folder: 'slip' });
      }
      savePays(pays.map((x, k) => k === i ? np : x), 'บันทึกการแก้ไขแล้ว');
    };
  });
}

// ---------- หน้าต่างบิล: ดู / แก้ค่าบริการอื่น / รับชำระ / พิมพ์ / ส่ง LINE ----------
async function openBill(b, rerender) {
  const c = M.calcBill(b), lock = M.billState(b) === 'paid';
  const box = openModal(`<style>${docCss()}</style>
    <div class="toolbar" style="justify-content:space-between;margin-bottom:10px"><div>
      <span class="pill ${M.BILL_TXT[M.billState(b)][1]}">${M.BILL_TXT[M.billState(b)][0]}</span>
      <span class="note">${b.lineStatus ? LINE_TXT[b.lineStatus] || '' : ''} ${M.lineLinkOf(b.room) ? '' : `· LINE ${esc(M.lineName(b.room))} ยังไม่ผูก`}</span></div>
      <select class="input" id="blang"><option value="th" ${M.langOf(b) === 'th' ? 'selected' : ''}>ภาษาไทย</option><option value="en" ${M.langOf(b) === 'en' ? 'selected' : ''}>English</option></select></div>
    <div id="bdoc" style="border:1px solid var(--line);border-radius:8px;padding:12px;max-height:46vh;overflow:auto"></div>

    <details style="margin-top:12px" ${b.items?.length ? 'open' : ''}><summary><b>ค่าบริการอื่น</b> (จำนวน × ราคา)</summary>
      <table class="tbl" id="items" style="margin-top:6px"><thead><tr><th>รายการ</th><th class="n">จำนวน</th><th class="n">ราคา/หน่วย</th><th class="n">เงิน</th><th></th></tr></thead><tbody></tbody></table>
      ${lock ? '' : '<div class="acts" style="margin-top:6px"><button class="btn sm" id="additem">+ เพิ่มรายการ</button><button class="btn sm pri" id="saveitems">บันทึกรายการ</button></div>'}</details>

    <details style="margin-top:12px" ${b.status !== 'draft' ? 'open' : ''}><summary><b>การชำระเงิน</b> · ยอด ฿${fmt(c.total)} · ชำระแล้ว ฿${fmt(c.paid)} · คงค้าง ฿${fmt(c.balance)}</summary>
      <table class="tbl" style="margin-top:6px"><thead><tr><th>วันที่</th><th class="n">จำนวน</th><th>ช่องทาง</th><th>ใบเสร็จ</th><th></th></tr></thead><tbody>
      ${(b.payments || []).map((p, i) => `<tr><td>${thDate(p.date)}</td><td class="n">${fmt(p.amount)}</td><td>${esc(p.method || p.note || '')}</td><td>${esc(p.receiptNo || '')}</td>
        <td><button class="btn sm" data-rcpt="${i}">พิมพ์ใบเสร็จ</button> <button class="btn sm" data-pdet>🔍 ดู/แก้ไข</button></td></tr>`).join('') || '<tr><td colspan="5" class="note">ยังไม่มีการชำระ</td></tr>'}
      </tbody></table>
      ${c.balance > 0 && c.ready ? `<div class="toolbar" style="margin-top:8px"><button class="btn pri" id="pay">💰 รับชำระเงิน…</button>
        <span class="note">ค่าปรับ · รายการอื่น · ชำระบางส่วน · แนบสลิป / ให้ AI อ่านสลิป</span></div>` : ''}</details>

    <div class="acts">
      <button class="btn pri" data-a="print">🖨️ พิมพ์ใบแจ้งหนี้</button>
      <button class="btn line" data-a="printline">🖨️ พิมพ์ + ส่ง LINE</button>
      <button class="btn line" data-a="line">ส่ง LINE</button>
      ${auth.can('data.delete') && !b._new ? '<button class="btn danger" data-a="del">ลบบิล</button>' : ''}
      <button class="btn" data-a="x" style="margin-left:auto">ปิด</button></div>`, { wide: true });

  const draw = async () => { box.querySelector('#bdoc').innerHTML = await docHtml(b, { lang: box.querySelector('#blang').value }); };
  box.querySelector('#blang').onchange = async e => { b = { ...b, lang: e.target.value }; if (!b._new) b = await save(b); draw(); };
  await draw();

  // ค่าบริการอื่น
  let items = (b.items || []).map(o => ({ name: o.name || '', qty: o.qty ?? 1, price: o.price ?? o.amount ?? 0 }));
  const drawItems = () => {
    box.querySelector('#items tbody').innerHTML = items.map((o, i) => `<tr>
      <td><input data-i="${i}" data-k="name" value="${esc(o.name)}" style="width:180px;text-align:left" ${lock ? 'disabled' : ''}></td>
      <td class="n"><input data-i="${i}" data-k="qty" type="number" step="any" value="${o.qty}" style="width:60px" ${lock ? 'disabled' : ''}></td>
      <td class="n"><input data-i="${i}" data-k="price" type="number" step="any" value="${o.price}" ${lock ? 'disabled' : ''}></td>
      <td class="n">${fmt((+o.qty || 0) * (+o.price || 0))}</td><td>${lock ? '' : `<button class="btn sm" data-rm="${i}">✕</button>`}</td></tr>`).join('') || '<tr><td colspan="5" class="note">ไม่มี</td></tr>';
    box.querySelectorAll('#items input').forEach(inp => inp.onchange = () => { const o = items[+inp.dataset.i]; o[inp.dataset.k] = inp.dataset.k === 'name' ? inp.value : Number(inp.value) || 0; drawItems(); });
    box.querySelectorAll('[data-rm]').forEach(x => x.onclick = () => { items.splice(+x.dataset.rm, 1); drawItems(); });
  };
  drawItems();
  box.querySelector('#additem')?.addEventListener('click', () => { items.push({ name: '', qty: 1, price: 0 }); drawItems(); box.querySelector(`[data-i="${items.length - 1}"][data-k="name"]`).focus(); });
  box.querySelector('#saveitems')?.addEventListener('click', async () => {
    b = await save({ ...b, items: items.filter(o => o.name || o.price).map(o => ({ ...o, amount: (+o.qty || 0) * (+o.price || 0) })) });
    toast('บันทึกค่าบริการอื่นแล้ว'); rerender(); openBill(b, rerender);
  });

  // รับชำระ
  box.querySelector('#pay')?.addEventListener('click', () => openPayment(b, nb => { rerender(); if (nb) openBill(nb, rerender); }));
  box.querySelectorAll('[data-pdet]').forEach(x => x.onclick = () => openPaymentDetail(b, nb => rerender()));
  box.querySelectorAll('[data-rcpt]').forEach(x => x.onclick = () => printDocs([b], { type: 'receipt', lang: box.querySelector('#blang').value, payment: b.payments[+x.dataset.rcpt] }));
  box.querySelectorAll('[data-delpay]').forEach(x => x.onclick = async () => {
    if (!await confirmBox('ลบรายการชำระเงินนี้?', 'ลบ')) return;
    const payments = b.payments.filter((_, i) => i !== +x.dataset.delpay);
    b = await save({ ...b, payments, status: b.status === 'draft' ? 'draft' : 'issued', paidAt: '' }); rerender(); openBill(b, rerender);
  });

  const on = (a, fn) => box.querySelector(`[data-a="${a}"]`)?.addEventListener('click', fn);
  const ready = () => { if (!M.calcBill(b).ready) { toast('ยังจดมิเตอร์ไม่ครบ'); return false; } return true; };
  const lang = () => box.querySelector('#blang').value;
  on('x', closeModal);
  on('print', async () => { if (!ready()) return; b = await issue(b); printDocs([b], { lang: lang() }); rerender(); });
  on('printline', async () => { if (!ready()) return; b = await issue(b); printDocs([b], { lang: lang() }); await sendLine([b]); closeModal(); rerender(); });
  on('line', async () => { if (!ready()) return; if (await sendLine([b])) { closeModal(); rerender(); } });
  on('del', async () => { if (await confirmBox(`ลบบิลห้อง ${b.room} เดือน ${periodLabel(b.period)}?`, 'ลบบิล')) { await db.remove('bills', b.id); closeModal(); rerender(); } });
}

export default {
  id: 'billing', title: 'จดมิเตอร์ / ออกบิล', icon: '🧾',
  render(el, nav, arg) {
    if (arg?.room) { focusRoom = arg.room; const lb = db.all('bills').filter(b => b.room === arg.room).map(b => b.period).sort().pop(); if (lb) period = lb; arg.room = null; }
    const rows = rowsFor();
    const ready = rows.filter(b => M.calcBill(b).ready), drafts = ready.filter(b => b.status === 'draft');
    const issued = rows.filter(b => b.status !== 'draft');
    const sum = issued.reduce((a, b) => a + M.calcBill(b).total, 0), paid = issued.filter(b => ['paid', 'internal'].includes(M.billState(b)));
    const opts = [...new Set([shiftPeriod(periodOf(), 1), periodOf(), period, ...M.periods().slice(0, 24)])].sort().reverse();

    el.innerHTML = `
    <div class="top"><h2>จดมิเตอร์ / ออกบิล</h2>
      <div class="toolbar">
        <label class="note">บิลเดือน</label><select class="input" id="per">${opts.map(p => `<option value="${p}" ${p === period ? 'selected' : ''}>${periodLabel(p)}</option>`).join('')}</select>
        <label class="note">วันที่จดมิเตอร์</label><input class="input" type="date" id="mdate" value="${meterDate}">
      </div></div>
    <div class="toolbar" style="margin-bottom:12px">
      <button class="btn pri" id="issue" ${drafts.length ? '' : 'disabled'}>ออกใบแจ้งหนี้ ${drafts.length} ห้อง</button>
      <button class="btn" id="printall" ${issued.length ? '' : 'disabled'}>🖨️ พิมพ์ใบแจ้งหนี้ทั้งหมด</button>
      <button class="btn line" id="lineall" ${issued.length || drafts.length ? '' : 'disabled'}>🖨️ พิมพ์ + ส่ง LINE ทุกห้อง</button>
      <button class="btn" id="form">📋 แบบฟอร์มจดมิเตอร์</button></div>
    <div class="kpis">
      <div class="card kpi"><div class="v">${ready.length}/${rows.length}</div><div class="l">จดมิเตอร์แล้ว</div></div>
      <div class="card kpi"><div class="v">${issued.length}</div><div class="l">ออกบิลแล้ว</div></div>
      <div class="card kpi"><div class="v">฿${fmt0(sum)}</div><div class="l">ยอดเรียกเก็บ</div></div>
      <div class="card kpi"><div class="v">${paid.length}/${issued.length}</div><div class="l">ชำระครบแล้ว</div></div>
    </div>
    <p class="note">บิล${periodLabel(period)} = ค่าเช่า${periodLabel(period, true)} + น้ำไฟที่จดปลาย${periodLabel(shiftPeriod(period, -1), true)} · ครบกำหนดชำระ ${thDate(M.dueDate(period))} ·
      ${M.rates().minOn ? `ขั้นต่ำ น้ำ ${M.minUnits('w')} หน่วย ไฟ ${M.minUnits('e')} หน่วย (× อัตราตามสัญญา)` : 'ไม่มีขั้นต่ำ'} · กด Enter ไปห้องถัดไป · แถวสีเหลือง = หน่วยผิดปกติ</p>
    <div class="scroll"><table class="tbl"><thead><tr>
      <th>ห้อง</th><th>ผู้เช่า</th><th class="n">น้ำ เดิม</th><th class="n">น้ำ ใหม่</th><th class="n">หน่วย</th><th class="n">ไฟ เดิม</th><th class="n">ไฟ ใหม่</th><th class="n">หน่วย</th>
      <th class="n">ค่าเช่า</th><th class="n">อื่นๆ</th><th class="n">รวม</th><th>เลขที่</th><th>สถานะ</th><th></th></tr></thead><tbody>
    ${rows.map(b => { const c = M.calcBill(b), s = M.billState(b), lock = s === 'paid';
      const other = (b.fridge || 0) + (b.parking || 0) + c.other + (b.phone || 0);
      return `<tr data-room="${b.room}" class="${odd(b) ? 'warnrow' : ''}" ${b.room === focusRoom ? 'style="outline:2px solid var(--brand)"' : ''}>
      <td><b>${b.room}</b></td><td>${esc(b.tenantName)}</td>
      <td class="n"><input data-k="wPrev" value="${b.wPrev ?? ''}" inputmode="numeric" ${lock ? 'disabled' : ''} title="เลขเดิม (แก้ได้)"></td>
      <td class="n"><input data-k="wCur" value="${b.wCur ?? ''}" inputmode="numeric" ${lock ? 'disabled' : ''} class="cur"></td><td class="n" data-wu>${c.wu ?? '-'}</td>
      <td class="n"><input data-k="ePrev" value="${b.ePrev ?? ''}" inputmode="numeric" ${lock ? 'disabled' : ''} title="เลขเดิม (แก้ได้)"></td>
      <td class="n"><input data-k="eCur" value="${b.eCur ?? ''}" inputmode="numeric" ${lock ? 'disabled' : ''} class="cur"></td><td class="n" data-eu>${c.eu ?? '-'}</td>
      <td class="n">${fmt0(b.rent)}</td><td class="n" title="ตู้เย็น ${b.fridge || 0} · จอดรถ ${b.parking || 0} · อื่น ${c.other}">${other ? fmt0(other) : '-'}</td>
      <td class="n" data-tot><b>${c.ready ? fmt(c.total) : '-'}</b></td><td>${esc(b.invoiceNo || '')}</td>
      <td>${['due', 'late', 'partial'].includes(s) ? `<button class="pill ${M.BILL_TXT[s][1]} pay-btn" data-pay title="กดเพื่อรับชำระเงิน">${M.BILL_TXT[s][0]} 💰</button>`
        : s === 'paid' ? (hasSlipIssue(b) ? `<button class="pill bad pay-btn" data-pdetail title="ผลตรวจสลิปไม่ผ่าน">ชำระแล้ว ⚠️ ตรวจสลิป</button>`
          : `<button class="pill ok pay-btn" data-pdetail title="ดูรายละเอียดการโอน / แก้ไข">ชำระแล้ว 🔍</button>`) : `<span class="pill ${M.BILL_TXT[s][1]}">${M.BILL_TXT[s][0]}</span>`} ${b.lineStatus === 'sent' ? '💬' : b.lineStatus === 'queued' ? '⏳' : ''}</td>
      <td><button class="btn sm" data-open>ดูบิล</button></td></tr>`; }).join('')}
    </tbody></table></div>`;

    const re = () => this.render(el, nav);
    el.querySelector('#per').onchange = e => { period = e.target.value; focusRoom = null; re(); };
    el.querySelector('#mdate').onchange = e => { meterDate = e.target.value; };
    el.querySelectorAll('tr[data-room]').forEach(tr => {
      const room = tr.dataset.room;
      const cur = () => billFor(db.get('rooms', room));
      tr.querySelectorAll('input').forEach(inp => {
        inp.oninput = () => {   // คำนวณสดในแถว
          const b = { ...cur() }; tr.querySelectorAll('input').forEach(i => b[i.dataset.k] = i.value === '' ? null : Number(i.value));
          const c = M.calcBill(b);
          tr.querySelector('[data-wu]').textContent = c.wu ?? '-'; tr.querySelector('[data-eu]').textContent = c.eu ?? '-';
          tr.querySelector('[data-tot]').innerHTML = `<b>${c.ready ? fmt(c.total) : '-'}</b>`; tr.classList.toggle('warnrow', odd(b));
        };
        inp.onchange = async () => { const b = cur(); b[inp.dataset.k] = inp.value === '' ? null : Number(inp.value); if (inp.classList.contains('cur')) b.meterDate = meterDate; await save(b); };
        inp.onkeydown = e => { if (e.key !== 'Enter') return; e.preventDefault();
          const all = [...el.querySelectorAll('input.cur:not(:disabled)')], i = all.indexOf(inp); (all[i + 1] || inp).focus(); all[i + 1]?.select(); };
      });
      tr.querySelector('[data-open]').onclick = async () => { await new Promise(r => setTimeout(r, 0)); openBill(cur(), re); };
      tr.querySelector('[data-pay]')?.addEventListener('click', () => openPayment(cur(), re));
      tr.querySelector('[data-pdetail]')?.addEventListener('click', () => openPaymentDetail(cur(), re));
    });
    el.querySelector('#issue').onclick = async () => {
      if (!await confirmBox(`ออกใบแจ้งหนี้ ${drafts.length} ห้อง ประจำเดือน ${periodLabel(period)}?`, 'ออกบิล')) return;
      for (const b of rowsFor().filter(b => b.status === 'draft' && M.calcBill(b).ready)) await issue(b);
      toast(`ออกใบแจ้งหนี้ ${drafts.length} ห้องแล้ว`); re();
    };
    el.querySelector('#printall').onclick = () => printDocs(rowsFor().filter(b => b.status !== 'draft'), b => ({ lang: M.langOf(b) }));
    el.querySelector('#lineall').onclick = async () => {
      if (!isServerMode()) return toast('ต้องเชื่อม Google และตั้งค่า LINE OA ก่อน (เมนูตั้งค่า)', 4000);
      const list = rowsFor().filter(b => M.calcBill(b).ready && !isCommon(b.room) && M.billState(b) !== 'paid');
      if (!list.length) return toast('ไม่มีบิลที่พร้อมส่ง');
      if (!await confirmBox(`พิมพ์และส่งบิล ${list.length} ห้องเข้า LINE OA?`, 'พิมพ์ + ส่ง')) return;
      const issuedList = []; for (const b of list) issuedList.push(await issue(b));
      printDocs(issuedList, b => ({ lang: M.langOf(b) })); await sendLine(issuedList); re();
    };
    el.querySelector('#form').onclick = () => printMeterForm(rows);
  },
};

// แบบฟอร์มจดมิเตอร์ (พิมพ์ไปเดินจด)
function printMeterForm(rows) {
  const p = M.property();
  document.querySelector('#print-area').innerHTML = `<div class="page" style="font-family:'IBM Plex Sans Thai',sans-serif">
    <h3 style="margin:0">${esc(p.name)} — แบบฟอร์มจดมิเตอร์น้ำ-ไฟ</h3><p>สำหรับบิลเดือน ${periodLabel(period)} · วันที่จด ....................... ผู้จด .......................</p>
    <table class="rep" style="font-size:13px"><thead><tr><th>ห้อง</th><th>ผู้เช่า</th><th>น้ำ เดิม</th><th style="width:110px">น้ำ ใหม่</th><th>ไฟ เดิม</th><th style="width:110px">ไฟ ใหม่</th><th>หมายเหตุ</th></tr></thead><tbody>
    ${rows.map(b => `<tr style="height:30px"><td>${b.room}</td><td>${esc(b.tenantName)}</td><td>${b.wPrev ?? ''}</td><td></td><td>${b.ePrev ?? ''}</td><td></td><td></td></tr>`).join('')}
    </tbody></table></div>`;
  setTimeout(() => window.print(), 50);
}
