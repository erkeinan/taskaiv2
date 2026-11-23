// Short phone vibrations, like other apps. Silently does nothing where vibration is not supported (iPhone, desktop).
const PATTERNS = {
  tick: 12, // a swipe crosses the action point
  tap: 18,
  success: [28, 60, 42], // task done: two pulses, the second a bit longer
  warn: [40, 50, 40],
};
export function haptic(kind = 'tap') {
  try {
    if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(PATTERNS[kind] ?? PATTERNS.tap);
  } catch {
    /* not supported */
  }
}
