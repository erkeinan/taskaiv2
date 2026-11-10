'use client';

import { useRef, useState } from 'react';
import { textDir } from '@/lib/i18n';

const OPEN_WIDTH = 168; // room for the revealed action buttons
const THRESHOLD = 64;

// One task row. Swipe in the reading direction (left to right in English,
// right to left in Hebrew) to reveal the actions behind it.
export default function TaskRow({ task, uiDir, done, actions, onToggle, snoozedLabel }) {
  const [drag, setDrag] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const gesture = useRef(null);
  const sign = uiDir === 'rtl' ? -1 : 1;

  function onPointerDown(e) {
    if (e.target.closest('button')) return;
    gesture.current = { x: e.clientX, y: e.clientY, active: false, base: revealed ? OPEN_WIDTH : 0 };
  }

  function onPointerMove(e) {
    const g = gesture.current;
    if (!g) return;
    const mx = (e.clientX - g.x) * sign;
    const my = e.clientY - g.y;
    if (!g.active) {
      if (Math.abs(mx) < 10 || Math.abs(mx) < Math.abs(my)) return;
      g.active = true;
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    setDrag(Math.max(0, Math.min(OPEN_WIDTH + 24, g.base + mx)));
  }

  function onPointerUp() {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (!g.active) {
      if (revealed) setRevealed(false);
      return;
    }
    setRevealed(drag > THRESHOLD);
    setDrag(0);
  }

  const offset = gesture.current?.active ? drag : revealed ? OPEN_WIDTH : 0;

  return (
    <li className={`task-row${done ? ' is-done' : ''}${snoozedLabel ? ' is-snoozed' : ''}`}>
      <div className="task-actions">
        {actions.map((a) => (
          <button
            key={a.key}
            type="button"
            className={`action ${a.tone}`}
            onClick={() => {
              setRevealed(false);
              a.onClick();
            }}
          >
            {a.label}
          </button>
        ))}
      </div>
      <div
        className="task-front"
        style={{ transform: `translateX(${sign * offset}px)`, transition: gesture.current?.active ? 'none' : undefined }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <button
          type="button"
          className={`check${done ? ' checked' : ''}`}
          aria-label={done ? 'Reopen' : 'Done'}
          onClick={onToggle}
        >
          {done && (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 12.5l4 4 8-9" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
        <div className="task-text">
          <span className="task-title" dir={textDir(task.title)}>
            {task.title}
          </span>
          {snoozedLabel && <span className="task-meta">{snoozedLabel}</span>}
        </div>
      </div>
    </li>
  );
}
