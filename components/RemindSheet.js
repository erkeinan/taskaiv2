'use client';

import { useState } from 'react';
import Sheet from './Sheet';

const pad = (n) => String(n).padStart(2, '0');
const toLocalInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

function at(days, hour) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d;
}
function nextWeekday(day, hour) {
  // the next given weekday (0 = Sunday), never today
  const d = new Date();
  const diff = (day - d.getDay() + 7) % 7 || 7;
  return at(diff, hour);
}

// "Remind me" list, like Slack/ClickUp: one tap sets the reminder.
export default function RemindSheet({ t, lang, current, onPick, onClear, onClose }) {
  const [custom, setCustom] = useState(false);
  const [value, setValue] = useState(() => toLocalInput(current ? new Date(current) : at(0, new Date().getHours() + 1)));
  const fmt = new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
  const fmtFull = new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const eight = fmt.format(at(0, 8));
  const in20 = new Date(Date.now() + 20 * 60000);
  const in2h = new Date(Date.now() + 2 * 3600000);
  // the weekend day and the start of the work week follow the language: Israel works Sunday–Thursday
  const weekend = lang === 'he' ? 5 : 6;
  const weekStart = lang === 'he' ? 0 : 1;
  const options = [
    [t.in20, in20],
    [t.in2h, in2h],
    [`${t.tomorrowAt} ${eight}`, at(1, 8)],
    [`${lang === 'he' ? t.fridayAt : t.saturdayAt} ${eight}`, nextWeekday(weekend, 8)],
    [`${lang === 'he' ? t.nextSundayAt : t.nextMondayAt} ${eight}`, nextWeekday(weekStart, 8)],
  ];

  return (
    <Sheet onClose={onClose}>
      <p className="sheet-title">{t.remindMe}</p>
      {current && (
        <p className="sheet-sub">
          ⏰ {fmtFull.format(new Date(current))}
        </p>
      )}
      <div className="pick-list">
        {options.map(([label, d]) => (
          <button key={label} type="button" onClick={() => onPick(d.toISOString())}>
            {label}
          </button>
        ))}
        <button type="button" className="sep" onClick={() => setCustom((v) => !v)}>
          {t.customTime}
        </button>
        {custom && (
          <form
            className="custom-time"
            onSubmit={(e) => {
              e.preventDefault();
              const d = new Date(value);
              if (!Number.isNaN(d.getTime())) onPick(d.toISOString());
            }}
          >
            <input type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} aria-label={t.customTime} />
            <button type="submit" className="primary">
              {t.save}
            </button>
          </form>
        )}
        {current && (
          <button type="button" className="danger" onClick={onClear}>
            {t.removeReminder}
          </button>
        )}
      </div>
    </Sheet>
  );
}
