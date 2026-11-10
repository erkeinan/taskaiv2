'use client';

import { useEffect } from 'react';

const STARS = Array.from({ length: 22 }, (_, i) => ({
  left: (i * 37) % 100,
  delay: (i % 7) * 0.06,
  size: 12 + ((i * 13) % 14),
}));

// "Stars, bottom to top" — the default done effect from the old app.
export default function Celebration({ onEnd }) {
  useEffect(() => {
    const id = setTimeout(onEnd, 1400);
    return () => clearTimeout(id);
  }, [onEnd]);

  return (
    <div className="celebration" aria-hidden="true">
      {STARS.map((s, i) => (
        <span
          key={i}
          className="star"
          style={{ left: `${s.left}%`, animationDelay: `${s.delay}s`, fontSize: `${s.size}px` }}
        >
          ★
        </span>
      ))}
    </div>
  );
}
