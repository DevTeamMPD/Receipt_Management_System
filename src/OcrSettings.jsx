import React, { useState } from 'react';
import { Check, TriangleAlert } from 'lucide-react';
import { api, ApiError } from './api.js';

const LABEL = { gemini: 'Gemini (Google)', typhoon: 'Typhoon (SCB 10X)' };
const NOTE = {
  gemini: 'อ่านลายมือและช่องติ๊กได้ดี ปกติตอบใน 2–5 วินาที แต่ช่วงคนใช้เยอะมักไม่ว่างหรือโควตาเต็ม',
  typhoon: 'โมเดลภาษาไทย อ่านช่องติ๊กได้แม่น ใช้เวลาราว 10–17 วินาทีต่อใบ',
};

// ผู้ดูแลเลือกตัวอ่าน OCR เริ่มต้น — อีกตัวเป็นสำรองอัตโนมัติถ้ามีคีย์ · มีผลกับรูปถัดไปทันที (ทั้งอัปโหลดและ LINE)
export default function OcrSettings({ ocr, onSaved, onAuthError }) {
  const [choice, setChoice] = useState(ocr?.provider);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const available = ocr?.available || {};
  const other = p => (p === 'gemini' ? 'typhoon' : 'gemini');

  async function save(e) {
    e.preventDefault();
    setBusy(true); setError(''); setSaved(false);
    try {
      const d = await api.setOcrProvider(choice);
      onSaved(d.ocr);
      setSaved(true);
    } catch (err) {
      if (onAuthError?.(err)) return;
      setError(err instanceof ApiError ? err.message : 'บันทึกไม่สำเร็จ');
    } finally { setBusy(false); }
  }

  return <form onSubmit={save} className="ocr-set">
    <p className="modal-desc">เลือกตัวที่อ่านรูปใบสั่งซื้อก่อน ถ้าตัวนี้อ่านไม่ได้ (ไม่ว่าง/โควตาเต็ม/ช้า) ระบบจะส่งให้อีกตัวอ่านต่ออัตโนมัติ ใช้กับรูปที่อัปโหลดและรูปจากกลุ่ม LINE</p>
    <fieldset className="ocr-choices">
      <legend className="sr-only">ตัวอ่าน OCR เริ่มต้น</legend>
      {['gemini', 'typhoon'].map(p => <label key={p} className={`ocr-choice${choice === p ? ' on' : ''}${available[p] ? '' : ' off'}`}>
        <input type="radio" name="ocr-provider" aria-label={LABEL[p]} value={p} checked={choice === p} disabled={!available[p] || busy} onChange={() => { setChoice(p); setSaved(false); }} />
        <span>
          <strong>{LABEL[p]}</strong>
          <small>{available[p] ? NOTE[p] : 'ยังไม่ได้ใส่คีย์ในเซิร์ฟเวอร์ — เลือกไม่ได้'}</small>
          {choice === p && available[p] && <small className="ocr-backup">{available[other(p)] ? `สำรอง: ${LABEL[other(p)]}` : 'ไม่มีตัวสำรอง (อีกตัวยังไม่มีคีย์)'}</small>}
        </span>
      </label>)}
    </fieldset>
    {ocr?.source !== 'setting' && <p className="hint">ตอนนี้ใช้ค่าเริ่มต้นจากเซิร์ฟเวอร์ ({ocr?.provider || 'ไม่ได้ตั้ง'}) จนกว่าจะกดบันทึก</p>}
    {error && <div className="banner bad" role="alert"><TriangleAlert size={18} aria-hidden="true" />{error}</div>}
    {saved && <div className="banner info" role="status"><Check size={18} aria-hidden="true" />บันทึกแล้ว รูปถัดไปจะอ่านด้วย {LABEL[choice]}</div>}
    <div className="modal-actions"><button className="btn primary" disabled={busy || !available[choice]}>{busy ? 'กำลังบันทึก…' : 'บันทึก'}</button></div>
  </form>;
}
