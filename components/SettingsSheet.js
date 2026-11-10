'use client';

import { useState } from 'react';
import { callAI } from '@/lib/ai';
import Sheet from './Sheet';

const NAMES = { openai: 'OpenAI', gemini: 'Gemini', claude: 'Claude' };

export default function SettingsSheet({ t, ai, onAIChange, onToggleLang, onSignOut, onClose }) {
  const [provider, setProvider] = useState(ai?.provider || 'openai');
  const [model, setModel] = useState(ai?.provider ? ai.model || '' : '');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);
  const defaults = ai?.defaults || {};
  const sameProvider = ai?.hasKey && ai.provider === provider;

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setIsError(false);
    setMessage(t.testing);
    try {
      const res = await callAI({ action: 'save-settings', provider, model: model.trim(), apiKey: apiKey.trim() });
      onAIChange(res);
      setApiKey('');
      setMessage(`${t.connectedTo}: ${NAMES[res.provider]} · ${res.model}`);
    } catch (err) {
      setIsError(true);
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      onAIChange(await callAI({ action: 'delete-settings' }));
      setMessage('');
    } catch (err) {
      setIsError(true);
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet onClose={onClose} tall>
      <p className="sheet-title">{t.settings}</p>

      <section className="settings-block">
        <h3>{t.aiConnection}</h3>
        <p className={`status-line${ai?.hasKey ? ' ok' : ''}`}>
          {ai?.hasKey ? `${t.connectedTo}: ${NAMES[ai.provider]} · ${ai.model || defaults[ai.provider] || ''}` : t.notConnected}
        </p>
        <form onSubmit={save} className="settings-form">
          <label className="field">
            <span>{t.provider}</span>
            <select value={provider} onChange={(e) => { setProvider(e.target.value); setModel(''); }}>
              <option value="openai">OpenAI</option>
              <option value="gemini">Gemini</option>
              <option value="claude">Claude</option>
            </select>
          </label>
          <label className="field">
            <span>{t.apiKey}</span>
            <input
              type="password"
              autoComplete="off"
              dir="ltr"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={sameProvider ? '••••••••' : 'sk-… / AIza… / sk-ant-…'}
            />
            {sameProvider && <small className="muted-small">{t.apiKeySaved}</small>}
          </label>
          <label className="field">
            <span>{t.model}</span>
            <input dir="ltr" value={model} onChange={(e) => setModel(e.target.value)} placeholder={defaults[provider] || ''} />
          </label>
          <button type="submit" className="primary wide" disabled={busy || (!apiKey.trim() && !sameProvider)}>
            {t.connect}
          </button>
          {message && <p className={isError ? 'error' : 'status-line ok'}>{message}</p>}
          <small className="muted-small">{t.voiceNote}</small>
        </form>
        {ai?.hasKey && (
          <button type="button" className="sheet-btn danger" disabled={busy} onClick={disconnect}>
            {t.disconnect}
          </button>
        )}
      </section>

      <div className="sheet-row">
        <button type="button" className="sheet-btn" onClick={onToggleLang}>
          {t.language}
        </button>
        <button type="button" className="sheet-btn quiet" onClick={onSignOut}>
          {t.signOut}
        </button>
      </div>
    </Sheet>
  );
}
