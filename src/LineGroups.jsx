import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import { api, ApiError } from './api.js';
import { formatReceived } from './data.js';

// กลุ่ม LINE ที่บอทอยู่ + สาขาที่ผูกไว้ (LINE OA Manager ไม่มีหน้าแสดงรายการนี้ ระบบจดไว้เอง)
export default function LineGroups({ branches, onAuthError }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState('');
  const [note, setNote] = useState(null);

  const load = useCallback(async () => {
    setError('');
    try { setData(await api.lineGroups()); } catch (e) { if (!(e instanceof ApiError && e.status === 401 && onAuthError(e))) setError(e.message); }
  }, [onAuthError]);
  useEffect(() => { load(); }, [load]);

  async function setBranch(g, value) {
    const branch = value || null;
    setSaving(g.id); setNote(null);
    try {
      const { group, queued } = await api.setLineGroupBranch(g.id, branch);
      setData(d => ({ ...d, groups: d.groups.map(x => (x.id === group.id ? group : x)) }));
      setNote({ id: g.id, ok: true, text: branch ? `ผูกกับสาขา${branch}แล้ว${queued ? ` · กำลังดึงรูปที่รออยู่ ${queued} รูป (ใช้เวลาสักครู่ กดรีเฟรชเพื่อดูความคืบหน้า)` : ''}` : 'เลิกผูกสาขาแล้ว รูปใหม่จากกลุ่มนี้จะรอจนกว่าจะผูกอีกครั้ง' });
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401 && onAuthError(e))) setNote({ id: g.id, ok: false, text: e.message });
    } finally { setSaving(''); }
  }

  if (error) return <div className="banner bad" role="alert"><TriangleAlert size={18} aria-hidden="true" />{error}</div>;
  if (!data) return <p className="modal-desc" role="status">กำลังโหลด…</p>;

  return <div className="line-groups">
    <div className="lg-head">
      <p className="modal-desc">บอทจะขึ้นในรายการเมื่อถูกเชิญเข้ากลุ่ม หรือเมื่อมีคนส่งรูปในกลุ่ม · ตัวเลขนับ {data.statsDays} วันล่าสุด</p>
      <button className="icon-btn" aria-label="รีเฟรชรายการกลุ่ม" title="รีเฟรช" onClick={load}><RefreshCw size={18} /></button>
    </div>
    {!data.lineConfigured && <div className="banner warn"><TriangleAlert size={18} aria-hidden="true" />ยังไม่ได้ตั้งค่า LINE ในเซิร์ฟเวอร์ ระบบจึงยังไม่รับรูปจากกลุ่ม</div>}
    {!data.groups.length && <p className="lg-empty">ยังไม่มีกลุ่ม — เชิญ LINE OA เข้ากลุ่มของสาขา แล้วส่งรูปสักรูปหรือกดรีเฟรช</p>}
    <ul className="lg-list">
      {data.groups.map(g => {
        const s = g.stats;
        const state = !g.active ? ['off', 'บอทออกจากกลุ่มแล้ว'] : g.branch ? ['on', 'กำลังรับรูป'] : ['wait', 'ยังไม่ผูกสาขา'];
        return <li key={g.id} className="lg-item">
          <div className="lg-top">
            <strong>{g.name || 'ไม่ทราบชื่อกลุ่ม'}</strong>
            <span className={`lg-state ${state[0]}`}>{state[1]}</span>
          </div>
          <label className="lg-branch">
            <span>สาขา</span>
            {data.canEdit
              ? <select aria-label={`สาขาของกลุ่ม ${g.name}`} value={g.branch || ''} disabled={saving === g.id} onChange={e => setBranch(g, e.target.value)}>
                  <option value="">— ยังไม่ผูกสาขา —</option>
                  {branches.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              : <b>{g.branch || 'ยังไม่ผูกสาขา'}</b>}
          </label>
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
    {!data.canEdit && <p className="lg-foot">ผูกกลุ่มกับสาขาได้เฉพาะผู้ดูแล (admin)</p>}
    <div className="notice">
      รูปที่ส่ง<b>ก่อนเชิญบอทเข้ากลุ่ม</b> ดึงย้อนหลังไม่ได้ (LINE ไม่ส่งประวัติแชทให้บอท) · รูปที่ส่งตอนกลุ่ม<b>ยังไม่ผูกสาขา</b> ระบบจำไว้ ผูกสาขาแล้วจะดึงให้ ถ้า LINE ยังเก็บไฟล์อยู่ (ควรผูกภายในวันเดียวกัน)
    </div>
  </div>;
}
