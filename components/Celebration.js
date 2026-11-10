'use client';

import { useEffect } from 'react';

const COLORS = ['#f5b301', '#e0457b', '#2f9e8f', '#6d3a83', '#3a7bd5', '#ff7a45'];
const PIECES = Array.from({ length: 26 }, (_, i) => ({
  left: (i * 37 + 7) % 100,
  delay: (i % 8) * 0.07,
  size: 12 + ((i * 13) % 16),
  color: COLORS[i % COLORS.length],
  drift: ((i * 29) % 60) - 30,
}));

// Done celebration: confetti, balloons, stars or bubbles, bottom-to-top or top-to-bottom.
export default function Celebration({ effect = 'stars', direction = 'up', onEnd }) {
  useEffect(() => {
    if (effect === 'none') {
      onEnd();
      return undefined;
    }
    const id = setTimeout(onEnd, effect === 'balloons' ? 2200 : 1500);
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
          }}
        >
          {effect === 'stars' ? '★' : effect === 'balloons' ? '🎈' : ''}
        </span>
      ))}
    </div>
  );
}
