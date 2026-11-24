import React, { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CircleHelp, FileText, Maximize2, MessageCircle, Plus, Search, Send, TriangleAlert, Trash2, X } from 'lucide-react';
import { STORAGE_KEY, branches, statusLabels, seeds, original, money, monthNames, thaiDate, ocrRawText, restore } from './data.js';
import { validate, warnings, fieldOrder } from './validation.js';
import { formImage } from './formImage.js';

const emptyItem = () => ({ product: '', size: '', color: '' });

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
  return <span className={`badge badge-${status}`}>{status === 'queued' ? <Check size={14} aria-hidden="true" /> : status === 'check' ? <TriangleAlert size={14} aria-hidden="true" /> : <span className="dot" aria-hidden="true" />}{statusLabels[status]}</span>;
}

export default function App() {
  const [receipts, setReceipts] = useState(restore);
  const [selectedId, setSelectedId] = useState(null);
  const [tab, setTab] = useState('todo');
  const [query, setQuery] = useState('');
  const [branch, setBranch] = useState('all');
  const [shown, setShown] = useState(() => new Set());
  const [toast, setToast] = useState('');
  const [dialog, setDialog] = useState(null);
  const [saveError, setSaveError] = useState(false);
  const [newId, setNewId] = useState(null);
  const [mobileView, setMobileView] = useState('list');
  const dialogRef = useRef(null);
  const lastFocus = useRef(null);
  const formRef = useRef(null);

  // บันทึกอัตโนมัติทุกครั้งที่ข้อมูลเปลี่ยน
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(receipts)); setSaveError(false); } catch { setSaveError(true); }
  }, [receipts]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 5000); return () => clearTimeout(t); }, [toast]);
  useEffect(() => {
    if (!dialog) return;
    lastFocus.current = document.activeElement;
    dialogRef.current?.showModal();
    return () => lastFocus.current?.focus();
  }, [dialog]);

  const todoCount = receipts.filter(r => r.status !== 'queued').length;
  const queuedCount = receipts.length - todoCount;
  const visible = receipts.filter(r => (branch === 'all' || r.branch === branch)
    && (tab === 'all' || (tab === 'todo' ? r.status !== 'queued' : r.status === 'queued'))
    && `${r.id} ${r.billNumber} ${r.customerName} ${r.phone} ${r.sender} ${r.branch}`.toLowerCase().includes(query.trim().toLowerCase()));
  const current = visible.find(r => r.id === selectedId) || visible[0] || null;
  const errors = current ? validate(current) : {};
  const showErrors = current ? shown.has(current.id) : false;
  const locked = current?.status === 'queued';

  function update(id, key, value) {
    setReceipts(rs => rs.map(r => r.id === id && r.status !== 'queued' ? { ...r, [key]: value } : r));
  }
  function select(id) { setSelectedId(id); setMobileView('detail'); }
  function focusFirstError(errs) {
    const first = fieldOrder.find(k => errs[k]);
    setTimeout(() => {
      const el = formRef.current?.querySelector('[aria-invalid="true"]');
      el?.focus();
      if (!el && first) formRef.current?.scrollIntoView();
    }, 30);
  }
  function requestSend() {
    if (!current || locked) return;
    const errs = validate(current);
    if (Object.keys(errs).length) {
      setShown(s => new Set(s).add(current.id));
      focusFirstError(errs);
      return;
    }
    setDialog({ type: 'confirm' });
  }
  function confirmSend() {
    const r = current;
    if (!r || Object.keys(validate(r)).length) { setDialog(null); return; }
    const idx = visible.findIndex(v => v.id === r.id);
    const next = visible.slice(idx + 1).find(v => v.status !== 'queued') || visible.slice(0, idx).reverse().find(v => v.status !== 'queued');
    setReceipts(rs => rs.map(x => x.id === r.id ? { ...x, status: 'queued' } : x));
    setDialog(null);
    if (next) setSelectedId(next.id);
    setToast(`${r.id} เข้าคิวจำลองแล้ว — ยังไม่ได้ส่งเข้า JST จริง${next ? ' · เปิดใบถัดไปให้แล้ว' : ''}`);
  }
  function goNext() {
    if (!current) return;
    const idx = visible.findIndex(v => v.id === current.id);
    const next = visible[idx + 1];
    if (next) setSelectedId(next.id);
  }
  function simulate() {
    const n = Math.max(...receipts.map(r => Number(r.id.split('-')[1]) || 0)) + 1;
    const pad = String(n).padStart(4, '0');
    const base = seeds[2];
    const row = {
      ...base, items: base.items.map(i => ({ ...i })), uncertain: [], id: `RCP-${pad}`, billNumber: `OD-DEMO-${pad}`,
      customerName: `ลูกค้าตัวอย่าง ${pad}`, phone: '0800000000',
      time: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }), status: 'review',
    };
    setReceipts(rs => [row, ...rs]);
    setNewId(row.id); setSelectedId(row.id); setQuery(''); setBranch('all'); setTab('todo'); setMobileView('detail');
    setToast('มีใบสั่งซื้อตัวอย่างเข้าใหม่ 1 รายการ แสดงบนสุดของรายการ');
  }
  const setItem = (i, key, value) => update(current.id, 'items', current.items.map((it, j) => j === i ? { ...it, [key]: value } : it));
  const err = k => (showErrors ? errors[k] : undefined);
  const unsure = k => !!current?.uncertain?.includes(k) && !locked;
  const warn = current ? warnings(current) : [];
  const errorCount = Object.keys(errors).length;
  const o = current ? original(current) : null;

  const tabs = [{ key: 'todo', label: 'รอตรวจ', count: todoCount }, { key: 'queued', label: 'ส่งต่อแล้ว', count: queuedCount }, { key: 'all', label: 'ทั้งหมด', count: receipts.length }];

  return <div className={`app view-${mobileView}`}>
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true"><FileText size={22} /></span>
        <div><strong>Receipt Desk</strong><span>ตรวจใบสั่งซื้อจาก LINE แล้วส่งต่อเข้า JST</span></div>
      </div>
      <div className="top-actions">
        <span className="chip">ข้อมูลตัวอย่าง</span>
        <button className="btn ghost" onClick={() => setDialog({ type: 'help' })}><CircleHelp size={18} aria-hidden="true" />วิธีใช้</button>
        <button className="btn primary" onClick={simulate}><Plus size={18} aria-hidden="true" />จำลองใบสั่งซื้อใหม่</button>
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
          <select aria-label="กรองสาขา" value={branch} onChange={e => setBranch(e.target.value)}>
            <option value="all">ทุกสาขา</option>
            {branches.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <ul className="order-list">
          {visible.map(r => {
            const bad = r.id !== current?.id && warnings(r).length > 0;
            return <li key={r.id}><button className={`order-item${r.id === current?.id ? ' active' : ''}${r.id === newId ? ' is-new' : ''}`} aria-current={r.id === current?.id ? 'true' : undefined} onClick={() => select(r.id)}>
              <span className="oi-top"><strong>{r.customerName}</strong><span className="oi-amount">฿{money(r.total)}</span></span>
              <span className="oi-meta">{r.id} · {r.billNumber}</span>
              <span className="oi-meta">Sales · {r.branch} · {r.time}</span>
              <span className="oi-bottom"><StatusBadge status={r.status} />{bad && <span className="mini-warn" title="ยอดไม่ตรงกับใบเสร็จ"><TriangleAlert size={14} aria-hidden="true" />ยอดไม่ตรง</span>}{r.id === newId && <span className="new-tag">ใหม่</span>}</span>
            </button></li>;
          })}
        </ul>
        {!visible.length && <div className="empty"><Search size={28} aria-hidden="true" /><h3>ไม่พบใบสั่งซื้อที่ค้นหา</h3><p>ลองเปลี่ยนคำค้นหรือเลือกสาขาอื่น</p><button className="btn outline" onClick={() => { setQuery(''); setBranch('all'); setTab('all'); }}>ล้างตัวกรอง</button></div>}
        <p className="list-foot">แสดง {visible.length} จาก {receipts.length} รายการ</p>
      </aside>

      <section className="detail-pane" aria-label="รายละเอียดใบสั่งซื้อ">
        {!current ? <div className="empty big"><FileText size={36} aria-hidden="true" /><h2>เลือกใบสั่งซื้อจากรายการด้านซ้าย</h2><p>ยังไม่มีรายการให้ตรวจ</p></div> : <>
          <div className="detail-head">
            <button className="btn ghost back" onClick={() => setMobileView('list')}><ArrowLeft size={18} aria-hidden="true" />กลับไปรายการ</button>
            <div className="dh-title">
              <h1>ใบสั่งซื้อ <span className="nowrap">{current.billNumber}</span></h1>
              <p><span>{current.id}</span><span><MessageCircle size={14} aria-hidden="true" /> LINE · Sales {current.branch}</span><span>ผู้ส่ง {current.sender}</span><span>{current.time} น.</span><span className={current.confidence < 80 ? 'ocr low' : 'ocr'}>OCR {current.confidence}% (ตัวอย่าง)</span></p>
            </div>
            <StatusBadge status={current.status} />
            <button className="btn outline dh-next" onClick={goNext} disabled={visible.indexOf(current) >= visible.length - 1}>ใบถัดไป<ArrowRight size={18} aria-hidden="true" /></button>
          </div>

          <div className="detail-scroll">
            <div className="detail-grid">
              <div className="photo-card">
                <button className="photo" aria-label={`ขยายรูปใบสั่งซื้อ ${current.id}`} onClick={() => setDialog({ type: 'image' })}>
                  <img src={formImage(o)} alt={`ใบสั่งซื้อตัวอย่าง ${current.id}`} />
                  <span className="zoom"><Maximize2 size={16} aria-hidden="true" />คลิกเพื่อขยาย</span>
                </button>
                <p className="photo-note">รูปต้นฉบับ: ใบสั่งซื้อ (ซ้าย) + ใบเสร็จ POS ที่แนบ (ขวา) — เอกสารสมมติ</p>
                <button className="btn outline" onClick={() => setDialog({ type: 'ocr' })}><FileText size={18} aria-hidden="true" />ดูข้อความ OCR ดิบ</button>
              </div>

              <form className="form" ref={formRef} onSubmit={e => e.preventDefault()} aria-label={`ข้อมูลใบสั่งซื้อ ${current.id}`}>
                {locked && <div className="banner info"><Check size={18} aria-hidden="true" />ใบนี้อยู่ในคิวจำลองแล้ว แก้ไขไม่ได้</div>}
                {warn.map(w => <div className="banner warn" key={w.key}><TriangleAlert size={18} aria-hidden="true" /><div><strong>ยอดไม่ตรงกับใบเสร็จ</strong><br />ใบสั่งซื้อ ฿{money(current.total)} · ใบเสร็จ ฿{money(current.posTotal)} · ต่างกัน ฿{money(Math.abs(w.diff))} (อาจเป็นส่วนลด) — ตรวจแล้วจึงส่งต่อได้</div></div>)}

                <fieldset><legend>ข้อมูลบิล</legend>
                  <div className="grid2">
                    <TextField label="เลขที่บิล" value={current.billNumber} onChange={v => update(current.id, 'billNumber', v)} locked={locked} error={err('billNumber')} />
                    <ThaiDateField key={`${current.id}-od`} label="วันที่สั่งซื้อ" value={current.orderDate} onChange={v => update(current.id, 'orderDate', v)} locked={locked} error={err('orderDate')} />
                    <TextField label="ยอดรวม (บาท)" inputMode="decimal" value={current.total} onChange={v => update(current.id, 'total', v.replace(/[^\d.]/g, ''))} locked={locked} error={err('total')} className="amount"
                      hint={Number(current.total) > 0 ? `= ฿${money(current.total)}` : undefined} />
                  </div>
                </fieldset>

                <fieldset><legend>ข้อมูลลูกค้า</legend>
                  <div className="grid2">
                    <TextField label="ชื่อลูกค้า" value={current.customerName} onChange={v => update(current.id, 'customerName', v)} locked={locked} error={err('customerName')} unsure={unsure('customerName')} />
                    <TextField label="เบอร์โทร" inputMode="tel" maxLength={12} value={current.phone} onChange={v => update(current.id, 'phone', v.replace(/[^\d\s-]/g, ''))} locked={locked} error={err('phone')} unsure={unsure('phone')} />
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
              {saveError ? <span className="save err"><TriangleAlert size={16} aria-hidden="true" />บันทึกไม่ได้ กรุณาอนุญาต local storage</span>
                : locked ? <span className="save ok"><Check size={16} aria-hidden="true" />ส่งเข้าคิวจำลองแล้ว</span>
                : showErrors && errorCount ? <span className="save err"><TriangleAlert size={16} aria-hidden="true" />ต้องแก้อีก {errorCount} จุดก่อนส่งต่อ</span>
                : <span className="save ok"><Check size={16} aria-hidden="true" />บันทึกอัตโนมัติแล้ว</span>}
              <span className="ab-note">ระบบทดลอง: เป็นการจัดคิวจำลอง ยังไม่ส่งเข้า JST จริง</span>
            </div>
            <button className="btn primary big" onClick={requestSend} disabled={locked}>{locked ? 'อยู่ในคิวแล้ว' : <><Send size={18} aria-hidden="true" />ยืนยันและส่งต่อเข้า JST</>}</button>
          </div>
        </>}
      </section>
    </div>

    {toast && <div className="toast" role="status"><Check size={18} aria-hidden="true" />{toast}<button aria-label="ปิดข้อความ" onClick={() => setToast('')}><X size={16} /></button></div>}

    {dialog && <dialog ref={dialogRef} className={`modal modal-${dialog.type}`} onCancel={() => setDialog(null)} onClick={e => { if (e.target === dialogRef.current) setDialog(null); }} aria-labelledby="modal-title">
      <div className="modal-header"><h2 id="modal-title">{dialog.type === 'image' ? `รูปต้นฉบับ · ${current.id}` : dialog.type === 'ocr' ? 'ข้อความ OCR ดิบ' : dialog.type === 'confirm' ? 'ยืนยันก่อนส่งต่อ' : 'วิธีใช้งาน'}</h2><button className="icon-btn" aria-label="ปิด" onClick={() => setDialog(null)}><X size={20} /></button></div>
      {dialog.type === 'image' && <div className="image-viewer"><img src={formImage(o)} alt="ภาพใบสั่งซื้อตัวอย่างขนาดใหญ่" /><p>เอกสารสมมติสำหรับออกแบบ UI ไม่ใช่ใบสั่งซื้อจริง</p></div>}
      {dialog.type === 'ocr' && <><p className="modal-desc">ข้อมูล OCR ตัวอย่างก่อนแก้ไข แยกจากฟอร์มที่คุณกำลังตรวจ</p><pre>{ocrRawText(o)}</pre></>}
      {dialog.type === 'confirm' && <>
        <p className="modal-desc">ตรวจข้อมูลครั้งสุดท้าย เพราะข้อมูลนี้ใช้เปิดบิลและส่งของให้ลูกค้า</p>
        <dl className="confirm">
          <div><dt>ใบสั่งซื้อ</dt><dd>{current.billNumber} ({current.id})</dd></div>
          <div><dt>วันที่สั่งซื้อ</dt><dd>{thaiDate(current.orderDate)}</dd></div>
          <div><dt>ลูกค้า</dt><dd>{current.customerName}</dd></div>
          <div><dt>เบอร์โทร</dt><dd>{current.phone}</dd></div>
          <div><dt>ที่อยู่จัดส่ง</dt><dd>{[current.address, current.subDistrict, current.district, current.province, current.postcode].join(' ')}</dd></div>
          <div><dt>สินค้า</dt><dd>{current.items.length} รายการ</dd></div>
          <div><dt>ยอดรวม</dt><dd className="confirm-total">฿{money(current.total)}</dd></div>
        </dl>
        {warn.length > 0 && <div className="banner warn"><TriangleAlert size={18} aria-hidden="true" />ยอดไม่ตรงกับใบเสร็จ ต่างกัน ฿{money(Math.abs(warn[0].diff))}</div>}
        <div className="notice">นี่เป็นต้นแบบ — ระบบจะเพียงจัดคิวจำลองในเบราว์เซอร์นี้ ยังไม่ส่งเข้า JST จริง</div>
        <div className="modal-actions"><button className="btn outline" onClick={() => setDialog(null)}>กลับไปตรวจ</button><button className="btn primary" onClick={confirmSend}><Send size={18} aria-hidden="true" />ยืนยันเข้าคิวจำลอง</button></div>
      </>}
      {dialog.type === 'help' && <><p className="modal-desc">ต้นแบบหน้าจอสำหรับตรวจใบสั่งซื้อที่ Sales ส่งมาทาง LINE</p>
        <ol className="help-list"><li>เลือกใบสั่งซื้อจากรายการด้านซ้าย</li><li>เทียบรูปทางซ้ายกับฟอร์มทางขวา แก้ช่องที่ผิด (ช่องสีเหลืองคือที่ OCR ไม่แน่ใจ)</li><li>ระบบบันทึกให้อัตโนมัติ ไม่ต้องกดบันทึก</li><li>กด "ยืนยันและส่งต่อเข้า JST" เมื่อข้อมูลถูกต้อง แล้วระบบจะเปิดใบถัดไปให้</li></ol>
        <div className="notice">ข้อมูลทั้งหมดเป็นข้อมูลสมมติ เก็บในเบราว์เซอร์นี้เท่านั้น ยังไม่เชื่อมต่อ LINE, OCR หรือ JST จริง ห้ามกรอกข้อมูลลูกค้าจริง</div></>}
    </dialog>}
  </div>;
}
