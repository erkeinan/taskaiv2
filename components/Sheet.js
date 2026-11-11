'use client';

import { useEffect } from 'react';

// Bottom sheet on phones, centered dialog on desktop. Closes with ✕, Escape, or a tap outside.
export default function Sheet({ children, onClose, tall }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className={`sheet${tall ? ' tall' : ''}`} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="sheet-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
        {children}
      </div>
    </div>
  );
}
