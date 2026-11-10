'use client';

import { useState } from 'react';
import { textDir } from '@/lib/i18n';
import Sheet from './Sheet';

// The AI suggestion card: everything is editable before the task is created.
export default function SuggestionSheet({ t, suggestion, hasFile, mode, busy, onSubmit, onAnother, onCancel }) {
  const [draft, setDraft] = useState(() => ({ ...suggestion, steps: [...(suggestion.steps || [])] }));
  const [keepFile, setKeepFile] = useState(false);
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

  const setStep = (i, value) => set({ steps: draft.steps.map((s, j) => (j === i ? value : s)) });
  const removeStep = (i) => set({ steps: draft.steps.filter((_, j) => j !== i) });
  const addStep = () => set({ steps: [...draft.steps, ''] });

  function submit() {
    const steps = draft.kind === 'single' ? [] : draft.steps.map((s) => s.trim()).filter(Boolean);
    onSubmit({ ...draft, title: draft.title.trim() || suggestion.title, steps }, hasFile && keepFile);
  }

  return (
    <Sheet onClose={onCancel} tall>
      <div className="ai-badge">
        <span aria-hidden="true">✦</span> {t.aiDetected}
      </div>

      <label className="field">
        <span>{t.title}</span>
        <input value={draft.title} dir={textDir(draft.title)} onChange={(e) => set({ title: e.target.value })} maxLength={500} />
      </label>

      <div className="field">
        <span>{t.type}</span>
        <div className="segmented" role="radiogroup">
          {['single', 'checklist', 'stages'].map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={draft.kind === k}
              className={draft.kind === k ? 'on' : ''}
              onClick={() => set({ kind: k, steps: k !== 'single' && draft.steps.length === 0 ? [''] : draft.steps })}
            >
              {t[k]}
            </button>
          ))}
        </div>
      </div>

      {draft.kind !== 'single' && (
        <div className="field">
          <span>{draft.kind === 'checklist' ? t.items : t.steps}</span>
          <ol className={`step-edit ${draft.kind}`}>
            {draft.steps.map((s, i) => (
              <li key={i}>
                <input value={s} dir={textDir(s)} onChange={(e) => setStep(i, e.target.value)} maxLength={500} />
                <button type="button" className="icon-btn" aria-label={t.delete} onClick={() => removeStep(i)}>
                  ×
                </button>
              </li>
            ))}
          </ol>
          <button type="button" className="link-button" onClick={addStep}>
            {t.addStep}
          </button>
        </div>
      )}

      <div className="field-row">
        <label className="field">
          <span>{t.due}</span>
          <input type="date" value={draft.due_date || ''} onChange={(e) => set({ due_date: e.target.value || null })} />
        </label>
        <label className="field">
          <span>{t.time}</span>
          <input type="time" value={draft.due_time || ''} disabled={!draft.due_date} onChange={(e) => set({ due_time: e.target.value || null })} />
        </label>
        <label className="field">
          <span>{t.priority}</span>
          <select value={draft.priority} onChange={(e) => set({ priority: Number(e.target.value) })}>
            <option value={0}>{t.pNone}</option>
            <option value={1}>{t.pLow}</option>
            <option value={2}>{t.pMedium}</option>
            <option value={3}>{t.pHigh}</option>
          </select>
        </label>
      </div>

      <div className="field-row two-col">
        <label className="field">
          <span>{t.category}</span>
          <input value={draft.category || ''} dir={textDir(draft.category || '')} onChange={(e) => set({ category: e.target.value })} placeholder={t.categoryPh} maxLength={100} />
        </label>
        <label className="field">
          <span>{t.repeat}</span>
          <select
            value={draft.repeat?.frequency || 'none'}
            onChange={(e) => set({ repeat: e.target.value === 'none' ? null : { frequency: e.target.value, interval: 1 } })}
          >
            <option value="none">{t.noRepeat}</option>
            <option value="daily">{t.daily}</option>
            <option value="weekly">{t.weekly}</option>
            <option value="monthly">{t.monthly}</option>
            <option value="yearly">{t.yearly}</option>
          </select>
        </label>
      </div>

      {draft.person && (
        <p className="meta-line">
          <span className="meta-label">{t.person}:</span> <span dir={textDir(draft.person)}>{draft.person}</span>
        </p>
      )}
      {draft.summary && (
        <p className="summary" dir={textDir(draft.summary)}>
          {draft.summary}
        </p>
      )}
      {draft.questions?.length > 0 && (
        <div className="questions">
          <strong>{t.needsAnswer}</strong>
          <ul>
            {draft.questions.map((q, i) => (
              <li key={i} dir={textDir(q)}>
                {q}
              </li>
            ))}
          </ul>
        </div>
      )}

      {hasFile && (
        <fieldset className="file-choice">
          <legend>{t.keepFileQ}</legend>
          <label>
            <input type="radio" name="keep" checked={!keepFile} onChange={() => setKeepFile(false)} /> {t.taskOnly}
          </label>
          <label>
            <input type="radio" name="keep" checked={keepFile} onChange={() => setKeepFile(true)} /> {t.taskAndFile}
          </label>
        </fieldset>
      )}

      <button type="button" className="primary wide" disabled={busy} onClick={submit}>
        {mode === 'organize' ? t.saveChanges : t.createTask}
      </button>
      <div className="sheet-row">
        <button type="button" className="sheet-btn" disabled={busy} onClick={() => onAnother(draft.title)}>
          {t.suggestAnother}
        </button>
        <button type="button" className="sheet-btn quiet" onClick={onCancel}>
          {t.cancel}
        </button>
      </div>
    </Sheet>
  );
}
