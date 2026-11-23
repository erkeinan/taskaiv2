'use client';

import { useRef, useState } from 'react';
import { textDir } from '@/lib/i18n';
import { haptic } from '@/lib/haptics';
import Icon from './Icon';

const OPEN_WIDTH = 168;
const THRESHOLD = 64;
const AVATAR_COLORS = ['#7b4f8b', '#25a18e', '#2f6f9f', '#c2410c', '#b0405e', '#4f7d63', '#a8640a', '#5b6b85'];

function avatarFor(task) {
  const label = task.category || task.title || '?';
  let h = 0;
  for (const ch of label) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return { letter: [...label.trim()][0]?.toUpperCase() || '?', color: AVATAR_COLORS[h % AVATAR_COLORS.length] };
}

// A WhatsApp-style row: avatar, title, one-line preview, date on the right.
// Swipe in the reading direction for Done / Remind. Tap the date to change it.
export default function TaskRow({ task, uiDir, done, selected, actions, onOpen, onDate, dateLabel, dateTone, subtitle, badges, note, shared }) {
  const [drag, setDrag] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const gesture = useRef(null);
  const crossed = useRef(false);
  const sign = uiDir === 'rtl' ? -1 : 1;
  const av = avatarFor(task);

  function onPointerDown(e) {
    if (e.target.closest('button')) return;
    gesture.current = { x: e.clientX, y: e.clientY, active: false, moved: false, base: revealed ? OPEN_WIDTH : 0 };
    crossed.current = revealed;
  }
  function onPointerMove(e) {
    const g = gesture.current;
    if (!g) return;
    const mx = (e.clientX - g.x) * sign;
    const my = e.clientY - g.y;
    if (Math.abs(mx) > 6 || Math.abs(my) > 6) g.moved = true;
    if (!g.active) {
      if (Math.abs(mx) < 10 || Math.abs(mx) < Math.abs(my)) return;
      g.active = true;
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    const next = Math.max(0, Math.min(OPEN_WIDTH + 24, g.base + mx));
    // a light tick when the swipe passes the point where the actions stay open
    const over = next > THRESHOLD;
    if (over !== crossed.current) {
      crossed.current = over;
      if (over) haptic('tick');
    }
    setDrag(next);
  }
  function onPointerUp() {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (!g.active) {
      if (revealed) setRevealed(false);
      else if (!g.moved) onOpen();
      return;
    }
    setRevealed(drag > THRESHOLD);
    setDrag(0);
  }

  const offset = gesture.current?.active ? drag : revealed ? OPEN_WIDTH : 0;

  return (
    <li className={`wa-row${done ? ' is-done' : ''}${selected ? ' selected' : ''}`}>
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
        className="wa-front"
        style={{ transform: `translateX(${sign * offset}px)`, transition: gesture.current?.active ? 'none' : undefined }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          gesture.current = null;
          setDrag(0);
        }}
      >
        <span className={`avatar${note ? ' note' : ''}`} style={note ? undefined : { background: done ? 'var(--muted)' : av.color }} aria-hidden="true">
          {note ? <Icon name="note" size={24} /> : done ? <Icon name="check" size={24} strokeWidth={2.4} /> : av.letter}
        </span>
        <div className="wa-main">
          <div className="wa-line">
            {shared && (
              <span className="shared-badge" title="shared">
                <Icon name="users" size={15} />
              </span>
            )}
            <span className="wa-title" dir={textDir(task.title)}>
              {task.title}
            </span>
            {onDate ? (
              <button type="button" className={`wa-date ${dateTone || ''}`} onClick={onDate}>
                {dateLabel || <Icon name="calendar" size={17} />}
              </button>
            ) : (
              dateLabel && <span className={`wa-date ${dateTone || ''}`}>{dateLabel}</span>
            )}
          </div>
          <div className="wa-line">
            <span className="wa-sub" dir={textDir(subtitle)}>
              {subtitle}
            </span>
            <span className="wa-badges">{badges}</span>
          </div>
        </div>
      </div>
    </li>
  );
}
