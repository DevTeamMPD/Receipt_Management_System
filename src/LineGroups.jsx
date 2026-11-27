import React, { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { RefreshCw, Search, TriangleAlert, X } from 'lucide-react';
import { api, ApiError } from './api.js';
import { formatReceived } from './data.js';

const clean = v => String(v || '').replace(/\s+/g, ' ').trim();

// ช่องเลือกสาขาของกลุ่ม: พิมพ์เพื่อค้นจากสาขาทั้งหมด (datalist) · ชื่อที่ยังไม่มี = เพิ่มสาขาใหม่แล้วผูก
function BranchPicker({ group, branches, listId, busy, onSave }) {
  const [draft, setDraft] = useState(group.branch || ''); // key={group.branch} ที่ผู้เรียก: ผูกใหม่แล้วค่าเริ่มต้นตาม
  const value = clean(draft);
  const changed = value !== (group.branch || '');
  const isNew = !!value && !branches.includes(value);
  const save = () => { if (value && changed && !busy) onSave(value, isNew); };
  return <div className="lg-picker">
    <input
      list={listId} value={draft} disabled={busy} maxLength={60}
      aria-label={`สาขาของกลุ่ม ${group.name || 'ไม่ทราบชื่อ'}`} placeholder="พิมพ์เพื่อค้นหาสาขา…"
      onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save(); } }}
    />
    <button className="btn primary" disabled={!value || !changed || busy} onClick={save}>{isNew ? 'เพิ่มสาขานี้และผูก' : 'ผูก'}</button>
    {group.branch && <button className="btn outline" disabled={busy} onClick={() => onSave(null, false)}>เลิกผูก</button>}
  </div>;
}

// เพิ่ม/ซ่อนสาขา (ผู้ดูแล) — วางรายชื่อทีเดียวหลายสาขา แล้วระบบผูกกลุ่มจากชื่อให้อัตโนมัติ
function BranchManager({ branches, onChanged, onAuthError }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const fail = e => { if (!(e instanceof ApiError && e.status === 401 && onAuthError(e))) setMsg({ ok: false, text: e.message }); };
  async function add() {
    const names = text.split(/\r?\n|,/).map(clean).filter(Boolean);
    if (!names.length) return;
    setBusy(true); setMsg(null);
    try {
      const r = await api.addBranches(names);
      setText('');
      const parts = [r.added.length ? `เพิ่ม ${r.added.length} สาขา` : 'ไม่มีสาขาใหม่ (มีอยู่แล้วทั้งหมด)'];
      if (r.autoMapped.length) parts.push(`ผูกกลุ่มจากชื่อกลุ่มให้ ${r.autoMapped.length} กลุ่ม`);
      if (r.queued) parts.push(`กำลังดึงรูปที่รออยู่ ${r.queued} รูป`);
      setMsg({ ok: true, text: parts.join(' · ') });
      onChanged(r.branches, true);
    } catch (e) { fail(e); } finally { setBusy(false); }
  }
  async function hide(name) {
    setBusy(true); setMsg(null);
    try { const r = await api.setBranchActive(name, false); onChanged(r.branches, false); setMsg({ ok: true, text: `ซ่อนสาขา${name}แล้ว (ใบเก่าและกลุ่มที่ผูกไว้ไม่เปลี่ยน · เพิ่มชื่อเดิมอีกครั้งเพื่อแสดงกลับ)` }); } catch (e) { fail(e); } finally { setBusy(false); }
  }
  return <details className="lg-manage">
    <summary>สาขาทั้งหมด {branches.length} สาขา · เพิ่ม/ซ่อนสาขา</summary>
    <label className="lg-add">
      <span>เพิ่มสาขา — วางรายชื่อ บรรทัดละ 1 สาขา (ชื่อกลุ่มที่มีชื่อสาขาอยู่จะถูกผูกให้อัตโนมัติ)</span>
      <textarea rows={4} value={text} disabled={busy} onChange={e => setText(e.target.value)} placeholder={'เช่น\nเซ็นทรัล พระราม 2\nเมกา บางนา'} />
    </label>
    <div className="lg-add-row"><button className="btn primary" disabled={busy || !clean(text)} onClick={add}>เพิ่มสาขา</button></div>
    {msg && <p className={msg.ok ? 'lg-note' : 'lg-note bad'} role="status">{msg.text}</p>}
    <ul className="lg-chips" aria-label="สาขาที่ใช้อยู่">
      {branches.map(b => <li key={b}>{b}<button aria-label={`ซ่อนสาขา ${b}`} title="ซ่อนจากตัวเลือก" disabled={busy} onClick={() => hide(b)}><X size={14} /></button></li>)}
    </ul>
  </details>;
}

// กลุ่ม LINE ที่บอทอยู่ + สาขาที่ผูกไว้ (LINE OA Manager ไม่มีหน้าแสดงรายการนี้ ระบบจดไว้เอง)
export default function LineGroups({ onBranchesChange, onAuthError }) {
  const listId = useId();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState('');
  const [note, setNote] = useState(null);
  const [query, setQuery] = useState('');
  const [onlyOpen, setOnlyOpen] = useState(false);

  const isAuth = useCallback(e => e instanceof ApiError && e.status === 401 && onAuthError(e), [onAuthError]);
  const load = useCallback(async () => {
    setError('');
    try { setData(await api.lineGroups()); } catch (e) { if (!isAuth(e)) setError(e.message); }
  }, [isAuth]);
  useEffect(() => { load(); }, [load]);

  const branchesChanged = useCallback((branches, reload) => {
    setData(d => ({ ...d, branches }));
    onBranchesChange(branches);
    if (reload) load();
  }, [onBranchesChange, load]);

  async function setBranch(g, branch, create) {
    setSaving(g.id); setNote(null);
    try {
      const r = await api.setLineGroupBranch(g.id, branch, create);
      setData(d => ({ ...d, groups: d.groups.map(x => (x.id === r.group.id ? r.group : x)), branches: r.branches }));
      if (r.created) onBranchesChange(r.branches);
      setNote({ id: g.id, ok: true, text: branch ? `${r.created ? `เพิ่มสาขา${branch} และ` : ''}ผูกกับสาขา${branch}แล้ว${r.queued ? ` · กำลังดึงรูปที่รออยู่ ${r.queued} รูป (กดรีเฟรชเพื่อดูความคืบหน้า)` : ''}` : 'เลิกผูกสาขาแล้ว รูปใหม่จากกลุ่มนี้จะรอจนกว่าจะผูกอีกครั้ง' });
    } catch (e) {
      if (!isAuth(e)) setNote({ id: g.id, ok: false, text: e.message });
    } finally { setSaving(''); }
  }

  const shown = useMemo(() => {
    if (!data) return [];
    const q = clean(query).toLowerCase();
    return data.groups.filter(g => (!onlyOpen || (g.active && !g.branch)) && (!q || `${g.name} ${g.branch || ''}`.toLowerCase().includes(q)));
  }, [data, query, onlyOpen]);

  if (error) return <div className="banner bad" role="alert"><TriangleAlert size={18} aria-hidden="true" />{error}</div>;
  if (!data) return <p className="modal-desc" role="status">กำลังโหลด…</p>;
  const openCount = data.groups.filter(g => g.active && !g.branch).length;

  return <div className="line-groups">
    <div className="lg-head">
      <p className="modal-desc">บอทจะขึ้นในรายการเมื่อถูกเชิญเข้ากลุ่ม หรือเมื่อมีคนส่งรูปในกลุ่ม · ตัวเลขนับ {data.statsDays} วันล่าสุด</p>
      <button className="icon-btn" aria-label="รีเฟรชรายการกลุ่ม" title="รีเฟรช" onClick={load}><RefreshCw size={18} /></button>
    </div>
    {!data.lineConfigured && <div className="banner warn"><TriangleAlert size={18} aria-hidden="true" />ยังไม่ได้ตั้งค่า LINE ในเซิร์ฟเวอร์ ระบบจึงยังไม่รับรูปจากกลุ่ม</div>}
    {data.canEdit && <BranchManager branches={data.branches} onChanged={branchesChanged} onAuthError={isAuth} />}
    <datalist id={listId}>{data.branches.map(b => <option key={b} value={b} />)}</datalist>

    {data.groups.length > 0 && <div className="lg-tools">
      <label className="search"><Search size={18} aria-hidden="true" /><input aria-label="ค้นหากลุ่มหรือสาขา" placeholder="ค้นหาชื่อกลุ่มหรือสาขา" value={query} onChange={e => setQuery(e.target.value)} />
        {query && <button className="icon-btn" aria-label="ล้างคำค้น" onClick={() => setQuery('')}><X size={16} /></button>}</label>
      <div className="lg-filter" role="group" aria-label="กรองกลุ่ม">
        <button className={onlyOpen ? 'chip' : 'chip on'} aria-pressed={!onlyOpen} onClick={() => setOnlyOpen(false)}>ทั้งหมด {data.groups.length}</button>
        <button className={onlyOpen ? 'chip on' : 'chip'} aria-pressed={onlyOpen} onClick={() => setOnlyOpen(true)}>ยังไม่ผูกสาขา {openCount}</button>
      </div>
    </div>}

    {!data.groups.length && <p className="lg-empty">ยังไม่มีกลุ่ม — เชิญ LINE OA เข้ากลุ่มของสาขา แล้วส่งรูปสักรูปหรือกดรีเฟรช</p>}
    {data.groups.length > 0 && !shown.length && <p className="lg-empty">ไม่พบกลุ่มที่ตรงกับที่ค้นหา</p>}
    <ul className="lg-list">
      {shown.map(g => {
        const s = g.stats;
        const state = !g.active ? ['off', 'บอทออกจากกลุ่มแล้ว'] : g.branch ? ['on', 'กำลังรับรูป'] : ['wait', 'ยังไม่ผูกสาขา'];
        return <li key={g.id} className="lg-item">
          <div className="lg-top">
            <strong>{g.name || 'ไม่ทราบชื่อกลุ่ม'}</strong>
            <span className={`lg-state ${state[0]}`}>{state[1]}</span>
          </div>
          <div className="lg-branch">
            <span>สาขา</span>
            {data.canEdit
              ? <BranchPicker key={g.branch || ''} group={g} branches={data.branches} listId={listId} busy={saving === g.id} onSave={(b, create) => setBranch(g, b, create)} />
              : <b>{g.branch || 'ยังไม่ผูกสาขา'}</b>}
          </div>
          <p className="lg-stats">
            <span>ได้ใบ {s.orders}</span><span>ไม่ใช่ใบสั่งซื้อ {s.ignored}</span>
            {s.waiting > 0 && <span className="warn">รอผูกสาขา {s.waiting} รูป</span>}
            {s.working > 0 && <span>กำลังอ่าน {s.working}</span>}
            {s.failed > 0 && <span className="bad">ดึงไม่ได้ {s.failed}</span>}
            <span>รูปล่าสุด {g.lastPhotoAt ? `${formatReceived(g.lastPhotoAt)} น.` : '—'}</span>
          </p>
          {note?.id === g.id && <p className={note.ok ? 'lg-note' : 'lg-note bad'} role="status">{note.text}</p>}
        </li>;
      })}
    </ul>
    {!data.canEdit && <p className="lg-foot">ผูกกลุ่มกับสาขาและเพิ่มสาขาได้เฉพาะผู้ดูแล (admin)</p>}
    <div className="notice">
      รูปที่ส่ง<b>ก่อนเชิญบอทเข้ากลุ่ม</b> ดึงย้อนหลังไม่ได้ (LINE ไม่ส่งประวัติแชทให้บอท) · รูปที่ส่งตอนกลุ่ม<b>ยังไม่ผูกสาขา</b> ระบบจำไว้ ผูกสาขาแล้วจะดึงให้ ถ้า LINE ยังเก็บไฟล์อยู่ (ควรผูกภายในวันเดียวกัน)
    </div>
  </div>;
}
