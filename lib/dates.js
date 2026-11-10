const pad = (n) => String(n).padStart(2, '0');

// Local date + optional time -> ISO timestamp. Dates without a time mean 09:00 local.
export function partsToDue(date, time) {
  if (!date) return { due_at: null, due_has_time: false };
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = (time || '09:00').split(':').map(Number);
  return { due_at: new Date(y, m - 1, d, hh, mm).toISOString(), due_has_time: !!time };
}

export function dueToParts(dueAt, hasTime) {
  if (!dueAt) return { date: '', time: '' };
  const d = new Date(dueAt);
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: hasTime ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '',
  };
}

// Short label like "Today 14:30", "Tomorrow", "Thu 12 Nov".
export function dueLabel(dueAt, hasTime, lang) {
  if (!dueAt) return '';
  const d = new Date(dueAt);
  const locale = lang === 'he' ? 'he-IL' : 'en-GB';
  const today = new Date();
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(d) - startOf(today)) / 86400000);
  const rel = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  let day;
  if (diff >= -1 && diff <= 1) day = rel.format(diff, 'day');
  else day = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(d);
  day = day.charAt(0).toUpperCase() + day.slice(1);
  if (!hasTime) return day;
  return `${day} ${new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(d)}`;
}
