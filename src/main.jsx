import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowDown, ArrowRight, ArrowUpRight, Check, CheckCheck, ChevronDown, CircleHelp, FileText, Inbox, LayoutGrid, ListFilter, Maximize2, MessageCircle, Plus, ReceiptText, Save, Search, Send, ShieldCheck, Sparkles, X } from 'lucide-react';
import './styles.css';

const STORAGE_KEY = 'receipt-desk-demo-v1';
const seeds = [
  { id: 'RCP-0024', merchant: 'บริษัท ออฟฟิศเมท (ไทย) จำกัด', number: 'OM-20261123-0842', date: '2026-11-23', total: '1280.00', branch: 'สยาม', sender: 'พิมพ์ชนก', time: '10:42', status: 'review', confidence: 98, type: 'OFFICEMATE', items: ['A4 COPY PAPER    560.00', 'OFFICE SUPPLIES  720.00'], color: 'mint' },
  { id: 'RCP-0023', merchant: 'บริษัท บางจาก คอร์ปอเรชั่น จำกัด', number: 'BCP-0039182', date: '2026-11-23', total: '1500.00', branch: 'ลาดพร้าว', sender: 'ธนกร', time: '10:38', status: 'check', confidence: 76, type: 'bangchak', items: ['GASOHOL 95', '42.857 L x 35.00'], color: 'sand' },
  { id: 'RCP-0022', merchant: 'บริษัท ซีพี แอ็กซ์ตร้า จำกัด (มหาชน)', number: 'MK-261123-0591', date: '2026-11-23', total: '2456.50', branch: 'บางนา', sender: 'ณัฐวุฒิ', time: '10:31', status: 'review', confidence: 96, type: 'makro', items: ['DRINKING WATER   456.50', 'PANTRY SUPPLIES 2000.00'], color: 'rose' },
  { id: 'RCP-0021', merchant: 'บริษัท บีทูเอส จำกัด', number: 'B2S-091245', date: '2026-11-23', total: '389.00', branch: 'รังสิต', sender: 'ศิริพร', time: '10:24', status: 'queued', confidence: 99, type: 'B2S', items: ['NOTEBOOK A5      189.00', 'PEN SET          200.00'], color: 'blue' },
];
const branches = ['สยาม', 'ลาดพร้าว', 'บางนา', 'รังสิต'];
const labels = { review: 'รอตรวจสอบ', check: 'ต้องตรวจเพิ่ม', queued: 'อยู่ในคิวจำลอง' };
const money = n => Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const valid = r => r.merchant.trim() && r.number.trim() && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && Number.isFinite(Number(r.total)) && Number(r.total) > 0;
function restore() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (Array.isArray(data) && data.length && data.every(r => r && typeof r.id === 'string' && typeof r.merchant === 'string' && typeof r.number === 'string' && typeof r.date === 'string' && typeof r.total === 'string' && branches.includes(r.branch) && labels[r.status] && Array.isArray(r.items))) return data;
  } catch { /* Fall back to demo data if local storage is unavailable. */ }
  return seeds.map(r => ({ ...r }));
}
function receiptImage(r) {
  const escape = s => String(s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="340" height="440" viewBox="0 0 340 440"><rect width="340" height="440" fill="#fffefb"/><g font-family="monospace" text-anchor="middle" fill="#333"><text x="170" y="46" font-size="25" font-weight="bold">${escape(r.type)}</text><text x="170" y="72" font-size="10">SAMPLE RECEIPT / NOT A TAX INVOICE</text><text x="170" y="101" font-size="11">23/11/2026    ${escape(r.time)}</text><text x="170" y="126" font-size="11">${escape(r.number)}</text><path d="M25 144H315" stroke="#777" stroke-dasharray="4 4"/>${r.items.map((v,i)=>`<text x="170" y="${178+i*27}" font-size="13">${escape(v)}</text>`).join('')}<path d="M25 239H315" stroke="#777" stroke-dasharray="4 4"/><text x="170" y="272" font-size="21" font-weight="bold">TOTAL ${escape(money(r.total))}</text><text x="170" y="301" font-size="11">VAT INCLUDED · THB</text><text x="170" y="342" font-size="12">THANK YOU</text><text x="170" y="368" font-size="10">DEMO DOCUMENT</text></g><g fill="#333">${Array.from({length:47},(_,i)=>`<rect x="${55+i*5}" y="390" width="${i%3+1}" height="25"/>`).join('')}</g></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
const original = r => seeds.find(s => s.id === r.id) || seeds[0];

function App() {
  const [receipts, setReceipts] = useState(restore);
  const [query, setQuery] = useState('');
  const [branch, setBranch] = useState('all');
  const [tab, setTab] = useState('all');
  const [dirty, setDirty] = useState(new Set());
  const [toast, setToast] = useState('');
  const [dialog, setDialog] = useState(null);
  const [newId, setNewId] = useState(null);
  const [saved, setSaved] = useState(false);
  const dialogRef = useRef(null);
  const lastFocus = useRef(null);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 4500); return () => clearTimeout(t); }, [toast]);
  useEffect(() => {
    if (!dialog) return;
    lastFocus.current = document.activeElement;
    dialogRef.current?.showModal();
    return () => lastFocus.current?.focus();
  }, [dialog]);
  useEffect(() => {
    const handler = e => { if (dirty.size) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  function persist(next) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); return true; }
    catch { setToast('เบราว์เซอร์บันทึกข้อมูลไม่ได้ กรุณาอนุญาต local storage'); return false; }
  }
  function update(id, key, value) {
    setReceipts(rs => rs.map(r => r.id === id ? { ...r, [key]: value } : r));
    setDirty(d => new Set([...d, id])); setSaved(false);
  }
  function save() { if (persist(receipts)) { setDirty(new Set()); setSaved(true); setToast('บันทึกการแก้ไขไว้ในเบราว์เซอร์นี้แล้ว'); } }
  function queue(r) {
    if (!valid(r)) return;
    const next = receipts.map(item => item.id === r.id ? { ...item, status: 'queued' } : item);
    if (persist(next)) { setReceipts(next); setDirty(new Set()); setDialog(null); setToast(`${r.id} เพิ่มเข้าคิวจำลองแล้ว — ยังไม่ได้ส่งเข้า JST จริง`); }
  }
  function simulate() {
    const n = Math.max(...receipts.map(r => Number(r.id.split('-')[1]) || 0)) + 1;
    const row = { ...seeds[0], id: `RCP-${String(n).padStart(4,'0')}`, number: `DEMO-${String(n).padStart(4,'0')}`, time: new Date().toLocaleTimeString('th-TH', {hour:'2-digit',minute:'2-digit',timeZone:'Asia/Bangkok'}), status: 'review' };
    setReceipts(rs => [row, ...rs]); setDirty(d => new Set([...d, row.id])); setNewId(row.id);
    setQuery(''); setBranch('all'); setTab('all'); setSaved(false);
    setToast('มีใบเสร็จตัวอย่างเข้าใหม่ 1 รายการ แสดงที่แถวบนสุด');
  }
  const visible = receipts.filter(r => (branch === 'all' || r.branch === branch) && (tab === 'all' || (tab === 'review' ? r.status !== 'queued' : r.status === tab)) && `${r.id} ${r.merchant} ${r.number} ${r.sender} ${r.branch}`.toLowerCase().includes(query.toLowerCase()));
  const pending = receipts.filter(r => r.status !== 'queued').length;
  const queued = receipts.filter(r => r.status === 'queued').length;
  const checks = receipts.filter(r => r.status === 'check').length;

  return <div className="app-shell">
    <aside className="sidebar">
      <a href="#" className="brand" aria-label="Receipt Desk หน้าหลัก"><span className="brand-mark"><ReceiptText size={23}/></span><span>receipt<span className="brand-light">desk</span><small>SALES OPERATIONS</small></span></a>
      <div className="workspace"><span className="workspace-avatar">M</span><div>MPD Workspace<small>ระบบจัดการใบเสร็จ</small></div><span className="workspace-tag">DEMO</span></div>
      <div className="nav-label">WORKSPACE</div>
      <nav aria-label="เมนูหลัก">
        <button className={tab !== 'queued' ? 'nav-item active' : 'nav-item'} onClick={()=>setTab('all')}><Inbox size={19}/>กล่องใบเสร็จ<span className="nav-count">{pending}</span></button>
        <button className={tab === 'queued' ? 'nav-item active' : 'nav-item'} onClick={()=>setTab('queued')}><Send size={18}/>คิวงาน JST<span className="count-muted">{queued}</span></button>
      </nav>
      <div className="nav-label group-heading">กลุ่ม LINE <span>4</span></div>
      <div className="group-list">{branches.map((b,i)=><button key={b} className={branch===b?'group active-group':'group'} onClick={()=>{setBranch(branch===b?'all':b);setTab('all');}}><span className={`group-dot dot-${i}`}/><span>Sales · {b}</span><small>{receipts.filter(r=>r.branch===b).length}</small></button>)}</div>
      <div className="sidebar-bottom"><div className="demo-card"><span className="demo-icon"><Sparkles size={18}/></span><strong>พื้นที่ทดลองของคุณ</strong><p>ตรวจ แก้ไข และจัดคิวใบเสร็จ<br/>ได้โดยไม่กระทบข้อมูลจริง</p><button onClick={()=>setDialog({type:'help'})}>เกี่ยวกับเวอร์ชันนี้ <ArrowUpRight size={15}/></button></div><div className="profile"><span className="avatar">AD</span><div>ผู้ดูแลระบบ<small>Demo administrator</small></div><ShieldCheck size={18}/></div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb">Workspace <span>/</span> <strong>กล่องใบเสร็จ</strong></div><div className="topbar-right"><span className="demo-chip"><span/>ข้อมูลตัวอย่าง</span><button className="icon-button" aria-label="วิธีใช้งาน" onClick={()=>setDialog({type:'help'})}><CircleHelp size={19}/></button><span className="topbar-divider"/><span className="avatar small">AD</span></div></header>
      <main>
        <section className="page-heading"><div><div className="eyebrow">RECEIPT MANAGEMENT</div><h1>ทุกใบเสร็จ ในที่เดียว<span>.</span></h1><p>รับจาก LINE ตรวจข้อมูลให้ถูกต้อง แล้วส่งต่อเข้า JST</p></div><button className="button dark" onClick={simulate}><Plus size={17}/>จำลองใบเสร็จใหม่</button></section>
        <section className="stats" aria-label="สรุปใบเสร็จ">
          {[{name:'ใบเสร็จทั้งหมด',count:receipts.length,sub:'จาก 4 กลุ่ม LINE · ข้อมูลตัวอย่าง',icon:ReceiptText,color:'green'}, {name:'รอตรวจสอบ',count:pending,sub:'ตรวจข้อมูลก่อนส่งต่อ',icon:FileText,color:'orange'}, {name:'ต้องตรวจเพิ่ม',count:checks,sub:'OCR มีข้อมูลที่ไม่แน่ใจ',icon:Search,color:'yellow'}, {name:'คิว JST จำลอง',count:queued,sub:'ยังไม่เชื่อมต่อระบบจริง',icon:Send,color:'purple'}].map(s=><div className="stat-card" key={s.name}><div className="stat-top"><span>{s.name}</span><span className={`stat-icon ${s.color}`}><s.icon size={18}/></span></div><div className="stat-number">{String(s.count).padStart(2,'0')}<span>รายการ</span></div><div className="stat-sub">{s.sub}</div></div>)}
        </section>
        <section className="receipt-panel">
          <div className="panel-heading"><div><h2>กล่องใบเสร็จ <span>{receipts.length}</span></h2><p>รูปต้นฉบับและข้อมูล OCR แสดงคู่กัน ตรวจได้ในแต่ละแถว</p></div><div className="feed-label"><span/>แถวใหม่แสดงด้านบน</div></div>
          <div className="tabs-bar"><div className="tabs" role="tablist" aria-label="สถานะใบเสร็จ">{[{key:'all',label:'ทั้งหมด',count:receipts.length},{key:'review',label:'รอตรวจสอบ',count:pending},{key:'check',label:'ต้องตรวจเพิ่ม',count:checks},{key:'queued',label:'คิว JST',count:queued}].map(t=><button role="tab" aria-selected={tab===t.key} className={tab===t.key?'tab selected':'tab'} key={t.key} onClick={()=>setTab(t.key)}>{t.label}<span>{t.count}</span></button>)}</div><span className="view-mode"><LayoutGrid size={15}/>มุมมองตาราง</span></div>
          <div className="filter-bar"><label className="search-box"><Search size={17}/><input aria-label="ค้นหาใบเสร็จ" placeholder="ค้นหาร้านค้า เลขใบเสร็จ หรือชื่อผู้ส่ง..." value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<button className="icon-button" onClick={()=>setQuery('')} aria-label="ล้างคำค้น"><X size={14}/></button>}</label><label className="select-box"><ListFilter size={16}/><select aria-label="กรองสาขา" value={branch} onChange={e=>setBranch(e.target.value)}><option value="all">ทุกสาขา</option>{branches.map(b=><option key={b} value={b}>{b}</option>)}</select><ChevronDown size={14}/></label><span className="sort-label"><ArrowDown size={15}/>ล่าสุดก่อน</span></div>
          <div className="table-scroll"><table><colgroup><col className="col-source"/><col className="col-image"/><col className="col-data"/><col className="col-action"/></colgroup><thead><tr><th>รายการ / แหล่งที่มา</th><th>รูปใบเสร็จ <span>คลิกเพื่อขยาย</span></th><th><span className="th-title"><Sparkles size={13}/> ข้อมูลจาก OCR</span><span>แก้ไขได้ก่อนส่ง</span></th><th>สถานะ / ส่งต่อ</th></tr></thead><tbody>
          {visible.map(r=><tr key={r.id} className={`${r.id===newId?'new-row ':''}${r.status==='queued'?'queued-row':''}`}>
            <td><div className="receipt-id">{r.id}{r.id===newId&&<span className="new-badge">ใหม่</span>}</div><div className="received-date">23 พ.ย. 2569 <span>· {r.time}</span></div><div className="source-label"><MessageCircle size={13} fill="currentColor"/>LINE GROUP</div><div className="branch-name">Sales · {r.branch}</div><div className="sender"><span className={`sender-avatar ${r.color}`}>{r.sender.slice(0,1)}</span>{r.sender}</div><div className="file-label"><FileText size={12}/>1 รูปภาพ</div></td>
            <td><button className={`receipt-preview preview-${r.color}`} aria-label={`ขยายใบเสร็จ ${r.id}`} onClick={()=>setDialog({type:'image',receipt:r})}><img src={receiptImage(original(r))} alt={`ใบเสร็จตัวอย่าง ${original(r).type}`} loading="lazy"/><span className="expand-icon"><Maximize2 size={13}/></span><span className="sample-label">ตัวอย่าง</span></button></td>
            <td><div className="ocr-heading"><span className={`confidence ${r.confidence<80?'low':''}`}><Sparkles size={12}/>OCR {r.confidence}% <span>· ตัวอย่าง</span></span>{dirty.has(r.id)&&<span className="unsaved">ยังไม่บันทึก</span>}</div><div className="field-grid"><label className="field merchant-field">ร้านค้า / ผู้ขาย<input aria-label={`ร้านค้า ${r.id}`} value={r.merchant} readOnly={r.status==='queued'} onChange={e=>update(r.id,'merchant',e.target.value)}/></label><label className="field">เลขที่ใบเสร็จ<input aria-label={`เลขที่ใบเสร็จ ${r.id}`} value={r.number} readOnly={r.status==='queued'} onChange={e=>update(r.id,'number',e.target.value)}/></label><label className="field">วันที่เอกสาร<input aria-label={`วันที่เอกสาร ${r.id}`} type="date" value={r.date} readOnly={r.status==='queued'} onChange={e=>update(r.id,'date',e.target.value)}/></label><label className={`field amount-field ${r.status==='check'?'warning-field':''}`}>ยอดสุทธิ (บาท)<div className="amount-input"><span>฿</span><input aria-label={`ยอดสุทธิ ${r.id}`} type="number" min="0.01" step="0.01" value={r.total} readOnly={r.status==='queued'} onChange={e=>update(r.id,'total',e.target.value)}/></div></label><button className="raw-link" onClick={()=>setDialog({type:'ocr',receipt:r})}><FileText size={13}/>ดูข้อความ OCR ดิบ<ArrowUpRight size={12}/></button></div>{r.status==='check'&&<p className="field-note">โปรดตรวจยอดสุทธิกับรูปต้นฉบับอีกครั้ง</p>}{!valid(r)&&<p className="field-note" role="alert">กรุณากรอกข้อมูลให้ครบ และยอดสุทธิต้องมากกว่า 0</p>}</td>
            <td><div className={`status-badge status-${r.status}`}>{r.status==='queued'?<Check size={12}/>:<span/>}{labels[r.status]}</div><p className="action-description">{r.status==='queued'?'บันทึกเข้าคิวตัวอย่างแล้ว':'ตรวจข้อมูลด้านซ้ายให้ครบ\nก่อนยืนยันส่งรายการ'}</p><button className={`button send-button ${r.status==='queued'?'sent':''}`} disabled={r.status==='queued'||!valid(r)} onClick={()=>setDialog({type:'confirm',receipt:r})}>{r.status==='queued'?<CheckCheck size={15}/>:<Send size={14}/>} {r.status==='queued'?'อยู่ในคิวแล้ว':'ส่งเข้า JST'}{r.status!=='queued'&&<ArrowRight size={14}/>}</button><div className="action-footnote">{r.status==='queued'?'ไม่ได้ส่งเข้าระบบจริง':'โหมดทดลอง · ไม่ส่งจริง'}</div></td>
          </tr>)}
          </tbody></table>{!visible.length&&<div className="empty-state"><Search size={28}/><h3>ไม่พบใบเสร็จที่ค้นหา</h3><p>ลองเปลี่ยนคำค้นหรือเลือกสาขาอื่น</p><button className="button outline" onClick={()=>{setQuery('');setBranch('all');setTab('all');}}>ล้างตัวกรอง</button></div>}</div>
          <div className="table-footer"><span>แสดง {visible.length} จาก {receipts.length} รายการ</span><span><ShieldCheck size={14}/>ข้อมูลตัวอย่าง เก็บเฉพาะในเบราว์เซอร์นี้</span></div>
        </section>
        <footer className="page-footer"><span>RECEIPTDESK <span>·</span> ให้ทุกใบเสร็จไปต่อได้ง่ายขึ้น</span><span>UI PREVIEW / V.01</span></footer>
      </main>
      <div className="save-bar"><div><span className={dirty.size?'save-indicator dirty':'save-indicator'}/><strong>{dirty.size?`มี ${dirty.size} รายการที่ยังไม่บันทึก`:saved?'บันทึกฉบับร่างแล้ว':'พร้อมตรวจสอบใบเสร็จ'}</strong><span className="save-hint">ตรวจ แก้ไข แล้วส่งได้ทีละแถว</span></div><button className="button dark" disabled={!dirty.size} onClick={save}><Save size={15}/>บันทึกฉบับร่าง{dirty.size>0&&<span className="button-count">{dirty.size}</span>}</button></div>
    </div>
    {toast&&<div className="toast" role="status"><Check size={17}/>{toast}<button aria-label="ปิดข้อความ" onClick={()=>setToast('')}><X size={15}/></button></div>}
    {dialog&&<dialog ref={dialogRef} className={`modal modal-${dialog.type}`} onCancel={()=>setDialog(null)} onClick={e=>{if(e.target===dialogRef.current)setDialog(null);}} aria-labelledby="modal-title"><div className="modal-header"><h2 id="modal-title">{dialog.type==='image'?`รูปต้นฉบับ · ${dialog.receipt.id}`:dialog.type==='ocr'?'ข้อความ OCR ดิบ':dialog.type==='confirm'?'ยืนยันส่งเข้าคิว JST จำลอง':'รู้จัก Receipt Desk'}</h2><button className="icon-button" autoFocus aria-label="ปิดหน้าต่าง" onClick={()=>setDialog(null)}><X size={20}/></button></div>
      {dialog.type==='image'&&<div className="image-viewer"><img src={receiptImage(original(dialog.receipt))} alt="ภาพใบเสร็จตัวอย่างขนาดใหญ่"/><p>เอกสารตัวอย่างสำหรับออกแบบ UI ไม่ใช่ใบเสร็จจริง</p></div>}
      {dialog.type==='ocr'&&<><p className="modal-description">ข้อมูล OCR ตัวอย่างก่อนแก้ไข แยกจากฟอร์มที่คุณกำลังตรวจ</p><pre>{`${original(dialog.receipt).merchant}\nเลขที่ ${original(dialog.receipt).number}\nวันที่ 23/11/2026\n\n${original(dialog.receipt).items.join('\n')}\n\nยอดสุทธิ ${money(original(dialog.receipt).total)} บาท\nรวมภาษีมูลค่าเพิ่มแล้ว\n\n[ข้อความตัวอย่าง — ยังไม่ได้ประมวลผล OCR จริง]`}</pre></>}
      {dialog.type==='confirm'&&<><div className="confirm-icon"><Send size={24}/></div><p className="modal-description">ตรวจข้อมูลครั้งสุดท้ายก่อนเพิ่มเข้าคิวตัวอย่าง</p><dl className="confirm-details"><div><dt>รายการ</dt><dd>{dialog.receipt.id}</dd></div><div><dt>ร้านค้า</dt><dd>{dialog.receipt.merchant}</dd></div><div><dt>เลขที่ใบเสร็จ</dt><dd>{dialog.receipt.number}</dd></div><div><dt>ยอดสุทธิ</dt><dd className="confirm-total">฿{money(dialog.receipt.total)}</dd></div></dl><div className="demo-notice">การทำงานนี้บันทึกข้อมูลทั้งหมดไว้ในเบราว์เซอร์ และล็อกแถวนี้ในคิวจำลอง ยังไม่เชื่อมต่อ LINE, OCR, Supabase หรือ JST</div><div className="modal-actions"><button className="button outline" onClick={()=>setDialog(null)}>กลับไปตรวจ</button><button className="button dark" onClick={()=>queue(dialog.receipt)}><Check size={16}/>ยืนยันเข้าคิวจำลอง</button></div></>}
      {dialog.type==='help'&&<><p className="modal-description">ต้นแบบหน้าจอสำหรับตรวจใบเสร็จจาก 4 กลุ่ม LINE</p><ol className="help-list"><li>คลิกรูปเพื่อดูใบเสร็จขนาดใหญ่</li><li>แก้ร้านค้า เลขเอกสาร วันที่ และยอดเงินในแต่ละแถว</li><li>บันทึกฉบับร่าง หรือยืนยันส่งเข้าคิว JST จำลอง</li><li>กด “จำลองใบเสร็จใหม่” เพื่อทดลองข้อมูลที่ไหลเข้ามา</li></ol><div className="demo-notice">ข้อมูลทั้งหมดเป็นตัวอย่าง ไม่มีการส่งไปบริการภายนอก การแก้ไขจะคงอยู่เมื่อบันทึกในเบราว์เซอร์เดิมเท่านั้น</div></>}
    </dialog>}
  </div>;
}

createRoot(document.getElementById('root')).render(<App/>);
