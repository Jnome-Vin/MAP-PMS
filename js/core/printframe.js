// พิมพ์จากกรอบแยก (iframe) ที่มีแต่เอกสาร — ไม่มีหน้าแอป เมนู หรือองค์ประกอบที่ส่วนเสริมเบราว์เซอร์แทรกไว้
// (Grammarly / LanguageTool / ChatGPT sidebar ฯลฯ เคยทำให้มีหน้าว่างเกินมาตอนพิมพ์จากหน้าแอปโดยตรง)
const FONTS = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600;700&display=swap';
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// เอกสาร HTML ทั้งหน้าสำหรับพิมพ์ (ใช้สไตล์ของแอป + เนื้อหาอยู่ใน #print-area เหมือนเดิม)
export function frameHtml(bodyHtml) {
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><base href="${esc(document.baseURI)}">
<link href="${FONTS}" rel="stylesheet"><link rel="stylesheet" href="css/app.css">
<style>html,body{margin:0;padding:0;background:#fff}#print-area{display:block!important}</style></head>
<body><div id="print-area">${bodyHtml}</div></body></html>`;
}

const wait = ms => new Promise(r => setTimeout(r, ms));

// ซ่อนทุกอย่างที่ไม่ใช่เอกสาร (เผื่อส่วนเสริมเบราว์เซอร์แทรกเข้ามาในกรอบด้วย) — inline !important ชนะสไตล์ที่ส่วนเสริมบังคับไว้
export function hideForeign(d) {
  [...d.documentElement.children].filter(e => e.tagName !== 'HEAD' && e.tagName !== 'BODY')
    .concat([...d.body.children].filter(e => e.id !== 'print-area'))
    .forEach(e => e.style.setProperty('display', 'none', 'important'));
}

// prepare(doc) เรียกหลังโหลดสไตล์/ฟอนต์/รูปเสร็จ ก่อนสั่งพิมพ์ (เช่น ย่อให้พอดีหน้า A4)
export async function printInFrame(bodyHtml, prepare) {
  const f = document.createElement('iframe');
  f.setAttribute('aria-hidden', 'true');
  f.tabIndex = -1;
  // ต้องมองเห็นได้ (ไม่ใช้ display:none) ไม่อย่างนั้นบางเบราว์เซอร์พิมพ์ออกมาเป็นหน้าว่าง — วางไว้นอกจอแทน
  f.style.cssText = 'position:fixed;left:-12000px;top:0;width:1120px;height:1600px;border:0';
  document.body.appendChild(f);
  const d = f.contentDocument;
  d.open(); d.write(frameHtml(bodyHtml)); d.close();
  // รอสไตล์ ฟอนต์ และรูป (มีเวลาจำกัด กันค้าง)
  if (d.readyState !== 'complete') await Promise.race([new Promise(r => f.contentWindow.addEventListener('load', r, { once: true })), wait(5000)]);
  await Promise.race([d.fonts?.ready, wait(2500)]);
  await Promise.all([...d.images].map(i => i.complete ? null : Promise.race([new Promise(r => { i.onload = i.onerror = r; }), wait(3000)])));
  try { prepare?.(d); } catch (e) { console.warn(e); }
  hideForeign(d);
  f.contentWindow.focus();
  f.contentWindow.print();
  setTimeout(() => f.remove(), 1500);   // เอากรอบออกหลังปิดหน้าต่างพิมพ์
  return true;
}
