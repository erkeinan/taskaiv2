'use client';

import { useState } from 'react';
import { getSupabase } from '@/lib/supabase';

export default function Login({ t, onToggleLang }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (!email.trim() || busy) return;
    setBusy(true);
    setError('');
    const { error: err } = await getSupabase().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    setBusy(false);
    if (err) setError(err.message || t.error);
    else setSent(true);
  }

  return (
    <main className="login">
      <button type="button" className="link-button lang-corner" onClick={onToggleLang}>
        {t.language}
      </button>
      <div className="login-card">
        <div className="logo-mark large" aria-hidden="true">
          <LogoIcon />
        </div>
        <h1>TaskAI</h1>
        <p className="muted">{t.tagline}</p>
        {sent ? (
          <p className="notice">{t.linkSent}</p>
        ) : (
          <form onSubmit={submit} className="login-form">
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              dir="ltr"
              required
              placeholder={t.emailPlaceholder}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button type="submit" className="primary" disabled={busy}>
              {t.sendLink}
            </button>
          </form>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </main>
  );
}

export function LogoIcon() {
  return (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">
      <path d="M6 12.5l4 4 8-9" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
