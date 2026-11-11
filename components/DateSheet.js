'use client';

import { useState } from 'react';
import { textDir } from '@/lib/i18n';
import { dueToParts, partsToDue } from '@/lib/dates';
import Sheet from './Sheet';

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function snoozeAt(kind) {
  const d = new Date();
  if (kind === 'hour') d.setHours(d.getHours() + 1);
  else {
    d.setDate(d.getDate() + (kind === 'week' ? 7 : 1));
    d.setHours(9, 0, 0, 0);
  }
  return d.toISOString();
}

// Set or change a task's date straight from the list, or snooze it.
export default function DateSheet({ t, task, onSave, onSnooze, onClose }) {
  const start = dueToParts(task.due_at, task.due_has_time);
  const [date, setDate] = useState(start.date);
  const [time, setTime] = useState(start.time);
  const quick = (days) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    setDate(ymd(d));
  };

  return (
    <Sheet onClose={onClose}>
      <p className="sheet-title" dir={textDir(task.title)}>
        {task.title}
      </p>
      <div className="chip-row">
        <button type="button" className="chip-btn" onClick={() => quick(0)}>
          {t.fToday}
        </button>
        <button type="button" className="chip-btn" onClick={() => quick(1)}>
          {t.tomorrow.replace(/ ?09:00/, '')}
        </button>
        <button type="button" className="chip-btn" onClick={() => quick(7)}>
          {t.nextWeek}
        </button>
      </div>
      <div className="field-row two-col">
        <label className="field">
          <span>{t.due}</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field">
          <span>{t.time}</span>
          <input type="time" value={time} disabled={!date} onChange={(e) => setTime(e.target.value)} />
        </label>
      </div>
      <button type="button" className="primary wide" disabled={!date} onClick={() => onSave(partsToDue(date, time))}>
        {t.save}
      </button>
      {task.due_at && (
        <button type="button" className="sheet-btn" onClick={() => onSave({ due_at: null, due_has_time: false })}>
          {t.clearDate}
        </button>
      )}
      {task.status !== 'done' && (
        <>
          <p className="sheet-sub">{t.snooze}</p>
          <div className="chip-row">
            <button type="button" className="chip-btn" onClick={() => onSnooze(snoozeAt('hour'))}>
              {t.inOneHour}
            </button>
            <button type="button" className="chip-btn" onClick={() => onSnooze(snoozeAt('tomorrow'))}>
              {t.tomorrow}
            </button>
            <button type="button" className="chip-btn" onClick={() => onSnooze(snoozeAt('week'))}>
              {t.nextWeek}
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}
