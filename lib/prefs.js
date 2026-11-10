// User preferences, matching the old app's settings.
export const DEFAULT_PREFS = {
  theme: 'system', // system | light | dark
  fontSize: 'medium', // small | medium | large
  accent: 'plum', // sage | ocean | plum | amber | rose
  celebration: 'stars', // confetti | balloons | stars | bubbles | none
  direction: 'up', // up = bottom to top, down = top to bottom
  sort: 'due', // due | newest | oldest | title
  remindMinutes: 10,
  voiceMode: 'record', // record | conversation
  voiceLanguages: [],
};

export const ACCENTS = {
  sage: { light: '#4f7d63', dark: '#7fb08f' },
  ocean: { light: '#2f6f9f', dark: '#6aa8d6' },
  plum: { light: '#6d3a83', dark: '#a873c0' },
  amber: { light: '#a8640a', dark: '#e0a040' },
  rose: { light: '#b0405e', dark: '#e07a95' },
};

export const VOICE_LANGUAGES = [
  'he', 'en', 'es', 'ar', 'fr', 'de', 'it', 'pt', 'ru', 'uk', 'zh', 'ja', 'ko', 'hi', 'tr', 'nl', 'pl', 'el', 'th', 'vi',
];

export function mergePrefs(profile) {
  const p = { ...DEFAULT_PREFS, ...(profile?.prefs || {}) };
  if (profile?.theme) p.theme = profile.theme;
  if (profile?.accent && ACCENTS[profile.accent]) p.accent = profile.accent;
  if (profile?.celebration) p.celebration = profile.celebration;
  if (profile?.remind_minutes != null) p.remindMinutes = profile.remind_minutes;
  return p;
}

// Splits a prefs object into profile columns + the prefs json column.
export function prefsToProfile(p) {
  const { theme, accent, celebration, remindMinutes, ...rest } = p;
  return { theme, accent, celebration, remind_minutes: remindMinutes, prefs: rest };
}

export function isDark(theme) {
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

export function applyPrefs(p) {
  const root = document.documentElement;
  const dark = isDark(p.theme);
  root.dataset.mode = dark ? 'dark' : 'light';
  const a = ACCENTS[p.accent] || ACCENTS.plum;
  const color = dark ? a.dark : a.light;
  root.style.setProperty('--accent', color);
  root.style.setProperty('--accent-soft', `color-mix(in srgb, ${color} ${dark ? 22 : 12}%, ${dark ? '#1d1a21' : '#ffffff'})`);
  root.style.setProperty('--zoom', { small: '0.92', medium: '1', large: '1.12' }[p.fontSize] || '1');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', color);
}
