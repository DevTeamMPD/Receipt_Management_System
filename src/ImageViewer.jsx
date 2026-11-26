import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Maximize, RotateCw, ZoomIn, ZoomOut } from 'lucide-react';

const MIN = 1;
const MAX = 6;
const STEP = 1.5;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ดูรูปใบสั่งซื้อแบบซูมได้: ปุ่ม +/− · ล้อเมาส์ · ถ่างนิ้ว · ลากเพื่อเลื่อน · ดับเบิลคลิก/แตะสองครั้งเพื่อขยายตรงจุดนั้น · หมุน 90°
// ใช้ transform ล้วน (ไม่โหลดรูปใหม่) จุดใต้นิ้ว/เมาส์อยู่ที่เดิมระหว่างซูม
export default function ImageViewer({ src, alt }) {
  const boxRef = useRef(null);
  const imgRef = useRef(null);
  const [view, setView] = useState({ s: 1, x: 0, y: 0, r: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const pointers = useRef(new Map());
  const gesture = useRef(null);
  const lastTap = useRef(0);

  // ตัวคูณให้รูปที่หมุน 90°/270° พอดีกล่อง (ด้านกว้าง-สูงสลับกัน)
  const fitOf = useCallback(r => {
    const img = imgRef.current;
    const box = boxRef.current;
    if (!(r % 180) || !img?.offsetWidth || !box) return 1;
    return Math.min(1, box.clientWidth / img.offsetHeight, box.clientHeight / img.offsetWidth);
  }, []);
  // จำกัดการเลื่อนไม่ให้ขอบรูปหลุดเข้ามากลางกล่อง (ไม่มีพื้นที่ว่างเมื่อซูมอยู่)
  const bound = useCallback(v => {
    const img = imgRef.current;
    const box = boxRef.current;
    if (!img?.offsetWidth || !box) return v;
    const k = v.s * fitOf(v.r);
    const [w, h] = v.r % 180 ? [img.offsetHeight, img.offsetWidth] : [img.offsetWidth, img.offsetHeight];
    const mx = Math.max(0, (w * k - box.clientWidth) / 2);
    const my = Math.max(0, (h * k - box.clientHeight) / 2);
    return { ...v, x: clamp(v.x, -mx, mx), y: clamp(v.y, -my, my) };
  }, [fitOf]);

  // จุดบนจอ (เทียบกึ่งกลางกล่อง) → ซูมเป็น s ใหม่โดยให้จุดนั้นอยู่ที่เดิม
  const zoomAt = useCallback((nextScale, px = 0, py = 0) => {
    setView(v => {
      const s = clamp(nextScale, MIN, MAX);
      if (s === MIN) return { ...v, s, x: 0, y: 0 };
      const k = s / v.s;
      return bound({ ...v, s, x: px - (px - v.x) * k, y: py - (py - v.y) * k });
    });
  }, [bound]);
  const local = useCallback(e => {
    const b = boxRef.current.getBoundingClientRect();
    return [e.clientX - b.left - b.width / 2, e.clientY - b.top - b.height / 2];
  }, []);

  // ล้อเมาส์ต้อง passive: false จึงกันหน้าเลื่อนได้ — ผูกเองแทน onWheel ของ React
  useEffect(() => {
    const box = boxRef.current;
    const onWheel = e => {
      e.preventDefault();
      const [px, py] = local(e);
      zoomAt(viewRef.current.s * Math.exp(-e.deltaY * 0.0015), px, py);
    };
    box.addEventListener('wheel', onWheel, { passive: false });
    return () => box.removeEventListener('wheel', onWheel);
  }, [local, zoomAt]);

  function onPointerDown(e) {
    boxRef.current.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
    const pts = [...pointers.current.values()];
    const v = viewRef.current;
    if (pts.length === 2) {
      const [[ax, ay], [bx, by]] = pts;
      gesture.current = { type: 'pinch', dist: Math.hypot(ax - bx, ay - by) || 1, s: v.s, mx: (ax + bx) / 2, my: (ay + by) / 2, x: v.x, y: v.y };
    } else if (pts.length === 1) {
      const now = Date.now();
      if (now - lastTap.current < 300) {
        const [px, py] = pts[0];
        if (v.s > MIN) setView(o => ({ ...o, s: MIN, x: 0, y: 0 })); else zoomAt(2.5, px, py);
        lastTap.current = 0;
        gesture.current = null;
        return;
      }
      lastTap.current = now;
      gesture.current = { type: 'pan', sx: pts[0][0], sy: pts[0][1], x: v.x, y: v.y };
    }
  }
  function onPointerMove(e) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, local(e));
    const g = gesture.current;
    if (!g) return;
    const pts = [...pointers.current.values()];
    if (g.type === 'pinch' && pts.length >= 2) {
      const [[ax, ay], [bx, by]] = pts;
      const s = clamp(g.s * (Math.hypot(ax - bx, ay - by) / g.dist), MIN, MAX);
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      const k = s / g.s;
      setView(v => (s === MIN ? { ...v, s, x: 0, y: 0 } : bound({ ...v, s, x: mx - (g.mx - g.x) * k, y: my - (g.my - g.y) * k })));
    } else if (g.type === 'pan' && pts.length === 1 && viewRef.current.s > MIN) {
      setView(v => bound({ ...v, x: g.x + pts[0][0] - g.sx, y: g.y + pts[0][1] - g.sy }));
    }
  }
  function onPointerUp(e) {
    pointers.current.delete(e.pointerId);
    const pts = [...pointers.current.values()];
    const v = viewRef.current;
    // เหลือนิ้วเดียวหลังถ่าง → เลื่อนต่อจากตำแหน่งนี้
    gesture.current = pts.length === 1 ? { type: 'pan', sx: pts[0][0], sy: pts[0][1], x: v.x, y: v.y } : null;
  }

  const fit = fitOf(view.r);
  const keyZoom = dir => zoomAt(dir > 0 ? view.s * STEP : view.s / STEP);
  function onKeyDown(e) {
    if (e.key === '+' || e.key === '=') { e.preventDefault(); keyZoom(1); }
    else if (e.key === '-') { e.preventDefault(); keyZoom(-1); }
    else if (e.key === '0') { e.preventDefault(); setView(v => ({ ...v, s: MIN, x: 0, y: 0 })); }
    else if (view.s > MIN && e.key.startsWith('Arrow')) {
      e.preventDefault();
      const d = 40;
      setView(v => bound({ ...v, x: v.x + (e.key === 'ArrowLeft' ? d : e.key === 'ArrowRight' ? -d : 0), y: v.y + (e.key === 'ArrowUp' ? d : e.key === 'ArrowDown' ? -d : 0) }));
    }
  }

  return (
    <div className="image-viewer">
      <div className="zoom-tools" role="toolbar" aria-label="ปรับการดูรูป">
        <button type="button" className="icon-btn" aria-label="ซูมออก" disabled={view.s <= MIN} onClick={() => keyZoom(-1)}><ZoomOut size={20} /></button>
        <span className="zoom-level" aria-live="polite">{Math.round(view.s * 100)}%</span>
        <button type="button" className="icon-btn" aria-label="ซูมเข้า" disabled={view.s >= MAX} onClick={() => keyZoom(1)}><ZoomIn size={20} /></button>
        <button type="button" className="icon-btn" aria-label="พอดีจอ" disabled={view.s === MIN && !view.x && !view.y} onClick={() => setView(v => ({ ...v, s: MIN, x: 0, y: 0 }))}><Maximize size={20} /></button>
        <button type="button" className="icon-btn" aria-label="หมุนรูป 90 องศา" onClick={() => setView(v => ({ s: MIN, x: 0, y: 0, r: (v.r + 90) % 360 }))}><RotateCw size={20} /></button>
      </div>
      <div
        ref={boxRef}
        className={`zoom-box${view.s > MIN ? ' zoomed' : ''}`}
        tabIndex={0}
        aria-label={`${alt} — ใช้ปุ่ม + และ − เพื่อซูม ลูกศรเพื่อเลื่อน`}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          draggable={false}
          onLoad={() => setView(v => ({ ...v }))}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s * fit}) rotate(${view.r}deg)` }}
        />
      </div>
      <p>ถ่างนิ้วหรือหมุนล้อเมาส์เพื่อซูม · ลากเพื่อเลื่อน · แตะสองครั้งเพื่อขยายตรงจุดนั้น</p>
    </div>
  );
}
