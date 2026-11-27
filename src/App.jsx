import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CircleHelp, FileText, LogOut, Maximize2, MessageCircle, MessagesSquare, Monitor, Plus, RefreshCw, Search, Send, Settings, Smartphone, TriangleAlert, Trash2, Upload, X } from 'lucide-react';
import { api, ApiError } from './api.js';
import { prepareImage } from './ocrClient.js';
import ImageViewer from './ImageViewer.jsx';
import LineGroups from './LineGroups.jsx';
import OcrSettings from './OcrSettings.jsx';
import { formatReceived, isPending, monthNames, money, statusLabels, thaiDate } from './data.js';
import { validate, warnings, fieldOrder } from './validation.js';

const emptyItem = () => ({ product: '', size: '', color: '' });
const LAYOUT_KEY = 'receipt-desk-layout-v1';
const readPhone = () => { try { return localStorage.getItem(LAYOUT_KEY) === 'phone'; } catch { return false; } };
const SAVE_DELAY_MS = 800;
const REFRESH_MS = 60_000;

function TextField({ label, value, onChange, locked, error, unsure, className = '', hint, ...rest }) {
  const id = useId();
  const errId = `${id}-e`;
  return <div className={`field ${className}`}>
    <label htmlFor={id}>{label}{unsure && <span className="unsure"><TriangleAlert size={14} aria-hidden="true" />OCR ไม่แน่ใจ ตรวจกับรูป</span>}</label>
    <input id={id} value={value} readOnly={locked} onChange={e => onChange(e.target.value)}
      aria-invalid={error ? 'true' : undefined} aria-describedby={error ? errId : undefined}
      className={unsure && !error ? 'is-unsure' : ''} {...rest} />
    {hint && !error && <p className="hint">{hint}</p>}
    {error && <p className="error" id={errId}><TriangleAlert size={14} aria-hidden="true" />{error}</p>}
  </div>;
}

// วันที่แบบไทย: วัน / เดือน (ชื่อเดือน) / ปี พ.ศ. — เก็บเป็น ค.ศ. แบบ YYYY-MM-DD
function ThaiDateField({ label, value, onChange, locked, error, optional }) {
  const id = useId();
  const errId = `${id}-e`;
  const parse = v => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || ''); return m ? { d: String(Number(m[3])), m: String(Number(m[2])), y: String(Number(m[1]) + 543) } : { d: '', m: '', y: '' }; };
  const [parts, setParts] = useState(() => parse(value));
  function change(next) {
    setParts(next);
    const [d, m, y] = [Number(next.d), Number(next.m), Number(next.y) - 543];
    const t = new Date(Date.UTC(y, m - 1, d));
    const ok = next.d && next.m && /^\d{4}$/.test(next.y) && t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
    onChange(ok ? `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : '');
  }
  const bad = error ? 'true' : undefined;
  return <div className="field" role="group" aria-labelledby={`${id}-l`} aria-describedby={error ? errId : undefined}>
    <span className="label" id={`${id}-l`}>{label}{optional && <span className="optional">ไม่บังคับ</span>}</span>
    <div className="date-row">
      <input aria-label={`${label} วัน`} inputMode="numeric" maxLength={2} placeholder="วัน" value={parts.d} readOnly={locked} aria-invalid={bad}
        onChange={e => change({ ...parts, d: e.target.value.replace(/\D/g, '') })} />
      <select aria-label={`${label} เดือน`} value={parts.m} disabled={locked} aria-invalid={bad} onChange={e => change({ ...parts, m: e.target.value })}>
        <option value="">เดือน</option>
        {monthNames.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
      </select>
      <input aria-label={`${label} ปี พ.ศ.`} inputMode="numeric" maxLength={4} placeholder="ปี พ.ศ." value={parts.y} readOnly={locked} aria-invalid={bad}
        onChange={e => change({ ...parts, y: e.target.value.replace(/\D/g, '') })} />
    </div>
    {error && <p className="error" id={errId}><TriangleAlert size={14} aria-hidden="true" />{error}</p>}
  </div>;
}

function StatusBadge({ status }) {
  const icon = status === 'check' || status === 'rejected' ? <TriangleAlert size={14} aria-hidden="true" /> : status === 'confirmed' || status === 'done' ? <Check size={14} aria-hidden="true" /> : <span className="dot" aria-hidden="true" />;
  return <span className={`badge badge-${status}`}>{icon}{statusLabels[status]}</span>;
}

function LoginScreen({ onLoggedIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const emailId = useId();
  const passId = useId();
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try { onLoggedIn(await api.login(email, password)); } catch (err) { setError(err.message); setBusy(false); }
  }
  return <div className="login-wrap">
    <form className="login-card" onSubmit={submit} aria-label="เข้าสู่ระบบ">
      <span className="brand-mark" aria-hidden="true"><FileText size={24} /></span>
      <h1>Receipt Desk</h1>
      <p className="login-sub">เข้าสู่ระบบเพื่อตรวจใบสั่งซื้อ</p>
      <div className="field"><label htmlFor={emailId}>อีเมล</label><input id={emailId} type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></div>
      <div className="field upload-gap"><label htmlFor={passId}>รหัสผ่าน</label><input id={passId} type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></div>
      {error && <div className="banner bad" role="alert"><TriangleAlert size={18} aria-hidden="true" />{error}</div>}
      <button className="btn primary big login-btn" type="submit" disabled={busy}>{busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}</button>
    </form>
  </div>;
}

function UploadForm({ branches, defaultBranch, ocr, onDone }) {
  const [file, setFile] = useState(null);
  const [branch, setBranch] = useState(defaultBranch);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileId = useId();
  const branchId = useId();
  async function start() {
    setBusy(true); setError('');
    try {
      const image = await prepareImage(file);
      onDone(await api.createOrder(image, branch));
    } catch (e) { setError(e.message || 'อัปโหลดไม่สำเร็จ'); setBusy(false); }
  }
  return <>
    <p className="modal-desc">เลือกรูปถ่ายใบสั่งซื้อ (JPG / PNG) ระบบจะเก็บรูปและอ่านข้อมูลให้ แล้วคุณตรวจและแก้ก่อนยืนยัน</p>
    <div className="field"><label htmlFor={fileId}>รูปใบสั่งซื้อ</label><input id={fileId} type="file" accept="image/*" disabled={busy} onChange={e => { setFile(e.target.files?.[0] || null); setError(''); }} /></div>
    {branches.length
      ? <div className="field upload-gap"><label htmlFor={branchId}>สาขาที่ส่งมา</label><select id={branchId} value={branch} disabled={busy} onChange={e => setBranch(e.target.value)}>{branches.map(b => <option key={b} value={b}>{b}</option>)}</select></div>
      : <div className="banner warn upload-gap"><TriangleAlert size={18} aria-hidden="true" />ยังไม่มีสาขาในระบบ — ให้ผู้ดูแลเพิ่มสาขาที่ปุ่ม "กลุ่ม LINE" ก่อน</div>}
    {ocr.provider === 'none' && <div className="notice">ยังไม่ได้ตั้งค่า OCR ในระบบ — ระบบจะเก็บรูปไว้ แล้วให้คุณกรอกข้อมูลเอง</div>}
    {ocr.provider !== 'none' && !ocr.configured && <div className="banner bad"><TriangleAlert size={18} aria-hidden="true" />ยังไม่ได้ใส่คีย์ของ {ocr.provider} ในเซิร์ฟเวอร์ — ระบบจะเก็บรูปไว้โดยไม่อ่านอัตโนมัติ</div>}
    {ocr.demo && <div className="notice">โหมดสาธิต: ระบบ <strong>ไม่ได้อ่านรูปจริง</strong> จะสร้างข้อมูลสมมติ (ใช้ตอนพัฒนาเท่านั้น)</div>}
    {ocr.configured && !ocr.demo && <div className="notice">รูปจะถูกส่งไปที่ <strong>{ocr.provider}</strong>{ocr.backup && <> (สำรอง: <strong>{ocr.backup}</strong>)</>} เพื่ออ่านข้อมูล ใบสั่งซื้อมีข้อมูลลูกค้า ส่งเฉพาะรูปที่ตั้งใจให้อ่าน</div>}
    {error && <div className="banner bad" role="alert"><TriangleAlert size={18} aria-hidden="true" />{error}</div>}
    <div className="modal-actions"><button className="btn primary" disabled={!file || busy || !branch} aria-busy={busy} onClick={start}>{busy ? 'กำลังอ่านรูป…' : <><Upload size={18} aria-hidden="true" />อัปโหลดและอ่านใบสั่งซื้อ</>}</button></div>
  </>;
}

function RejectForm({ onSubmit }) {
  const [reason, setReason] = useState('');
  const id = useId();
  return <>
    <p className="modal-desc">ใช้เมื่อรูปนี้ไม่ใช่ใบสั่งซื้อ รูปซ้ำ หรือใช้ไม่ได้ (ปฏิเสธแล้วแก้ไขไม่ได้)</p>
    <div className="field"><label htmlFor={id}>เหตุผล</label><input id={id} value={reason} maxLength={300} onChange={e => setReason(e.target.value)} placeholder="เช่น รูปซ้ำกับใบก่อนหน้า" /></div>
    <div className="modal-actions"><button className="btn danger" disabled={!reason.trim()} onClick={() => onSubmit(reason.trim())}>ปฏิเสธใบนี้</button></div>
  </>;
}

export default function App() {
  const [auth, setAuth] = useState({ state: 'loading' });
  const [orders, setOrders] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [tab, setTab] = useState('todo');
  const [query, setQuery] = useState('');
  const [branch, setBranch] = useState('all');
  const [shown, setShown] = useState(() => new Set());
  const [saves, setSaves] = useState({});
  const [toast, setToast] = useState('');
  const [dialog, setDialog] = useState(null);
  const [newId, setNewId] = useState(null);
  const [mobileView, setMobileView] = useState('list');
  const [phone, setPhone] = useState(readPhone);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef(null);
  const lastFocus = useRef(null);
  const formRef = useRef(null);
  const ordersRef = useRef([]);
  const pending = useRef({});
  const timers = useRef({});
  const inflight = useRef({});

  const mutate = useCallback(fn => { ordersRef.current = fn(ordersRef.current); setOrders(ordersRef.current); }, []);
  const setSave = useCallback((id, state, message = '') => setSaves(s => ({ ...s, [id]: { state, message } })), []);

  // ---- เซสชัน
  useEffect(() => {
    api.me().then(d => setAuth({ state: 'in', ...d })).catch(() => setAuth({ state: 'out' }));
  }, []);
  const handleAuthError = useCallback(e => {
    if (e instanceof ApiError && e.status === 401) { setAuth({ state: 'out' }); return true; }
    return false;
  }, []);

  // ---- โหลด/รีเฟรชรายการ (ไม่ทับใบที่มีการแก้ไขที่ยังไม่บันทึก)
  const refresh = useCallback(async () => {
    try {
      const { orders: fresh } = await api.orders();
      const local = new Map(ordersRef.current.map(o => [o.id, o]));
      mutate(() => fresh.map(o => {
        const l = local.get(o.id);
        const dirty = pending.current[o.id] || inflight.current[o.id];
        return l && dirty ? { ...o, ...l, imageUrl: o.imageUrl || l.imageUrl } : o;
      }));
      setLoadError(''); setLoaded(true);
    } catch (e) { if (!handleAuthError(e)) { setLoadError(e.message); setLoaded(true); } }
  }, [mutate, handleAuthError]);
  useEffect(() => {
    if (auth.state !== 'in') return undefined;
    refresh();
    const t = setInterval(refresh, REFRESH_MS);
    const onFocus = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onFocus);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onFocus); };
  }, [auth.state, refresh]);

  useEffect(() => { if (!toast) return undefined; const t = setTimeout(() => setToast(''), 5000); return () => clearTimeout(t); }, [toast]);
  useEffect(() => {
    if (!dialog) return undefined;
    lastFocus.current = document.activeElement;
    dialogRef.current?.showModal();
    return () => lastFocus.current?.focus();
  }, [dialog]);

  // ---- บันทึกอัตโนมัติ: รวมการแก้ไข หน่วง 0.8 วินาที ส่งทีละคำขอต่อใบ
  const flush = useCallback(id => {
    clearTimeout(timers.current[id]);
    const run = async () => {
      while (pending.current[id]) {
        const p = pending.current[id];
        pending.current[id] = null;
        const order = ordersRef.current.find(o => o.id === id);
        if (!order) return;
        setSave(id, 'saving');
        try {
          const r = await api.save(id, order.version, p.fields, p.items);
          mutate(os => os.map(o => (o.id === id ? { ...o, version: r.version } : o)));
          setSave(id, pending.current[id] ? 'dirty' : 'saved');
        } catch (e) {
          if (handleAuthError(e)) return;
          if (e.code === 'conflict' || e.code === 'locked') { pending.current[id] = null; setSave(id, 'conflict', e.message); return; }
          pending.current[id] = { fields: { ...p.fields, ...(pending.current[id]?.fields || {}) }, items: pending.current[id]?.items || p.items };
          setSave(id, 'error', e.message);
          return;
        }
      }
    };
    inflight.current[id] = (inflight.current[id] || Promise.resolve()).then(run).finally(() => { if (!pending.current[id]) delete inflight.current[id]; });
    return inflight.current[id];
  }, [mutate, setSave, handleAuthError]);

  function update(id, key, value) {
    const order = ordersRef.current.find(o => o.id === id);
    if (!order || !isPending(order.status)) return;
    mutate(os => os.map(o => (o.id === id ? { ...o, [key]: value } : o)));
    const p = pending.current[id] || { fields: {}, items: null };
    if (key === 'items') p.items = value; else p.fields[key] = value;
    pending.current[id] = p;
    setSave(id, 'dirty');
    clearTimeout(timers.current[id]);
    timers.current[id] = setTimeout(() => flush(id), SAVE_DELAY_MS);
  }

  const visible = orders.filter(o => (branch === 'all' || o.branch === branch)
    && (tab === 'todo' ? isPending(o.status) : tab === 'jst' ? o.status === 'confirmed' : o.status === 'done' || o.status === 'rejected')
    && `${o.code} ${o.billNumber} ${o.customerName} ${o.phone} ${o.sender} ${o.branch}`.toLowerCase().includes(query.trim().toLowerCase()));
  const current = visible.find(o => o.id === selectedId) || visible[0] || null;
  const errors = current ? validate(current) : {};
  const showErrors = current ? shown.has(current.id) : false;
  const locked = !!current && !isPending(current.status);
  const save = (current && saves[current.id]) || { state: 'saved' };
  const branches = auth.branches || [];
  const counts = { todo: orders.filter(o => isPending(o.status)).length, jst: orders.filter(o => o.status === 'confirmed').length, closed: orders.filter(o => o.status === 'done' || o.status === 'rejected').length };

  function select(id) { setSelectedId(id); setMobileView('detail'); }
  function toggleLayout() {
    const next = !phone;
    setPhone(next); setMobileView('list');
    try { localStorage.setItem(LAYOUT_KEY, next ? 'phone' : 'desktop'); } catch { /* ใช้ได้ต่อโดยไม่จำค่า */ }
  }
  async function logout() {
    try { await api.logout(); } catch { /* ออกจากระบบฝั่งหน้าเว็บอยู่ดี */ }
    pending.current = {}; ordersRef.current = []; setOrders([]); setLoaded(false); setSelectedId(null); setAuth({ state: 'out' });
  }
  function focusFirstError() {
    setTimeout(() => formRef.current?.querySelector('[aria-invalid="true"]')?.focus(), 30);
  }

  // ทำรายการสถานะ (ยืนยัน / ปฏิเสธ / ย้อนกลับ / ลง JST แล้ว) — บันทึกที่ค้างอยู่ให้เสร็จก่อนเสมอ
  async function act(action, extra) {
    const o = current;
    if (!o || busy) return;
    setBusy(true);
    try {
      if (pending.current[o.id] || inflight.current[o.id]) { await flush(o.id); }
      if (saves[o.id]?.state === 'conflict' || pending.current[o.id]) { setToast('บันทึกการแก้ไขล่าสุดไม่สำเร็จ ตรวจข้อความด้านล่างก่อน'); return; }
      const fresh = ordersRef.current.find(x => x.id === o.id);
      const r = await api.act(o.id, action, fresh.version, extra);
      const idx = visible.findIndex(v => v.id === o.id);
      const nextPending = visible.slice(idx + 1).find(v => v.id !== o.id && isPending(v.status)) || visible.slice(0, idx).reverse().find(v => isPending(v.status));
      mutate(os => os.map(x => (x.id === o.id ? { ...x, ...r.order } : x)));
      setDialog(null);
      const msg = { confirm: `${o.code} ยืนยันแล้ว — รอลงใน JST`, reject: `${o.code} ปฏิเสธแล้ว`, reopen: `${o.code} ย้อนกลับมาแก้ไขได้แล้ว`, 'jst-done': `${o.code} ทำเครื่องหมายว่าลง JST แล้ว` }[action];
      if ((action === 'confirm' || action === 'reject') && nextPending) { setSelectedId(nextPending.id); setToast(`${msg} · เปิดใบถัดไปให้แล้ว`); } else setToast(msg);
    } catch (e) {
      if (handleAuthError(e)) return;
      setDialog(null);
      if (e.fields) { setShown(s => new Set(s).add(o.id)); focusFirstError(); setToast(e.message); } else { setToast(e.message); if (e.code === 'conflict') { setSave(o.id, 'conflict', e.message); } }
    } finally { setBusy(false); }
  }
  function requestConfirm() {
    if (!current || locked) return;
    if (Object.keys(errors).length) { setShown(s => new Set(s).add(current.id)); focusFirstError(); return; }
    setDialog({ type: 'confirm' });
  }
  async function reload() {
    if (current) { pending.current[current.id] = null; delete inflight.current[current.id]; setSave(current.id, 'saved'); }
    await refresh();
  }
  function onUploaded({ order, ocrError }) {
    mutate(os => [order, ...os]);
    setNewId(order.id); setSelectedId(order.id); setQuery(''); setBranch('all'); setTab('todo'); setMobileView('detail'); setDialog(null);
    setToast(ocrError ? `เก็บรูปแล้ว แต่อ่านอัตโนมัติไม่สำเร็จ: ${ocrError} — กรอกข้อมูลจากรูปเอง`
      : order.ocrStatus === 'skipped' ? 'เก็บรูปแล้ว — กรอกข้อมูลจากรูปได้เลย'
        : `อ่านใบสั่งซื้อแล้ว ตรวจช่องสีเหลืองก่อนยืนยัน${order.duplicateOf ? ` · อาจซ้ำกับ ${order.duplicateOf}` : ''}`);
  }
  // อ่านรูปใหม่ให้ใบที่ OCR ล้มเหลว — บันทึกที่ค้างอยู่ให้เสร็จก่อน เซิร์ฟเวอร์เติมเฉพาะช่องที่ยังว่าง
  async function retryOcr() {
    const o = current;
    if (!o || busy) return;
    setBusy(true);
    try {
      if (pending.current[o.id] || inflight.current[o.id]) { await flush(o.id); }
      if (saves[o.id]?.state === 'conflict' || pending.current[o.id]) { setToast('บันทึกการแก้ไขล่าสุดไม่สำเร็จ ตรวจข้อความด้านล่างก่อน'); return; }
      const fresh = ordersRef.current.find(x => x.id === o.id);
      const r = await api.retryOcr(o.id, fresh.version);
      mutate(os => os.map(x => (x.id === o.id ? { ...x, ...r.order, imageUrl: r.order.imageUrl || x.imageUrl } : x)));
      setToast(r.ocrError ? `ยังอ่านไม่สำเร็จ: ${r.ocrError}` : `อ่านรูป ${o.code} แล้ว ตรวจช่องสีเหลืองก่อนยืนยัน${r.order.duplicateOf ? ` · อาจซ้ำกับ ${r.order.duplicateOf}` : ''}`);
    } catch (e) {
      if (handleAuthError(e)) return;
      setToast(e.message);
      if (e.code === 'conflict') setSave(o.id, 'conflict', e.message);
    } finally { setBusy(false); }
  }
  // ลบใบที่ดึงมาผิด (เฉพาะใบที่ยังรอตรวจ) — ให้ API/ฐานข้อมูลเป็นผู้ตัดสิน แล้วค่อยเอาออกจากรายการ
  async function removeOrder() {
    const id = dialog?.id;
    const o = ordersRef.current.find(x => x.id === id);
    if (!o || busy) return;
    setBusy(true);
    try {
      pending.current[o.id] = null; delete inflight.current[o.id];
      await api.remove(o.id, o.version);
      const idx = visible.findIndex(v => v.id === o.id);
      const next = visible.slice(idx + 1).find(v => v.id !== o.id) || visible.slice(0, idx).reverse()[0] || null;
      mutate(os => os.filter(x => x.id !== o.id));
      setDialog(null);
      if (selectedId === o.id || !selectedId) setSelectedId(next ? next.id : null);
      setToast(`ลบ ${o.code} แล้ว`);
    } catch (e) {
      if (handleAuthError(e)) return;
      setDialog(null);
      setToast(e.message);
      if (e.code === 'conflict' || e.code === 'locked' || e.status === 404) await refresh();
    } finally { setBusy(false); }
  }
  const setItem = (i, key, value) => update(current.id, 'items', current.items.map((it, j) => (j === i ? { ...it, [key]: value } : it)));
  const err = k => (showErrors ? errors[k] : undefined);
  const unsure = k => !!current?.uncertain?.includes(k) && !locked;
  const warn = current ? warnings(current) : [];
  const errorCount = Object.keys(errors).length;

  if (auth.state === 'loading') return <div className="boot" role="status">กำลังโหลด…</div>;
  if (auth.state === 'out') return <LoginScreen onLoggedIn={d => { setAuth({ state: 'in', ...d }); }} />;

  const tabs = [{ key: 'todo', label: 'รอตรวจ', count: counts.todo }, { key: 'jst', label: 'รอลง JST', count: counts.jst }, { key: 'closed', label: 'เสร็จสิ้น', count: counts.closed }];

  return <div className={`app view-${mobileView}${phone ? ' phone-mode' : ''}`}>
    <div className="frame">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true"><FileText size={22} /></span>
          <div><strong>Receipt Desk</strong><span>ตรวจใบสั่งซื้อจาก LINE แล้วส่งต่อเข้า JST</span></div>
        </div>
        <div className="top-actions">
          <button className="btn ghost layout-toggle" aria-label="มุมมองมือถือ" aria-pressed={phone} onClick={toggleLayout} title={phone ? 'กดเพื่อกลับเป็นแบบเดสก์ท็อป' : 'กดเพื่อดูแบบมือถือ'}>{phone ? <Monitor size={18} aria-hidden="true" /> : <Smartphone size={18} aria-hidden="true" />}<span className="lbl">{phone ? 'เดสก์ท็อป' : 'มือถือ'}</span></button>
          <button className="btn ghost line-btn" aria-label="กลุ่ม LINE" title="กลุ่ม LINE ที่บอทอยู่" onClick={() => setDialog({ type: 'line' })}><MessagesSquare size={18} aria-hidden="true" /><span className="lbl-long">กลุ่ม LINE</span></button>
          <button className="btn ghost" onClick={() => setDialog({ type: 'help' })}><CircleHelp size={18} aria-hidden="true" />วิธีใช้</button>
          <button className="btn primary" aria-label="อัปโหลดใบสั่งซื้อ" onClick={() => setDialog({ type: 'upload' })}><Upload size={18} aria-hidden="true" /><span className="lbl-long">อัปโหลดใบสั่งซื้อ</span><span className="lbl-short">อัปโหลด</span></button>
          {auth.user.role === 'admin' && <button className="icon-btn" aria-label="ตั้งค่า OCR" title="ตั้งค่าตัวอ่าน OCR" onClick={() => setDialog({ type: 'settings' })}><Settings size={20} /></button>}
          <span className="user-name" title={auth.user.email}>{auth.user.name}</span>
          <button className="icon-btn" aria-label="ออกจากระบบ" title="ออกจากระบบ" onClick={logout}><LogOut size={20} /></button>
        </div>
      </header>

      <div className="workspace">
        <aside className="list-pane" aria-label="รายการใบสั่งซื้อ">
          <div className="tabs" role="tablist" aria-label="กรองตามสถานะ">
            {tabs.map(t => <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'tab selected' : 'tab'} onClick={() => setTab(t.key)}>{t.label}<span>{t.count}</span></button>)}
          </div>
          <div className="filters">
            <label className="search"><Search size={18} aria-hidden="true" /><input aria-label="ค้นหาใบสั่งซื้อ" placeholder="ค้นหาชื่อลูกค้า เบอร์ หรือเลขที่บิล" value={query} onChange={e => setQuery(e.target.value)} />
              {query && <button className="icon-btn" aria-label="ล้างคำค้น" onClick={() => setQuery('')}><X size={16} /></button>}</label>
            <div className="filter-row">
              <select aria-label="กรองสาขา" value={branch} onChange={e => setBranch(e.target.value)}>
                <option value="all">ทุกสาขา</option>
                {branches.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
              <button className="icon-btn" aria-label="รีเฟรชรายการ" title="รีเฟรชรายการ" onClick={refresh}><RefreshCw size={18} /></button>
            </div>
          </div>
          {loadError && <div className="banner bad list-banner" role="alert"><TriangleAlert size={18} aria-hidden="true" />{loadError}</div>}
          {!loaded && !loadError && <p className="list-foot" role="status">กำลังโหลดรายการ…</p>}
          <ul className="order-list">
            {visible.map(o => {
              const bad = warnings(o).length > 0 || !!o.duplicateOf;
              return <li key={o.id} className="order-row"><button className={`order-item${o.id === current?.id ? ' active' : ''}${o.id === newId ? ' is-new' : ''}`} aria-current={o.id === current?.id ? 'true' : undefined} onClick={() => select(o.id)}>
                <span className="oi-top"><strong>{o.customerName || 'ยังไม่มีชื่อลูกค้า'}</strong><span className="oi-amount">{o.total ? `฿${money(o.total)}` : '—'}</span></span>
                <span className="oi-meta">{o.code} · {o.billNumber || 'ยังไม่มีเลขที่บิล'}</span>
                <span className="oi-meta">Sales · {o.branch} · {formatReceived(o.receivedAt)}</span>
                <span className="oi-bottom"><StatusBadge status={o.status} />{bad && isPending(o.status) && <span className="mini-warn"><TriangleAlert size={14} aria-hidden="true" />{o.duplicateOf ? 'อาจซ้ำ' : 'ยอดไม่ตรง'}</span>}{o.id === newId && <span className="new-tag">ใหม่</span>}</span>
              </button>{isPending(o.status) && <button className="icon-btn danger oi-delete" aria-label={`ลบ ${o.code}`} title="ลบใบนี้ (กรณีดึงมาผิด)" disabled={busy} onClick={() => setDialog({ type: 'delete', id: o.id })}><Trash2 size={16} aria-hidden="true" /></button>}</li>;
            })}
          </ul>
          {loaded && !visible.length && (orders.length === 0
            ? <div className="empty"><FileText size={28} aria-hidden="true" /><h3>ยังไม่มีใบสั่งซื้อ</h3><p>กด "อัปโหลดใบสั่งซื้อ" เพื่อเริ่ม</p></div>
            : <div className="empty"><Search size={28} aria-hidden="true" /><h3>ไม่พบใบสั่งซื้อในมุมมองนี้</h3><p>ลองเปลี่ยนแท็บ คำค้น หรือสาขา</p><button className="btn outline" onClick={() => { setQuery(''); setBranch('all'); }}>ล้างตัวกรอง</button></div>)}
          <p className="list-foot">แสดง {visible.length} จาก {orders.length} รายการ</p>
        </aside>

        <section className="detail-pane" aria-label="รายละเอียดใบสั่งซื้อ">
          {!current ? <div className="empty big"><FileText size={36} aria-hidden="true" /><h2>เลือกใบสั่งซื้อจากรายการด้านซ้าย</h2><p>{loaded ? 'ยังไม่มีรายการในมุมมองนี้' : 'กำลังโหลด…'}</p></div> : <>
            <div className="detail-head">
              <button className="btn ghost back" onClick={() => setMobileView('list')}><ArrowLeft size={18} aria-hidden="true" />กลับไปรายการ</button>
              <div className="dh-title">
                <h1>ใบสั่งซื้อ <span className="nowrap">{current.billNumber || current.code}</span></h1>
                <p><span>{current.code}</span><span><MessageCircle size={14} aria-hidden="true" /> Sales {current.branch}</span><span>{current.source === 'line' ? `ส่งทาง LINE โดย ${current.sender}` : `ผู้อัปโหลด ${current.sender}`}</span><span>{formatReceived(current.receivedAt)} น.</span>
                  <span className={current.confidence != null && current.confidence < 80 ? 'ocr low' : 'ocr'}>{current.confidence == null ? 'ไม่ได้ใช้ OCR' : `OCR ${current.confidence}% (${current.ocrProvider === 'mock' ? 'สาธิต' : 'ประเมินจากกฎตรวจ'})`}</span></p>
              </div>
              <StatusBadge status={current.status} />
              <button className="btn outline dh-next" onClick={() => { const n = visible[visible.indexOf(current) + 1]; if (n) setSelectedId(n.id); }} disabled={visible.indexOf(current) >= visible.length - 1}>ใบถัดไป<ArrowRight size={18} aria-hidden="true" /></button>
            </div>

            <div className="detail-scroll">
              <div className="detail-grid">
                <div className="photo-card">
                  {current.imageUrl
                    ? <button className="photo" aria-label={`ขยายรูปใบสั่งซื้อ ${current.code}`} onClick={() => setDialog({ type: 'image' })}>
                      <img src={current.imageUrl} alt={`รูปใบสั่งซื้อ ${current.code}`} onError={() => refresh()} />
                      <span className="zoom"><Maximize2 size={16} aria-hidden="true" />คลิกเพื่อขยาย/ซูม</span>
                    </button>
                    : <div className="photo no-photo"><FileText size={28} aria-hidden="true" />ไม่มีรูป</div>}
                  <p className="photo-note">รูปต้นฉบับที่อัปโหลด (ย่อขนาดและลบข้อมูล EXIF แล้ว)</p>
                  <button className="btn outline" disabled={!current.ocrRaw} onClick={() => setDialog({ type: 'ocr' })}><FileText size={18} aria-hidden="true" />ดูข้อความ OCR ดิบ</button>
                </div>

                <form className="form" ref={formRef} onSubmit={e => e.preventDefault()} aria-label={`ข้อมูลใบสั่งซื้อ ${current.code}`}>
                  {current.status === 'confirmed' && <div className="banner info"><Check size={18} aria-hidden="true" />ยืนยันข้อมูลแล้ว — รอลงใน JST (ยังไม่ได้เชื่อมบอท: ลงใน JST เอง แล้วกด "ทำเครื่องหมายว่าลง JST แล้ว")</div>}
                  {current.status === 'done' && <div className="banner info"><Check size={18} aria-hidden="true" />ทำเครื่องหมายว่าลงใน JST แล้ว</div>}
                  {current.status === 'rejected' && <div className="banner bad"><TriangleAlert size={18} aria-hidden="true" />ปฏิเสธใบนี้แล้ว: {current.rejectReason}</div>}
                  {(current.ocrStatus === 'failed' || current.ocrStatus === 'skipped') && isPending(current.status) && (
                    <div className="banner warn">
                      <TriangleAlert size={18} aria-hidden="true" />
                      <div className="banner-body">
                        <strong>{current.ocrStatus === 'failed' ? 'อ่านรูปอัตโนมัติไม่สำเร็จ' : 'ใบนี้ไม่ได้ผ่าน OCR'}</strong><br />
                        {auth.ocr?.configured ? 'กดอ่านรูปใหม่ หรือกรอกข้อมูลจากรูปด้วยตนเอง (อ่านใหม่จะเติมเฉพาะช่องที่ยังว่าง)' : 'กรอกข้อมูลจากรูปด้วยตนเอง'}
                        {auth.ocr?.configured && <button type="button" className="btn outline retry-ocr" disabled={busy} onClick={retryOcr}><RefreshCw size={16} aria-hidden="true" />{busy ? 'กำลังอ่านรูป…' : 'อ่านรูปใหม่'}</button>}
                      </div>
                    </div>
                  )}
                  {current.ocrProvider === 'mock' && <div className="banner warn"><TriangleAlert size={18} aria-hidden="true" /><div><strong>ข้อมูลจากโหมดสาธิต</strong><br />ไม่ได้อ่านจากรูปนี้จริง</div></div>}
                  {current.duplicateOf && isPending(current.status) && <div className="banner warn"><TriangleAlert size={18} aria-hidden="true" /><div><strong>อาจเป็นใบซ้ำ</strong><br />เลขที่บิลและยอดตรงกับ {current.duplicateOf} — ตรวจก่อนยืนยัน</div></div>}
                  {isPending(current.status) && warn.map(w => <div className="banner warn" key={w.key}><TriangleAlert size={18} aria-hidden="true" /><div><strong>ยอดไม่ตรงกับใบเสร็จ</strong><br />ใบสั่งซื้อ ฿{money(current.total)} · ใบเสร็จ ฿{money(current.posTotal)} · ต่างกัน ฿{money(Math.abs(w.diff))} (อาจเป็นส่วนลด) — ตรวจแล้วจึงยืนยันได้</div></div>)}

                  <fieldset><legend>ข้อมูลบิล</legend>
                    <div className="grid2">
                      <TextField label="เลขที่บิล" value={current.billNumber} onChange={v => update(current.id, 'billNumber', v)} locked={locked} error={err('billNumber')} unsure={unsure('billNumber')} />
                      <ThaiDateField key={`${current.id}-od`} label="วันที่สั่งซื้อ" value={current.orderDate} onChange={v => update(current.id, 'orderDate', v)} locked={locked} error={err('orderDate')} />
                      <TextField label="ยอดรวม (บาท)" inputMode="decimal" value={current.total} onChange={v => update(current.id, 'total', v.replace(/[^\d.]/g, ''))} locked={locked} error={err('total')} unsure={unsure('total')} className="amount"
                        hint={Number(current.total) > 0 ? `= ฿${money(current.total)}` : undefined} />
                    </div>
                  </fieldset>

                  <fieldset><legend>ข้อมูลลูกค้า</legend>
                    <div className="grid2">
                      <TextField label="ชื่อลูกค้า" value={current.customerName} onChange={v => update(current.id, 'customerName', v)} locked={locked} error={err('customerName')} unsure={unsure('customerName')} />
                      <TextField label="เบอร์โทร" inputMode="tel" maxLength={10} value={current.phone} onChange={v => update(current.id, 'phone', v.replace(/\D/g, ''))} locked={locked} error={err('phone')} unsure={unsure('phone')} />
                    </div>
                  </fieldset>

                  <fieldset><legend>ที่อยู่จัดส่ง</legend>
                    <div className="grid2">
                      <TextField label="ที่อยู่ (บ้านเลขที่ / ซอย / ถนน)" className="wide" value={current.address} onChange={v => update(current.id, 'address', v)} locked={locked} error={err('address')} unsure={unsure('address')} />
                      <TextField label="แขวง / ตำบล" value={current.subDistrict} onChange={v => update(current.id, 'subDistrict', v)} locked={locked} error={err('subDistrict')} unsure={unsure('subDistrict')} />
                      <TextField label="เขต / อำเภอ" value={current.district} onChange={v => update(current.id, 'district', v)} locked={locked} error={err('district')} unsure={unsure('district')} />
                      <TextField label="จังหวัด" value={current.province} onChange={v => update(current.id, 'province', v)} locked={locked} error={err('province')} unsure={unsure('province')} />
                      <TextField label="รหัสไปรษณีย์" inputMode="numeric" maxLength={5} value={current.postcode} onChange={v => update(current.id, 'postcode', v.replace(/\D/g, ''))} locked={locked} error={err('postcode')} unsure={unsure('postcode')} />
                      <ThaiDateField key={`${current.id}-sd`} label="วันที่ต้องการจัดส่งพิเศษ" optional value={current.shipDate} onChange={v => update(current.id, 'shipDate', v)} locked={locked} error={err('shipDate')} />
                    </div>
                  </fieldset>

                  <fieldset><legend>รายการสินค้า</legend>
                    {unsure('items') && <p className="unsure items-unsure"><TriangleAlert size={14} aria-hidden="true" />OCR ไม่แน่ใจ ตรวจสินค้า ขนาด และสีที่ติ๊กกับรูป</p>}
                    {current.items.length === 0 && <p className="hint">ยังไม่มีรายการสินค้า</p>}
                    {current.items.map((it, i) => <div className="item-row" key={i}>
                      <input aria-label={`สินค้า ${i + 1}`} placeholder="สินค้า" value={it.product} readOnly={locked} onChange={e => setItem(i, 'product', e.target.value)} />
                      <input aria-label={`ขนาด ${i + 1}`} placeholder="ขนาด" value={it.size} readOnly={locked} onChange={e => setItem(i, 'size', e.target.value)} />
                      <input aria-label={`สี ${i + 1}`} placeholder="สี" value={it.color} readOnly={locked} onChange={e => setItem(i, 'color', e.target.value)} />
                      <button type="button" className="icon-btn danger" aria-label={`ลบรายการ ${i + 1}`} disabled={locked} onClick={() => update(current.id, 'items', current.items.filter((_, j) => j !== i))}><Trash2 size={18} /></button>
                    </div>)}
                    <button type="button" className="btn outline add" disabled={locked} onClick={() => update(current.id, 'items', [...current.items, emptyItem()])}><Plus size={18} aria-hidden="true" />เพิ่มรายการสินค้า</button>
                  </fieldset>

                  <fieldset><legend>หมายเหตุ</legend>
                    <TextField label="หมายเหตุ (ถ้ามี)" value={current.remark} onChange={v => update(current.id, 'remark', v)} locked={locked} />
                  </fieldset>
                </form>
              </div>
            </div>

            <div className="action-bar">
              <div className="ab-status" role="status">
                {save.state === 'conflict' ? <span className="save err"><TriangleAlert size={16} aria-hidden="true" />{save.message} <button className="link-btn" onClick={reload}>โหลดใหม่</button></span>
                  : save.state === 'error' ? <span className="save err"><TriangleAlert size={16} aria-hidden="true" />บันทึกไม่สำเร็จ: {save.message} <button className="link-btn" onClick={() => flush(current.id)}>ลองใหม่</button></span>
                    : locked ? <span className="save ok"><Check size={16} aria-hidden="true" />{current.status === 'rejected' ? 'ปฏิเสธแล้ว' : 'ข้อมูลถูกล็อกแล้ว'}</span>
                      : showErrors && errorCount ? <span className="save err"><TriangleAlert size={16} aria-hidden="true" />ต้องแก้อีก {errorCount} จุดก่อนยืนยัน</span>
                        : save.state === 'saving' ? <span className="save">กำลังบันทึก…</span>
                          : save.state === 'dirty' ? <span className="save">มีการแก้ไข กำลังจะบันทึกอัตโนมัติ…</span>
                            : <span className="save ok"><Check size={16} aria-hidden="true" />บันทึกอัตโนมัติแล้ว</span>}
              </div>
              <div className="ab-buttons">
                {isPending(current.status) && <>
                  <button className="btn outline" disabled={busy} onClick={() => setDialog({ type: 'reject' })}>ปฏิเสธใบนี้</button>
                  <button className="btn primary big" disabled={busy} onClick={requestConfirm}><Send size={18} aria-hidden="true" />ยืนยันข้อมูลถูกต้อง</button>
                </>}
                {current.status === 'confirmed' && <>
                  <button className="btn outline" disabled={busy} onClick={() => act('reopen')}>ย้อนกลับไปแก้ไข</button>
                  <button className="btn primary big" disabled={busy} onClick={() => act('jst-done')}><Check size={18} aria-hidden="true" />ทำเครื่องหมายว่าลง JST แล้ว</button>
                </>}
              </div>
            </div>
          </>}
        </section>
      </div>
    </div>

    {toast && <div className="toast" role="status"><Check size={18} aria-hidden="true" />{toast}<button aria-label="ปิดข้อความ" onClick={() => setToast('')}><X size={16} /></button></div>}

    {dialog && <dialog ref={dialogRef} className={`modal modal-${dialog.type}`} onCancel={() => setDialog(null)} onClick={e => { if (e.target === dialogRef.current) setDialog(null); }} aria-labelledby="modal-title">
      <div className="modal-header"><h2 id="modal-title">{{ image: `รูปต้นฉบับ · ${current?.code}`, ocr: 'ข้อความ OCR ดิบ', confirm: 'ยืนยันข้อมูลถูกต้อง', upload: 'อัปโหลดใบสั่งซื้อ', reject: 'ปฏิเสธใบนี้', delete: 'ลบใบนี้?', help: 'วิธีใช้งาน', line: 'กลุ่ม LINE ที่บอทอยู่', settings: 'ตั้งค่าตัวอ่าน OCR' }[dialog.type]}</h2><button className="icon-btn" aria-label="ปิด" onClick={() => setDialog(null)}><X size={20} /></button></div>
      {dialog.type === 'upload' && <UploadForm branches={branches} defaultBranch={branch === 'all' ? branches[0] : branch} ocr={auth.ocr} onDone={onUploaded} />}
      {dialog.type === 'line' && <LineGroups onBranchesChange={b => setAuth(a => ({ ...a, branches: b }))} onAuthError={handleAuthError} />}
      {dialog.type === 'settings' && <OcrSettings ocr={auth.ocr} onSaved={ocr => setAuth(a => ({ ...a, ocr }))} onAuthError={handleAuthError} />}
      {dialog.type === 'reject' && <RejectForm onSubmit={reason => act('reject', { reason })} />}
      {dialog.type === 'delete' && (() => { const d = orders.find(x => x.id === dialog.id); return d ? <>
        <p className="modal-desc">ใช้เมื่อระบบดึงใบมาผิดหรืออัปโหลดผิดรูป ใบและรูปจะถูกลบ แต่ประวัติการกระทำยังอยู่</p>
        <dl className="confirm">
          <div><dt>ใบสั่งซื้อ</dt><dd>{d.billNumber || 'ยังไม่มีเลขที่บิล'} ({d.code})</dd></div>
          <div><dt>ลูกค้า</dt><dd>{d.customerName || 'ยังไม่มีชื่อลูกค้า'}</dd></div>
          <div><dt>ยอดรวม</dt><dd className="confirm-total">{d.total ? `฿${money(d.total)}` : '—'}</dd></div>
        </dl>
        <div className="banner warn"><TriangleAlert size={18} aria-hidden="true" />ลบแล้วกู้คืนไม่ได้ ถ้าเป็นใบจริงแต่ไม่ถูกต้อง ให้ใช้ "ปฏิเสธใบนี้" แทน</div>
        <div className="modal-actions"><button className="btn outline" onClick={() => setDialog(null)}>ยกเลิก</button><button className="btn danger" disabled={busy} onClick={removeOrder}><Trash2 size={18} aria-hidden="true" />ลบใบนี้</button></div>
      </> : <p className="modal-desc">ไม่พบใบนี้แล้ว</p>; })()}
      {dialog.type === 'image' && current && <ImageViewer src={current.imageUrl} alt={`ภาพใบสั่งซื้อ ${current.code}`} />}
      {dialog.type === 'ocr' && current && <><p className="modal-desc">ข้อความที่ OCR อ่านได้ก่อนแก้ไข แยกจากฟอร์มที่คุณกำลังตรวจ (มีข้อมูลลูกค้า)</p><pre>{current.ocrRaw}</pre></>}
      {dialog.type === 'confirm' && current && <>
        <p className="modal-desc">ตรวจข้อมูลครั้งสุดท้าย เมื่อยืนยันแล้วข้อมูลจะถูกล็อก และใบนี้จะรอลงใน JST เพื่อส่งของให้ลูกค้า</p>
        <dl className="confirm">
          <div><dt>ใบสั่งซื้อ</dt><dd>{current.billNumber} ({current.code})</dd></div>
          <div><dt>วันที่สั่งซื้อ</dt><dd>{thaiDate(current.orderDate)}</dd></div>
          <div><dt>ลูกค้า</dt><dd>{current.customerName}</dd></div>
          <div><dt>เบอร์โทร</dt><dd>{current.phone}</dd></div>
          <div><dt>ที่อยู่จัดส่ง</dt><dd>{[current.address, current.subDistrict, current.district, current.province, current.postcode].join(' ')}</dd></div>
          <div><dt>สินค้า</dt><dd>{current.items.length} รายการ</dd></div>
          <div><dt>ยอดรวม</dt><dd className="confirm-total">฿{money(current.total)}</dd></div>
        </dl>
        {warn.length > 0 && <div className="banner warn"><TriangleAlert size={18} aria-hidden="true" />ยอดไม่ตรงกับใบเสร็จ ต่างกัน ฿{money(Math.abs(warn[0].diff))}</div>}
        <div className="modal-actions"><button className="btn outline" onClick={() => setDialog(null)}>กลับไปตรวจ</button><button className="btn primary" disabled={busy} onClick={() => act('confirm')}><Send size={18} aria-hidden="true" />ยืนยัน</button></div>
      </>}
      {dialog.type === 'help' && <><p className="modal-desc">ตรวจใบสั่งซื้อที่ Sales ส่งมา แล้วยืนยันข้อมูลเพื่อลงใน JST</p>
        <ol className="help-list"><li>กด "อัปโหลดใบสั่งซื้อ" เลือกรูปและสาขา ระบบจะอ่านข้อมูลให้</li><li>เทียบรูปทางซ้ายกับฟอร์มทางขวา แก้ช่องที่ผิด (ช่องสีเหลืองคือที่ OCR ไม่แน่ใจ)</li><li>ระบบบันทึกให้อัตโนมัติ ไม่ต้องกดบันทึก</li><li>กด "ยืนยันข้อมูลถูกต้อง" เมื่อครบถ้วน ข้อมูลจะถูกล็อก แล้วไปที่แท็บ "รอลง JST"</li><li>ลงข้อมูลใน JST แล้วกด "ทำเครื่องหมายว่าลง JST แล้ว"</li><li>ใบที่ไม่ใช่ใบสั่งซื้อหรือซ้ำ ให้กด "ปฏิเสธใบนี้" พร้อมเหตุผล</li></ol>
        <div className="notice">ใบสั่งซื้อมีข้อมูลส่วนบุคคลของลูกค้า ใช้เฉพาะในงานนี้ และออกจากระบบทุกครั้งเมื่อใช้เครื่องร่วมกัน</div></>}
    </dialog>}
  </div>;
}
