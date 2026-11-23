'use client';

import { useEffect } from 'react';

const COLORS = ['#f5b301', '#e0457b', '#2f9e8f', '#6d3a83', '#3a7bd5', '#ff7a45'];
// More and bigger pieces with a soft random spread, so the effect feels lively but natural.
const PIECES = Array.from({ length: 46 }, (_, i) => ({
  left: (i * 37 + 7) % 100,
  delay: ((i * 7) % 12) * 0.045,
  size: 18 + ((i * 13) % 22),
  color: COLORS[i % COLORS.length],
  drift: ((i * 29) % 120) - 60,
  spin: ((i * 53) % 540) - 270,
  dur: 1.5 + ((i * 17) % 9) / 10,
}));

// Done celebration: confetti, balloons, stars or bubbles, bottom-to-top or top-to-bottom.
export default function Celebration({ effect = 'stars', direction = 'up', onEnd }) {
  useEffect(() => {
    if (effect === 'none') {
      onEnd();
      return undefined;
    }
    const id = setTimeout(onEnd, effect === 'balloons' ? 2800 : 2300);
    return () => clearTimeout(id);
  }, [effect, onEnd]);

  if (effect === 'none') return null;

  return (
    <div className={`celebration fx-${effect} dir-${direction}`} aria-hidden="true">
      {PIECES.map((p, i) => (
        <span
          key={i}
          className="piece"
          style={{
            left: `${p.left}%`,
            animationDelay: `${p.delay}s`,
            fontSize: `${p.size}px`,
            '--c': p.color,
            '--drift': `${p.drift}px`,
            '--spin': `${p.spin}deg`,
            animationDuration: `${effect === 'balloons' ? p.dur + 0.6 : p.dur}s`,
          }}
        >
          {effect === 'stars' ? '★' : effect === 'balloons' ? '🎈' : ''}
        </span>
      ))}
    </div>
  );
}
