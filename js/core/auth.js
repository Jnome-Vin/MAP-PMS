// เข้าสู่ระบบด้วยอีเมล + รหัสผ่าน และสิทธิ์ผู้ใช้ 3 ระดับ
// - โหมด server: ตรวจรหัสที่ Apps Script แล้วเก็บ hash ไว้ในเครื่องเพื่อให้ login ตอน offline ได้
// - โหมด local: ผู้ใช้เก็บในเครื่องนี้ (ใช้ก่อนเชื่อม Google)
import { APP, isServerMode } from './config.js';
import * as db from './db.js';
import * as api from './api.js';

export const ROLES = { admin: 'Administrator', manager: 'Manager', operator: 'Operator' };

// ตารางสิทธิ์ — เพิ่มสิทธิ์ใหม่ที่นี่ที่เดียว
const PERMS = {
  'users.manage':   ['admin'],                       // เพิ่ม/แก้ผู้ใช้
  'rooms.manage':   ['admin'],                       // เพิ่ม/ลบห้อง
  'settings.view':  ['admin', 'manager'],            // เห็นเมนูตั้งค่า
  'data.delete':    ['admin', 'manager'],            // ลบข้อมูล
};
let session = null;
export const current = () => session;
export const can = perm => !!session && (PERMS[perm] ? PERMS[perm].includes(session.role) : true);

// ---------- hash (ต้องเหมือน backend/Auth.gs) ----------
async function sha256hex(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
export async function hashPassword(pw, salt, iter = APP.hashIterations) {
  let h = await sha256hex(salt + pw);
  for (let i = 1; i < iter; i++) h = await sha256hex(h + salt);
  return h;
}
export function randomString(n = 10, chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789') {
  const a = crypto.getRandomValues(new Uint32Array(n)); return [...a].map(x => chars[x % chars.length]).join('');
}
const norm = e => String(e || '').trim().toLowerCase();

// ---------- session ----------
const SKEY = 'mappms.session';
function saveSession(s) { session = s; try { s ? localStorage.setItem(SKEY, JSON.stringify(s)) : localStorage.removeItem(SKEY); } catch {} if (s) { db.setActor(s.email); api.setToken(s.token); } }
export function restore() {
  try {
    const s = JSON.parse(localStorage.getItem(SKEY) || 'null');
    if (s && new Date(s.exp) > new Date()) { saveSession(s); return s; }
  } catch {}
  saveSession(null); return null;
}
function makeSession(u, token, offline = false) {
  return { email: u.email, name: u.name, role: u.role, mustChange: !!u.mustChange, token, offline,
    exp: new Date(Date.now() + APP.sessionHours * 3600e3).toISOString() };
}
export function logout() { saveSession(null); }

// ---------- first run (โหมด local) ----------
export const needsSetup = () => !isServerMode() && db.all('users').length === 0;
export async function createFirstAdmin(email, name, pw) {
  const salt = randomString(16);
  const u = { id: norm(email), email: norm(email), name, role: 'admin', salt, hash: await hashPassword(pw, salt), mustChange: false, active: true };
  await db.put('users', u, { silent: true });
  saveSession(makeSession(u, null));
}

// ---------- login ----------
export async function login(email, pw) {
  email = norm(email);
  if (isServerMode()) {
    try {
      const r = await api.call('login', { email, password: pw });
      await db.meta('cred:' + email, { ...r.cred, user: r.user });       // สำหรับ login ตอน offline
      saveSession(makeSession(r.user, r.token));
      return session;
    } catch (e) {
      if (!['OFFLINE', 'NETWORK'].includes(e.code)) throw e;
      const c = await db.meta('cred:' + email);                          // offline: ตรวจกับ hash ที่เคยเก็บไว้
      if (!c) throw new Error('ออฟไลน์อยู่ และอีเมลนี้ยังไม่เคยเข้าสู่ระบบบนเครื่องนี้');
      if (await hashPassword(pw, c.salt, c.iter) !== c.hash) throw new Error('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
      saveSession(makeSession(c.user, null, true));
      return session;
    }
  }
  const u = db.get('users', email);
  if (!u || !u.active || await hashPassword(pw, u.salt) !== u.hash) throw new Error('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
  saveSession(makeSession(u, null));
  return session;
}

export async function changePassword(oldPw, newPw) {
  if (newPw.length < APP.minPasswordLength) throw new Error(`รหัสผ่านใหม่ต้องยาวอย่างน้อย ${APP.minPasswordLength} ตัวอักษร`);
  if (newPw === oldPw) throw new Error('รหัสผ่านใหม่ต้องไม่ซ้ำรหัสเดิม');
  if (isServerMode()) {
    const r = await api.call('changePassword', { oldPassword: oldPw, newPassword: newPw });
    await db.meta('cred:' + session.email, { ...r.cred, user: r.user });
  } else {
    const u = db.get('users', session.email);
    if (await hashPassword(oldPw, u.salt) !== u.hash) throw new Error('รหัสผ่านเดิมไม่ถูกต้อง');
    const salt = randomString(16);
    await db.put('users', { ...u, salt, hash: await hashPassword(newPw, salt), mustChange: false }, { silent: true });
  }
  saveSession({ ...session, mustChange: false });
}

// ---------- จัดการผู้ใช้ (Administrator เท่านั้น) ----------
function guard() { if (!can('users.manage')) throw new Error('ไม่มีสิทธิ์จัดการผู้ใช้'); }
const publicUser = u => ({ email: u.email, name: u.name, role: u.role, mustChange: !!u.mustChange, active: u.active !== false, lastLogin: u.lastLogin || '' });

export async function listUsers() {
  guard();
  if (isServerMode()) return (await api.call('listUsers')).users;
  return db.all('users').map(publicUser);
}
// คืนค่ารหัสผ่านชั่วคราวเพื่อให้ Admin แจ้งผู้ใช้ — ผู้ใช้ต้องเปลี่ยนเองตอนเข้าครั้งแรก
export async function addUser({ email, name, role }) {
  guard(); email = norm(email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('รูปแบบอีเมลไม่ถูกต้อง');
  if (!ROLES[role]) throw new Error('ระดับผู้ใช้ไม่ถูกต้อง');
  if (isServerMode()) return (await api.call('addUser', { email, name, role })).tempPassword;
  if (db.get('users', email)) throw new Error('มีอีเมลนี้อยู่แล้ว');
  const temp = randomString(10), salt = randomString(16);
  await db.put('users', { id: email, email, name, role, salt, hash: await hashPassword(temp, salt), mustChange: true, active: true }, { silent: true });
  return temp;
}
export async function updateUser(email, patch) {
  guard();
  if (email === session.email && (patch.role && patch.role !== 'admin' || patch.active === false)) throw new Error('ไม่สามารถลดสิทธิ์หรือปิดบัญชีของตัวเองได้');
  if (isServerMode()) return api.call('updateUser', { email, patch });
  const u = db.get('users', email); await db.put('users', { ...u, ...patch }, { silent: true });
}
export async function resetPassword(email) {
  guard();
  if (isServerMode()) return (await api.call('resetPassword', { email })).tempPassword;
  const u = db.get('users', email), temp = randomString(10), salt = randomString(16);
  await db.put('users', { ...u, salt, hash: await hashPassword(temp, salt), mustChange: true }, { silent: true });
  return temp;
}
