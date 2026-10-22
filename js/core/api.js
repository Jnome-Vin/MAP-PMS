// เรียก backend (Google Apps Script Web App)
// ใช้ Content-Type text/plain เพื่อหลีกเลี่ยง CORS preflight ที่ Apps Script ไม่รองรับ
import { getApiUrl } from './config.js';

let token = null;
export const setToken = t => { token = t; };

export class ApiError extends Error { constructor(msg, code) { super(msg); this.code = code; } }

export async function call(action, payload = {}, { timeout = 60000 } = {}) {
  const url = getApiUrl();
  if (!url) throw new ApiError('ยังไม่ได้ตั้งค่า URL ของ Google Apps Script', 'NO_API');
  if (!navigator.onLine) throw new ApiError('ไม่มีสัญญาณอินเทอร์เน็ต', 'OFFLINE');
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST', redirect: 'follow', signal: ctl.signal,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, token, ...payload }),
    });
  } catch (e) {
    throw new ApiError('เชื่อมต่อ server ไม่ได้', 'NETWORK');
  } finally { clearTimeout(t); }
  let data;
  try { data = await res.json(); } catch { throw new ApiError('server ตอบกลับไม่ถูกต้อง', 'BAD_RESPONSE'); }
  if (!data.ok) throw new ApiError(data.error || 'เกิดข้อผิดพลาด', data.code);
  return data;
}
