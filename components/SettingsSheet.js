'use client';

import { useState } from 'react';
import { callAI } from '@/lib/ai';
import { VOICE_LANGUAGES } from '@/lib/prefs';
import Sheet from './Sheet';

const NAMES = { openai: 'OpenAI', gemini: 'Gemini', claude: 'Claude' };

function langName(code, uiLang) {
  try {
    return new Intl.DisplayNames([uiLang === 'he' ? 'he' : 'en'], { type: 'language' }).of(code);
  } catch {
    return code;
  }
}

// All settings from the old app, plus the AI connection.
export default function SettingsSheet({ t, lang, prefs, onPrefs, ai, onAIChange, onToggleLang, onTryCelebration, alerts, onAlerts, onSignOut, onClose }) {
  const [provider, setProvider] = useState(ai?.provider || 'openai');
  const [model, setModel] = useState(ai?.provider ? ai.model || '' : '');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);
  const defaults = ai?.defaults || {};
  const sameProvider = ai?.hasKey && ai.provider === provider;
  const set = (patch) => onPrefs({ ...prefs, ...patch });

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

  const toggleVoiceLang = (code) => {
    const has = prefs.voiceLanguages.includes(code);
    set({ voiceLanguages: has ? prefs.voiceLanguages.filter((c) => c !== code) : [...prefs.voiceLanguages, code] });
  };

  return (
    <Sheet onClose={onClose} tall>
      <p className="sheet-title">{t.settings}</p>

      <section className="settings-block">
        <h3>{t.appearance}</h3>
        <button type="button" className="sheet-btn" onClick={onToggleLang}>
          🌐 {t.language}
        </button>
        <label className="field">
          <span>{t.theme}</span>
          <select value={prefs.theme} onChange={(e) => set({ theme: e.target.value })}>
            <option value="system">{t.themeSystem}</option>
            <option value="light">{t.themeLight}</option>
            <option value="dark">{t.themeDark}</option>
          </select>
        </label>
        <label className="field">
          <span>{t.fontSize}</span>
          <select value={prefs.fontSize} onChange={(e) => set({ fontSize: e.target.value })}>
            <option value="small">{t.small}</option>
            <option value="medium">{t.medium}</option>
            <option value="large">{t.large}</option>
          </select>
        </label>
        <label className="field">
          <span>{t.accent}</span>
          <select value={prefs.accent} onChange={(e) => set({ accent: e.target.value })}>
            {['sage', 'ocean', 'plum', 'amber', 'rose'].map((a) => (
              <option key={a} value={a}>
                {t[a]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t.celebrationStyle}</span>
          <select value={prefs.celebration} onChange={(e) => set({ celebration: e.target.value })}>
            <option value="confetti">{t.confetti}</option>
            <option value="balloons">{t.balloons}</option>
            <option value="stars">{t.starsFx}</option>
            <option value="bubbles">{t.bubbles}</option>
            <option value="none">{t.noneFx}</option>
          </select>
        </label>
        <label className="field">
          <span>{t.direction}</span>
          <select value={prefs.direction} onChange={(e) => set({ direction: e.target.value })}>
            <option value="up">{t.up}</option>
            <option value="down">{t.down}</option>
          </select>
        </label>
        <button type="button" className="sheet-btn" onClick={onTryCelebration}>
          🎉 {t.tryCelebration}
        </button>
      </section>

      <section className="settings-block">
        <h3>{t.tasksSection}</h3>
        <label className="field">
          <span>{t.sortBy}</span>
          <select value={prefs.sort} onChange={(e) => set({ sort: e.target.value })}>
            <option value="due">{t.sortDue}</option>
            <option value="newest">{t.sortNewest}</option>
            <option value="oldest">{t.sortOldest}</option>
            <option value="title">{t.sortTitle}</option>
          </select>
        </label>
        <h3>{t.taskAlerts}</h3>
        <small className="muted-small">{t.alertsHelp}</small>
        <label className="field">
          <span>{t.minutesBefore}</span>
          <input
            type="number"
            min={0}
            max={1440}
            value={prefs.remindMinutes}
            onChange={(e) => set({ remindMinutes: Math.max(0, Math.min(1440, Number(e.target.value) || 0)) })}
          />
        </label>
        {alerts === 'on' ? (
          <>
            <p className="status-line ok">{t.alertsOn}</p>
            <button type="button" className="sheet-btn" onClick={() => onAlerts(false)}>
              {t.disableAlerts}
            </button>
          </>
        ) : alerts === 'blocked' ? (
          <p className="error">{t.alertsBlocked}</p>
        ) : (
          <button type="button" className="primary wide" onClick={() => onAlerts(true)}>
            🔔 {t.enableAlerts}
          </button>
        )}
      </section>

      <section className="settings-block">
        <h3>{t.voice}</h3>
        <small className="muted-small">{t.voiceSoon}</small>
        <label className="field">
          <span>{t.voiceMode}</span>
          <select value={prefs.voiceMode} onChange={(e) => set({ voiceMode: e.target.value })}>
            <option value="record">{t.voiceRecord}</option>
            <option value="conversation">{t.voiceConversation}</option>
          </select>
        </label>
        <fieldset className="lang-grid">
          <legend>{t.voiceLanguages}</legend>
          <label>
            <input type="checkbox" checked={prefs.voiceLanguages.length === 0} onChange={() => set({ voiceLanguages: [] })} /> {t.voiceAuto}
          </label>
          {VOICE_LANGUAGES.map((code) => (
            <label key={code}>
              <input type="checkbox" checked={prefs.voiceLanguages.includes(code)} onChange={() => toggleVoiceLang(code)} /> {langName(code, lang)}
            </label>
          ))}
        </fieldset>
      </section>

      <section className="settings-block">
        <h3>{t.aiConnection}</h3>
        <p className={`status-line${ai?.hasKey ? ' ok' : ''}`}>
          {ai?.hasKey ? `${t.connectedTo}: ${NAMES[ai.provider]} · ${ai.model || defaults[ai.provider] || ''}` : t.notConnected}
        </p>
        <form onSubmit={save} className="settings-form">
          <label className="field">
            <span>{t.provider}</span>
            <select
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value);
                setModel('');
              }}
            >
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

      <section className="settings-block">
        <h3>{t.account}</h3>
        <button type="button" className="sheet-btn" onClick={onSignOut}>
          {t.signOut}
        </button>
      </section>
    </Sheet>
  );
}
