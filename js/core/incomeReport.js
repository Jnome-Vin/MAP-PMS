// ใบสรุปรายได้ประจำเดือน (A4 แนวตั้ง) — ใช้ทั้งหน้า "รายงาน" และหน้า "จดมิเตอร์ / ออกบิล"
// แบ่งหน้าเองด้วย JS ในกรอบพิมพ์ (วัดความสูงจริง) เพื่อให้รู้จำนวนแผ่นทั้งหมดและใส่ "แผ่นที่ X / Y" ได้แน่นอน
// หน้าตาตาม mockup/income_summary_mockup_v2.html (โทนเทาอมฟ้า + ไอคอนเส้น + สีประจำหมวด)
import * as db from './db.js';
import * as M from './model.js';
import { current } from './auth.js';
import { esc, periodLabel, shiftPeriod, thDate } from './ui.js';
import { printInFrame } from './printframe.js';
import { asset } from './docs.js';

const SARABUN = 'https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700&display=swap';
const n0 = v => (Number(v) || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const amt = v => (Number(v) ? n0(v) : '<span class="z">–</span>');
const shortDate = iso => { if (!iso) return ''; const d = new Date(iso); if (isNaN(d)) return ''; return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${String((d.getFullYear() + 543) % 100).padStart(2, '0')}`; };
const lastPayDate = b => (b.payments || []).map(p => p.date).filter(Boolean).sort().pop() || b.paidAt || '';
// ป้ายสถานะ: [class, ไอคอน, ข้อความ] — ข้อความสั้นให้พอดีช่อง
const TAG = { paid: ['paid', 'check', 'ชำระแล้ว'], due: ['due', 'clock', 'รอชำระ'], late: ['late', 'alert', 'ค้างชำระ'], partial: ['part', 'half', 'บางส่วน'], internal: ['muted', 'bldg', 'ส่วนกลาง'] };

// ---------- ข้อมูล ----------
// ห้องที่ควรมีบิลในเดือนนั้น: ห้องที่มีผู้เช่า + ห้องชนิดพิเศษ + ห้องที่มีบิลอยู่แล้ว (เหมือนหน้าออกบิล)
export function incomeData(period) {
  const expected = M.rooms().filter(r => r.kind !== 'room' || M.tenantOf(r.id) || db.get('bills', M.billId(period, r.id)));
  const issued = M.billsOf(period).filter(b => b.status !== 'draft');
  const rows = [], internal = [], unbilled = [];
  let metered = 0;
  for (const r of expected) {
    const b = db.get('bills', M.billId(period, r.id));
    if (b && (b.status !== 'draft' || M.calcBill(b).ready)) metered++;
    if (!b || b.status === 'draft') unbilled.push({ room: r.id, tenantName: b?.tenantName || M.tenantOf(r.id)?.name || r.label || '', metered: !!b && M.calcBill(b).ready });
  }
  // บิลที่ออกแล้วแต่ห้องไม่อยู่ในรายการ (เช่น ผู้เช่าย้ายออกไปแล้ว) ก็ต้องนับด้วย
  issued.forEach(b => { if (!expected.some(r => r.id === b.room)) metered++; });
  for (const b of issued.sort((a, c) => a.room.localeCompare(c.room))) {
    const c = M.calcBill(b), s = M.billState(b);
    const row = { b, c, s, other: (Number(b.fridge) || 0) + (Number(b.parking) || 0) + c.other, phone: Number(b.phone) || 0 };
    (s === 'internal' ? internal : rows).push(row);
  }
  const t = { rent: 0, wu: 0, water: 0, eu: 0, elec: 0, phone: 0, other: 0, total: 0, paid: 0 };
  rows.forEach(x => { t.rent += Number(x.b.rent) || 0; t.wu += x.c.wu || 0; t.water += x.c.water; t.eu += x.c.eu || 0; t.elec += x.c.elec; t.phone += x.phone; t.other += x.other; t.total += x.c.total; t.paid += x.c.paid; });
  const paidRows = rows.filter(x => x.s === 'paid'), dueRows = rows.filter(x => x.s !== 'paid');
  const outstanding = dueRows.reduce((a, x) => a + Math.max(0, x.c.balance), 0);
  return { period, rows, internal, unbilled, totals: t, paidRows, dueRows, outstanding, metered, expected: expected.length + issued.filter(b => !expected.some(r => r.id === b.room)).length };
}

// ---------- ไอคอน (เส้นแบบ Lucide) ----------
const SVG = {
  receipt: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 17.5v-11"/>',
  check: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  half: '<circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 0 20z" fill="currentColor"/>',
  home: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  drop: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
  zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  box: '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  pie: '<path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
  wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  bldg: '<rect width="16" height="20" x="4" y="2" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/>',
  dash: '<path d="M10.1 2.182a10 10 0 0 1 3.8 0"/><path d="M13.9 21.818a10 10 0 0 1-3.8 0"/><path d="M17.609 3.721a10 10 0 0 1 2.69 2.7"/><path d="M2.182 13.9a10 10 0 0 1 0-3.8"/><path d="M20.279 17.609a10 10 0 0 1-2.7 2.69"/><path d="M21.818 10.1a10 10 0 0 1 0 3.8"/><path d="M3.721 6.391a10 10 0 0 1 2.7-2.69"/><path d="M6.391 20.279a10 10 0 0 1-2.69-2.7"/>',
  cal: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  print: '<path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6"/><rect x="6" y="14" width="12" height="8" rx="1"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  pen: '<path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  stamp: '<path d="M5 22h14"/><path d="M19.27 13.73A2.5 2.5 0 0 0 17.5 13h-11A2.5 2.5 0 0 0 4 15.5V17a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1.5c0-.66-.26-1.3-.73-1.77Z"/><path d="M14 13V8.5C14 7 15 7 15 5a3 3 0 0 0-6 0c0 2 1 2 1 3.5V13"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  arrow: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
};
const SPRITE = `<svg width="0" height="0" style="position:absolute">${Object.entries(SVG).map(([k, v]) => `<symbol id="ir-i-${k}" viewBox="0 0 24 24">${v}</symbol>`).join('')}</svg>`;
const I = (id, cls = '', style = '') => `<svg class="ic ${cls}"${style ? ` style="${style}"` : ''}><use href="#ir-i-${id}"/></svg>`;
// สีประจำหมวด + พื้นอ่อน (สำหรับวงกลมไอคอน)
const C = { brand: ['#23395b', '#e9ecf1'], rent: ['#3b5b8c', '#ebeff4'], water: ['#0284c7', '#e6f3fa'], elec: ['#c2410c', '#f9ece7'], phone: ['#7c3aed', '#f2ebfd'], other: ['#0f766e', '#e7f1f1'], ok: ['#15803d', '#e8f3ec'], bad: ['#b91c1c', '#f8e8e8'] };
const tint = k => `color:${C[k][0]};background:${C[k][1]}`;

// ---------- HTML ----------
const CSS = `
@page{size:A4;margin:0}
.ir-page{--ink:#1e293b;--ink2:#475569;--ink3:#64748b;--line:#e2e8f0;--line2:#cbd5e1;--soft:#f8fafc;--head:#eef2f7;--brand:#23395b;--total:#1d4ed8;
  --water:#0284c7;--elec:#c2410c;--ok:#15803d;--okbg:#f0fdf4;--okbd:#bbf7d0;--warn:#a16207;--warnbg:#fefce8;--warnbd:#fde68a;--bad:#b91c1c;--badbg:#fef2f2;--badbd:#fecaca;--mute:#64748b;--mutebg:#f1f5f9;--mutebd:#e2e8f0;
  width:210mm;height:295mm;padding:12mm 12mm 0;box-sizing:border-box;position:relative;overflow:hidden;background:#fff;
  font-family:'Sarabun','IBM Plex Sans Thai','Tahoma',sans-serif;color:var(--ink);font-size:9pt;line-height:1.4;break-after:page;page-break-after:always;
  -webkit-print-color-adjust:exact;print-color-adjust:exact}
.ir-page:last-child{break-after:auto;page-break-after:auto}
.ir-page *{box-sizing:border-box}
.ir-page .ic{width:1em;height:1em;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;vertical-align:-.14em;flex:none}
.ir-page .num,.ir-main td{font-variant-numeric:tabular-nums}
.ir-body{height:calc(295mm - 12mm - 17mm);overflow:hidden}
.ir-hd{display:flex;justify-content:space-between;align-items:center;gap:6mm;padding-bottom:3.5mm;border-bottom:1.5px solid var(--brand)}
.ir-hd.small{padding-bottom:2.5mm}
.ir-biz{display:flex;align-items:center;gap:3.5mm}
.ir-logo{height:15mm;max-width:40mm;object-fit:contain}
.ir-bizname{font-size:12.5pt;font-weight:700;color:var(--brand)}
.ir-hd.small .ir-bizname{font-size:11pt}
.ir-bizsub{font-size:7.8pt;color:var(--ink3)}
.ir-ttl{text-align:right;white-space:nowrap}
.ir-t1{font-size:15pt;font-weight:700;color:var(--brand);letter-spacing:.2px}
.ir-t2{display:inline-flex;align-items:center;gap:1.5mm;margin-top:.8mm;font-size:10pt;font-weight:600;color:var(--ink2);background:var(--head);border-radius:10mm;padding:.4mm 3mm}
.ir-t1s{font-size:10.5pt;font-weight:700;color:var(--brand)}
.ir-cont{font-weight:500;color:var(--ink3);font-size:8.5pt}
.ir-meta{display:flex;flex-wrap:wrap;gap:1.5mm 5mm;margin:3mm 0 4mm;font-size:8pt;color:var(--ink2)}
.ir-meta span{display:inline-flex;align-items:center;gap:1.2mm}
.ir-meta .ic{color:var(--ink3)}
.ir-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:3mm;margin-bottom:5mm}
.ir-k{border:1px solid var(--line);border-radius:2.5mm;padding:2.6mm 3mm;display:flex;gap:2.5mm;align-items:flex-start}
.ir-kicon{width:8mm;height:8mm;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:4.3mm;flex:none}
.ir-kl{font-size:7.8pt;color:var(--ink2)}
.ir-kv{font-size:13.5pt;font-weight:700;line-height:1.2;white-space:nowrap}
.ir-ks{font-size:7.3pt;color:var(--ink3)}
.ir-bar{height:1.4mm;background:var(--line);border-radius:1mm;margin-top:1.2mm;overflow:hidden}
.ir-bar i{display:block;height:100%;background:var(--ok);border-radius:1mm}
table.ir-main{width:100%;border-collapse:collapse;table-layout:fixed;font-size:8.4pt}
.ir-main th{background:var(--head);color:var(--ink2);font-weight:600;font-size:7.6pt;padding:.6mm 1mm 1.3mm;text-align:right;line-height:1.2;vertical-align:top;border-bottom:1.5px solid var(--line2)}
.ir-main tr.icr th{border-bottom:none;padding:1.6mm 1mm 0;height:5.2mm}
.ir-main tr.icr th:first-child{border-radius:2mm 0 0 0}.ir-main tr.icr th:last-child{border-radius:0 2mm 0 0}
.ir-main th .hi{display:block;width:3.6mm;height:3.6mm;font-size:3.6mm;margin:0 auto}
.ir-main th .u{font-weight:400;font-size:6.6pt;color:var(--ink3)}
.ir-main .cw{color:var(--water)}.ir-main .ce{color:var(--elec)}.ir-main .ct{color:var(--total)}
.ir-main td.cu{opacity:.75}
.ir-main th.cw,.ir-main th.ce,.ir-main th.ct{font-weight:700}
.ir-main th.cw .u,.ir-main th.ce .u{color:inherit;opacity:.8}
.ir-main td{padding:1.25mm 1mm;border-bottom:1px solid var(--line);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:right}
.ir-main tbody tr:nth-child(even) td{background:var(--soft)}
.ir-main tr.dim td{color:#94a3b8}
.ir-main td.l,.ir-main th.l{text-align:left}
.ir-main .rm{font-weight:700;color:var(--brand);text-align:center}
.ir-main tr.dim .rm{color:#94a3b8}
.ir-main .tot{font-weight:700}
.ir-main .z{color:#cbd5e1}
.ir-main tfoot td{border-top:1.5px solid var(--brand);border-bottom:none;padding:2.2mm 1mm;background:var(--head);font-weight:700;overflow:visible}
.ir-main tfoot .lbl{text-align:right;font-weight:600;color:var(--ink2);white-space:normal}
.ir-grand{font-size:10pt}
.ir-page .r{text-align:right!important}.ir-page .c{text-align:center!important}
.ir-tag{display:inline-flex;align-items:center;gap:1mm;font-size:7pt;font-weight:600;padding:.2mm 1.8mm .2mm 1.3mm;border-radius:3mm;border:1px solid;line-height:1.5}
.ir-tag.paid{color:var(--ok);background:var(--okbg);border-color:var(--okbd)}
.ir-tag.due,.ir-tag.part{color:var(--warn);background:var(--warnbg);border-color:var(--warnbd)}
.ir-tag.late{color:var(--bad);background:var(--badbg);border-color:var(--badbd)}
.ir-tag.muted{color:var(--mute);background:var(--mutebg);border-color:var(--mutebd)}
.ir-main td.dt{color:var(--ink3);font-size:7.6pt;text-align:center}
.ir-next{display:flex;justify-content:flex-end;align-items:center;gap:1mm;margin-top:1.8mm;font-size:7.8pt;color:var(--ink3)}
.ir-sumgrid{display:grid;grid-template-columns:1.15fr 1fr;gap:4mm;margin-top:6mm}
.ir-box{border:1px solid var(--line);border-radius:2.5mm;padding:3.2mm 3.5mm}
.ir-bt{display:flex;align-items:center;gap:1.8mm;font-weight:700;color:var(--brand);margin-bottom:2.2mm;font-size:9.5pt}
.ir-stack{display:flex;height:3mm;border-radius:1.5mm;overflow:hidden;margin-bottom:2.5mm;background:var(--line)}
.ir-stack i{display:block;height:100%}
table.ir-mini{width:100%;border-collapse:collapse}
.ir-mini td{padding:1.1mm 0;border-bottom:1px dashed var(--line)}
.ir-mini .cat{display:inline-flex;align-items:center;gap:1.8mm}
.ir-mini .dot{width:5.2mm;height:5.2mm;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:3.2mm;flex:none}
.ir-mini .pct{color:var(--ink3);font-size:7.6pt;width:11mm}
.ir-mini .mu{color:var(--ink3)}
.ir-mini tr.tt td{font-weight:700;border-top:1.5px solid var(--brand);border-bottom:none;padding-top:1.6mm}
.ir-duelist{display:flex;flex-wrap:wrap;gap:1.3mm;margin-top:1mm}
.ir-duelist span{font-size:7.6pt;background:var(--badbg);color:var(--bad);border:1px solid var(--badbd);border-radius:1.5mm;padding:.2mm 1.6mm}
.ir-duelist span.p{background:var(--warnbg);color:var(--warn);border-color:var(--warnbd)}
.ir-duelist .none{background:var(--okbg);color:var(--ok);border-color:var(--okbd)}
.ir-note{display:flex;gap:1.8mm;align-items:flex-start;margin-top:3.5mm;font-size:8pt;color:var(--ink2);background:var(--soft);border-radius:2mm;padding:2mm 3mm}
.ir-note .ic{color:var(--ink3);margin-top:.5mm}
.ir-sign{display:grid;grid-template-columns:repeat(3,1fr);gap:10mm;margin-top:11mm;text-align:center;font-size:8.8pt}
.ir-line{border-bottom:1px solid var(--ink2);height:12mm;margin:0 5mm 1.6mm;position:relative}
.ir-line img{position:absolute;left:50%;bottom:-1.5mm;transform:translateX(-50%);height:11mm;max-width:90%;object-fit:contain}
.ir-who{display:inline-flex;align-items:center;gap:1.2mm;font-weight:600;color:var(--ink2)}
.ir-d{font-size:7.6pt;color:var(--ink3);margin-top:.6mm}
.ir-ft{position:absolute;left:12mm;right:12mm;bottom:8mm;display:flex;justify-content:space-between;align-items:center;gap:4mm;border-top:1px solid var(--line);padding-top:1.8mm;font-size:7.6pt;color:var(--ink3)}
.ir-ft span{display:inline-flex;align-items:center;gap:1.2mm}
.ir-ft .pg{font-weight:700;color:var(--ink2);background:var(--head);border-radius:3mm;padding:.2mm 2.5mm}
@media screen{body{background:#e5e9f0}.ir-page{margin:14px auto;box-shadow:0 2px 12px rgba(15,23,42,.12)}}
`;

const COLS = `<colgroup><col style="width:8.5mm"><col><col style="width:13mm"><col style="width:12.5mm"><col style="width:8mm"><col style="width:11mm">
<col style="width:9mm"><col style="width:12mm"><col style="width:10mm"><col style="width:10mm"><col style="width:13.5mm"><col style="width:13.5mm"><col style="width:19.5mm"><col style="width:14.5mm"></colgroup>`;
// แถวบน = ไอคอน (กึ่งกลางคอลัมน์; น้ำ/ไฟ กึ่งกลางระหว่าง 2 คอลัมน์) · แถวล่าง = ชื่อคอลัมน์
const HI = (n, k) => I(n, 'hi', `color:${C[k][0]}`);
const THEAD = `<thead><tr class="icr"><th></th><th></th><th></th>
<th>${HI('home', 'rent')}</th><th colspan="2">${HI('drop', 'water')}</th><th colspan="2">${HI('zap', 'elec')}</th>
<th>${HI('phone', 'phone')}</th><th>${HI('box', 'other')}</th><th></th><th></th><th></th><th></th></tr>
<tr><th class="c">ห้อง</th><th class="l">ผู้เช่า</th><th>เลขที่บิล</th><th class="c">ค่าเช่า</th>
<th class="c cw">น้ำ<br><span class="u">หน่วย</span></th><th class="c cw">ค่าน้ำ</th>
<th class="c ce">ไฟ<br><span class="u">หน่วย</span></th><th class="c ce">ค่าไฟ</th>
<th class="c">โทรศัพท์</th><th class="c">อื่นๆ</th>
<th class="ct">รวม</th><th>รับแล้ว</th><th class="c">สถานะ</th><th class="c">วันที่ชำระ</th></tr></thead>`;

function rowHtml(x) {
  const { b, c, s } = x, dim = s === 'internal';
  const [cls, ic, txt] = TAG[s] || ['muted', 'dash', (M.BILL_TXT[s] || [''])[0]];
  const unit = v => (v ?? '') === '' ? '<span class="z">–</span>' : n0(v);
  return `<tr class="${dim ? 'dim' : ''}"><td class="rm">${esc(b.room)}</td><td class="l" title="${esc(b.tenantName)}">${esc(b.tenantName || '')}</td>
<td style="color:var(--ink3)">${esc(dim ? '–' : (b.invoiceNo || '–'))}</td><td>${amt(b.rent)}</td>
<td class="cw cu">${unit(c.wu)}</td><td class="cw">${amt(c.water)}</td><td class="ce cu">${unit(c.eu)}</td><td class="ce">${amt(c.elec)}</td>
<td>${amt(x.phone)}</td><td>${amt(x.other)}</td><td class="tot ct">${n0(c.total)}</td><td>${dim ? '' : amt(c.paid)}</td>
<td class="c"><span class="ir-tag ${cls}">${I(ic)}${txt}</span></td><td class="dt">${c.paid > 0 && !dim ? shortDate(lastPayDate(b)) : ''}</td></tr>`;
}
const unbilledHtml = u => `<tr class="dim"><td class="rm">${esc(u.room)}</td><td class="l">${esc(u.tenantName)}</td>${'<td>–</td>'.repeat(10)}
<td class="c"><span class="ir-tag muted">${I('dash')}ยังไม่ออกบิล</span></td><td></td></tr>`;

function tailHtml(d) {
  const t = d.totals, pctN = v => (t.total ? v / t.total * 100 : 0), pct = v => (t.total ? pctN(v).toFixed(1) + '%' : '-');
  const foot = `<tfoot><tr><td colspan="3" class="lbl">รวมทั้งสิ้น (${d.rows.length} ห้องที่ออกบิล)</td>
<td>${n0(t.rent)}</td><td class="cw cu">${n0(t.wu)}</td><td class="cw">${n0(t.water)}</td><td class="ce cu">${n0(t.eu)}</td><td class="ce">${n0(t.elec)}</td>
<td>${n0(t.phone)}</td><td>${n0(t.other)}</td><td class="ir-grand ct">${n0(t.total)}</td><td style="color:var(--ok)">${n0(t.paid)}</td><td colspan="2"></td></tr></tfoot>`;
  const mu = s => ` <span class="mu">${s}</span>`;
  const cats = [['ค่าเช่าห้อง', 'home', 'rent', t.rent], ['ค่าน้ำประปา' + mu(`(${n0(t.wu)} หน่วย)`), 'drop', 'water', t.water], ['ค่าไฟฟ้า' + mu(`(${n0(t.eu)} หน่วย)`), 'zap', 'elec', t.elec],
    ['ค่าโทรศัพท์', 'phone', 'phone', t.phone], ['อื่นๆ (ตู้เย็น ที่จอดรถ ฯลฯ)', 'box', 'other', t.other]];
  const sum = t.paid + d.outstanding, paidPct = sum ? t.paid / sum * 100 : 0;
  const notes = [];
  d.internal.forEach(x => notes.push(`ห้อง ${esc(x.b.room)} (ส่วนกลาง) ใช้น้ำ/ไฟ ฿${n0(x.c.total)} — แสดงไว้เพื่ออ้างอิง ไม่นับรวมเป็นรายได้`));
  if (d.unbilled.length) notes.push(`ห้อง ${d.unbilled.map(u => esc(u.room)).join(', ')} ${d.unbilled.every(u => u.metered) ? 'จดมิเตอร์แล้ว แต่ยังไม่ออกบิล' : 'ยังไม่จดมิเตอร์/ออกบิล'}`);
  const body = `<div class="ir-sumgrid">
 <div class="ir-box"><div class="ir-bt">${I('pie')}สรุปรายได้แยกตามประเภท</div>
  <div class="ir-stack">${cats.map(c => `<i style="width:${pctN(c[3]).toFixed(2)}%;background:${C[c[2]][0]}"></i>`).join('')}</div>
  <table class="ir-mini">${cats.map(c => `<tr><td><span class="cat"><span class="dot" style="${tint(c[2])}">${I(c[1])}</span>${c[0]}</span></td><td class="r num">${n0(c[3])}</td><td class="r pct">${pct(c[3])}</td></tr>`).join('')}
  <tr class="tt"><td>รวมรายได้</td><td class="r num">${n0(t.total)}</td><td class="r pct">${t.total ? '100%' : '-'}</td></tr></table></div>
 <div class="ir-box"><div class="ir-bt">${I('wallet')}สรุปการรับชำระ</div>
  <div class="ir-stack"><i style="width:${paidPct.toFixed(2)}%;background:var(--ok)"></i><i style="flex:1;background:var(--bad);opacity:${d.outstanding ? .75 : 0}"></i></div>
  <table class="ir-mini">
   <tr><td><span class="cat"><span class="dot" style="${tint('ok')}">${I('check')}</span>รับชำระแล้ว</span></td><td class="r mu">${d.paidRows.length} ห้องชำระครบ</td><td class="r num">${n0(t.paid)}</td></tr>
   <tr><td><span class="cat"><span class="dot" style="${tint('bad')}">${I('alert')}</span>ค้างชำระ</span></td><td class="r mu">${d.dueRows.length} ห้อง</td><td class="r num" style="color:var(--bad)">${n0(d.outstanding)}</td></tr>
   <tr class="tt"><td>รวม</td><td class="r mu">${d.rows.length} ห้อง</td><td class="r num">${n0(sum)}</td></tr></table>
  <div class="ir-bt" style="margin:3mm 0 1mm;font-size:8.5pt">${I('search')}ห้องที่ต้องติดตาม</div>
  <div class="ir-duelist">${d.dueRows.map(x => `<span class="${x.s === 'partial' ? 'p' : ''}">${esc(x.b.room)} · ${n0(x.c.balance)}</span>`).join('') || '<span class="none">ไม่มี — รับชำระครบทุกห้อง</span>'}</div></div>
</div>
${notes.length ? `<div class="ir-note">${I('info')}<div>${notes.join(' · ')}</div></div>` : ''}`;
  return { foot, body };
}

function headerFull(d, logo) {
  const p = M.property(), r = M.rates(), per = d.period, t = d.totals;
  const sub = [p.address, p.phone ? 'โทร ' + p.phone : '', p.taxId ? 'เลขประจำตัวผู้เสียภาษี ' + p.taxId : ''].filter(Boolean).map(esc).join(' · ');
  const paidPct = t.total ? t.paid / t.total * 100 : 0;
  return `<div class="ir-hd"><div class="ir-biz">${logo ? `<img class="ir-logo" src="${logo}" alt="">` : ''}
  <div><div class="ir-bizname">${esc(p.name)}</div>${sub ? `<div class="ir-bizsub">${sub}</div>` : ''}</div></div>
  <div class="ir-ttl"><div class="ir-t1">สรุปรายได้ประจำเดือน</div><div class="ir-t2">${I('cal')}${periodLabel(per)}</div></div></div>
<div class="ir-meta"><span>${I('receipt')}รอบบิล: ค่าเช่า ${periodLabel(per, true)} + น้ำ/ไฟ ที่จดปลาย ${periodLabel(shiftPeriod(per, -1), true)}</span>
  <span>${I('clock')}ครบกำหนดชำระ ${thDate(M.dueDate(per))}</span>
  <span>${I('drop', '', `color:${C.water[0]}`)}น้ำ ${n0(r.water)} บ./หน่วย</span><span>${I('zap', '', `color:${C.elec[0]}`)}ไฟ ${n0(r.elec)} บ./หน่วย</span></div>
<div class="ir-kpis">
  <div class="ir-k"><div class="ir-kicon" style="${tint('brand')}">${I('receipt')}</div><div><div class="ir-kl">ยอดเรียกเก็บรวม</div><div class="ir-kv num">฿${n0(t.total)}</div><div class="ir-ks">${d.rows.length} ห้องที่ออกบิล</div></div></div>
  <div class="ir-k"><div class="ir-kicon" style="${tint('ok')}">${I('check')}</div><div style="flex:1"><div class="ir-kl">รับชำระแล้ว</div><div class="ir-kv num" style="color:var(--ok)">฿${n0(t.paid)}</div>
    <div class="ir-ks">${d.paidRows.length}/${d.rows.length} ห้อง · ${paidPct.toFixed(0)}%</div><div class="ir-bar"><i style="width:${paidPct.toFixed(1)}%"></i></div></div></div>
  <div class="ir-k"><div class="ir-kicon" style="${tint('bad')}">${I('alert')}</div><div><div class="ir-kl">ค้างชำระ</div><div class="ir-kv num" style="color:var(--bad)">฿${n0(d.outstanding)}</div><div class="ir-ks">${d.dueRows.length} ห้อง</div></div></div>
  <div class="ir-k"><div class="ir-kicon" style="${tint('rent')}">${I('gauge')}</div><div><div class="ir-kl">จดมิเตอร์ / ออกบิล</div><div class="ir-kv">${d.rows.length} <span style="font-size:9pt;font-weight:500;color:var(--ink3)">ห้อง</span></div><div class="ir-ks">จดแล้ว ${d.metered}/${d.expected} · รอออก ${d.unbilled.length}</div></div></div>
</div>`;
}
const headerSmall = d => `<div class="ir-hd small"><div class="ir-biz"><div class="ir-kicon" style="${tint('brand')}">${I('bldg')}</div><div class="ir-bizname">${esc(M.property().name)}</div></div>
  <div class="ir-ttl"><div class="ir-t1s">สรุปรายได้ประจำเดือน ${periodLabel(d.period)} <span class="ir-cont">(ต่อ)</span></div></div></div>`;

// ---------- แบ่งหน้า ----------
// แต่ละแผ่น: .ir-body (ความสูงคงที่ ซ่อนส่วนเกิน) + ท้ายกระดาษ — ใส่แถวทีละแถวจนเกิน แล้วขึ้นแผ่นใหม่
// แผ่นสุดท้ายต้องมีที่พอสำหรับแถวรวม + สรุป + ช่องลงชื่อ ถ้าไม่พอย้ายแถวท้ายไปแผ่นใหม่ (อย่างน้อย 1 แถว)
function paginate(doc, d, parts) {
  const root = doc.getElementById('ir-root');
  const over = body => body.scrollHeight > body.clientHeight + 1;
  const newPage = first => {
    const pg = doc.createElement('div'); pg.className = 'ir-page';
    pg.innerHTML = `<div class="ir-body">${first ? parts.head : parts.small}<table class="ir-main" ${first ? '' : 'style="margin-top:3.5mm"'}>${COLS}${THEAD}<tbody></tbody></table><div class="ir-next">&nbsp;</div></div>`;   // ir-next กันที่ไว้สำหรับ "ต่อแผ่นที่ …"
    root.appendChild(pg);
    return { pg, body: pg.querySelector('.ir-body'), tbody: pg.querySelector('tbody'), table: pg.querySelector('table') };
  };
  const addTail = P => {
    P.table.insertAdjacentHTML('beforeend', parts.tail.foot);
    const w = doc.createElement('div'); w.className = 'ir-tail'; w.innerHTML = parts.tail.body + parts.sign;
    P.body.appendChild(w);
    return () => { P.table.querySelector('tfoot').remove(); w.remove(); };
  };
  const rows = parts.rows, pages = [];
  let i = 0, P = newPage(true);
  for (;;) {
    pages.push(P);
    while (i < rows.length) {
      P.tbody.insertAdjacentHTML('beforeend', rows[i]);
      if (over(P.body) && P.tbody.rows.length > 1) { P.tbody.lastElementChild.remove(); break; }
      i++;
    }
    if (i >= rows.length) {
      const undo = addTail(P);
      if (!over(P.body)) break;
      undo();
      if (P.tbody.rows.length > 1) { P.tbody.lastElementChild.remove(); i--; }   // พาแถวสุดท้ายไปอยู่กับแถวรวมในแผ่นถัดไป
      else if (!rows.length || P.tbody.rows.length === 0) { addTail(P); break; }   // ไม่มีแถวให้ย้าย — ใส่ไว้แผ่นนี้
    }
    P = newPage(false);
  }
  const Y = pages.length;
  pages.forEach((p, k) => {
    const nx = p.body.querySelector('.ir-next');
    if (k < Y - 1) nx.innerHTML = `ต่อแผ่นที่ ${k + 2} ${I('arrow')}`; else nx.remove();
    p.pg.insertAdjacentHTML('beforeend', `<div class="ir-ft"><span>${parts.printed}</span><span>สรุปรายได้ประจำเดือน ${periodLabel(d.period, true)}</span><span class="pg">แผ่นที่ ${k + 1} / ${Y}</span></div>`);
  });
  root.querySelector('#ir-src')?.remove();
}

export async function printIncomeSummary(period) {
  const d = incomeData(period);
  const [logo, sign] = await Promise.all([asset('brand'), asset('sign')]);
  const now = new Date(), u = current();
  const printed = `${I('print')}พิมพ์เมื่อ ${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear() + 543} ${now.toTimeString().slice(0, 5)} น.${u ? ` &nbsp;${I('user')}${esc(u.name || u.email)}` : ''}`;
  const parts = {
    head: headerFull(d, logo), small: headerSmall(d), tail: tailHtml(d), printed,
    rows: [...d.rows.map(rowHtml), ...d.internal.map(rowHtml), ...d.unbilled.map(unbilledHtml)],
    sign: `<div class="ir-sign">
  <div><div class="ir-line">${sign ? `<img src="${sign}" alt="">` : ''}</div><span class="ir-who">${I('pen')}ผู้จัดทำ</span><div class="ir-d">วันที่ ____/____/______</div></div>
  <div><div class="ir-line"></div><span class="ir-who">${I('search')}ผู้ตรวจสอบ</span><div class="ir-d">วันที่ ____/____/______</div></div>
  <div><div class="ir-line"></div><span class="ir-who">${I('stamp')}ผู้อนุมัติ</span><div class="ir-d">วันที่ ____/____/______</div></div></div>`,
  };
  // ฟอนต์ Sarabun ต้องโหลดก่อนวัดความสูง — ใส่ข้อความตัวอย่างไว้ให้เบราว์เซอร์โหลดฟอนต์ แล้วลบทิ้งตอนแบ่งหน้า
  const html = `<link href="${SARABUN}" rel="stylesheet"><style>${CSS}</style>${SPRITE}
<div id="ir-root"><div id="ir-src" style="font-family:Sarabun;font-weight:400;position:absolute;opacity:0">ก0<b>ก0</b><span style="font-weight:600">ก0</span><span style="font-weight:500">ก0</span></div></div>`;
  return printInFrame(html, doc => paginate(doc, d, parts));
}
