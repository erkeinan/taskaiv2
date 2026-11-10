// Repeat rules: { frequency: 'daily'|'weekly'|'monthly'|'yearly', interval: 1..365, weekday?: 0..6 }
// The next occurrence is created by the database when a repeating task is marked done.

export function normalizeRule(rule) {
  if (!rule || !['daily', 'weekly', 'monthly', 'yearly'].includes(rule.frequency)) return null;
  const interval = Number(rule.interval) >= 1 ? Math.min(365, Math.floor(Number(rule.interval))) : 1;
  const out = { frequency: rule.frequency, interval };
  if (rule.frequency === 'weekly' && rule.weekday != null && rule.weekday !== '' && Number(rule.weekday) >= 0 && Number(rule.weekday) <= 6) {
    out.weekday = Number(rule.weekday);
  }
  return out;
}

// Sunday 8 Nov 2026 + n gives each weekday, for localized names.
export function weekdayName(n, lang) {
  return new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-GB', { weekday: 'long' }).format(new Date(2026, 10, 8 + n));
}

const UNITS = {
  en: { daily: ['day', 'days'], weekly: ['week', 'weeks'], monthly: ['month', 'months'], yearly: ['year', 'years'] },
  he: { daily: ['יום', 'ימים'], weekly: ['שבוע', 'שבועות'], monthly: ['חודש', 'חודשים'], yearly: ['שנה', 'שנים'] },
};

export function repeatLabel(rule, lang) {
  const r = normalizeRule(rule);
  if (!r) return '';
  const every = lang === 'he' ? 'כל' : 'Every';
  if (r.weekday != null && r.interval === 1) return `${every} ${weekdayName(r.weekday, lang)}`;
  const [one, many] = UNITS[lang === 'he' ? 'he' : 'en'][r.frequency];
  return r.interval > 1 ? `${every} ${r.interval} ${many}` : `${every} ${one}`;
}
