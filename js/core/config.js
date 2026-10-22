// ค่าตั้งต้นของแอป — URL ของ Apps Script ตั้งได้จากหน้า "ตั้งค่า" (เก็บใน localStorage)
export const APP = {
  name: 'มีชัย อพาร์ทเม้นท์',
  version: '0.9.12',
  hashIterations: 1000,          // ต้องตรงกับ backend/Auth.gs
  sessionHours: 12,
  minPasswordLength: 8,
};

export function getApiUrl() {
  try { return localStorage.getItem('mappms.apiUrl') || ''; } catch { return ''; }
}
export function setApiUrl(url) {
  try { url ? localStorage.setItem('mappms.apiUrl', url.trim()) : localStorage.removeItem('mappms.apiUrl'); } catch {}
}
// โหมด local = ยังไม่เชื่อม Google (ข้อมูลอยู่ในเครื่องนี้เท่านั้น)
export const isServerMode = () => !!getApiUrl();
