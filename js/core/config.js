// ค่าตั้งต้นของแอป — URL ของ Apps Script ตั้งได้จากหน้า "ตั้งค่า" (เก็บใน localStorage)
export const APP = {
  name: 'มีชัย อพาร์ทเม้นท์',
  version: '0.9.22',
  hashIterations: 1000,          // ต้องตรงกับ backend/Auth.gs
  sessionHours: 12,
  minPasswordLength: 8,
};

// เครื่องใหม่เชื่อม Google Apps Script ของอาคารนี้อัตโนมัติ (URL นี้เปิดเผยได้ — ทุกคำสั่งต้องเข้าสู่ระบบก่อน)
export const DEFAULT_API_URL = 'https://script.google.com/macros/s/AKfycbyhf1cYZT2tIf2plXx0YPU45YOUo9xlmeH-VDpk6y8EiY_rSLo54rUFhRRtvaxlVQ0/exec';
const LOCAL_ONLY = '-';   // ผู้ใช้กด "ยกเลิกการเชื่อม" → ใช้โหมดเครื่องเดียว

export function getApiUrl() {
  try {
    const v = localStorage.getItem('mappms.apiUrl');
    return v === LOCAL_ONLY ? '' : (v || DEFAULT_API_URL);
  } catch { return DEFAULT_API_URL; }
}
export function setApiUrl(url) {
  try { localStorage.setItem('mappms.apiUrl', url ? url.trim() : LOCAL_ONLY); } catch {}
}
// โหมด local = ยังไม่เชื่อม Google (ข้อมูลอยู่ในเครื่องนี้เท่านั้น)
export const isServerMode = () => !!getApiUrl();
