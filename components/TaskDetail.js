'use client';

import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import { textDir } from '@/lib/i18n';
import { dueToParts, partsToDue } from '@/lib/dates';
import Sheet from './Sheet';

// Full task view. Loads its steps, details and files only when opened (small, one-off reads).
export default function TaskDetail({ t, task, onClose, patchTask, onOrganize, onDone, onArchive, onDelete }) {
  const [title, setTitle] = useState(task.title);
  const [extra, setExtra] = useState(null); // { details, source_text }
  const [steps, setSteps] = useState([]);
  const [files, setFiles] = useState([]);
  const [newStep, setNewStep] = useState('');
  const parts = dueToParts(task.due_at, task.due_has_time);
  const done = task.status === 'done';

  useEffect(() => {
    const supabase = getSupabase();
    let live = true;
    supabase
      .from('tasks')
      .select('details,source_text')
      .eq('id', task.id)
      .maybeSingle()
      .then(({ data }) => live && setExtra(data || {}));
    supabase
      .from('task_steps')
      .select('id,title,done,position')
      .eq('task_id', task.id)
      .is('deleted_at', null)
      .order('position')
      .then(({ data }) => live && setSteps(data || []));
    supabase
      .from('files')
      .select('id,name,mime,storage_path')
      .eq('task_id', task.id)
      .is('deleted_at', null)
      .then(({ data }) => live && setFiles(data || []));
    return () => {
      live = false;
    };
  }, [task.id]);

  async function toggleStep(step) {
    const doneNow = !step.done;
    setSteps((prev) => prev.map((s) => (s.id === step.id ? { ...s, done: doneNow } : s)));
    await getSupabase()
      .from('task_steps')
      .update({ done: doneNow, completed_at: doneNow ? new Date().toISOString() : null })
      .eq('id', step.id);
  }

  async function addStep() {
    const value = newStep.trim();
    if (!value) return;
    const row = { id: crypto.randomUUID(), task_id: task.id, title: value.slice(0, 500), position: (steps.at(-1)?.position ?? 0) + 1, done: false };
    setSteps((prev) => [...prev, row]);
    setNewStep('');
    const { error } = await getSupabase().from('task_steps').insert(row);
    if (error) setSteps((prev) => prev.filter((s) => s.id !== row.id));
    if (!error && task.kind === 'single') patchTask(task.id, { kind: 'checklist' });
  }

  async function removeStep(step) {
    setSteps((prev) => prev.filter((s) => s.id !== step.id));
    await getSupabase().from('task_steps').update({ deleted_at: new Date().toISOString() }).eq('id', step.id);
  }

  async function openFile(f) {
    const { data } = await getSupabase().storage.from('files').createSignedUrl(f.storage_path, 120);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener');
  }

  function saveTitle() {
    const v = title.trim();
    if (v && v !== task.title) patchTask(task.id, { title: v.slice(0, 500) });
  }

  const doneCount = steps.filter((s) => s.done).length;

  return (
    <Sheet onClose={() => { saveTitle(); onClose(); }} tall>
      <div className="detail-head">
        {task.status === 'inbox' && <span className="pill">{t.inbox}</span>}
        {task.needs_answer && <span className="pill warn">{t.needsAnswer}</span>}
        {task.priority > 0 && <span className={`pill p${task.priority}`}>{[t.pNone, t.pLow, t.pMedium, t.pHigh][task.priority]}</span>}
      </div>

      <textarea
        className="detail-title"
        rows={2}
        value={title}
        dir={textDir(title)}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={saveTitle}
        maxLength={500}
      />

      <div className="field-row">
        <label className="field">
          <span>{t.due}</span>
          <input type="date" value={parts.date} onChange={(e) => patchTask(task.id, partsToDue(e.target.value, parts.time))} />
        </label>
        <label className="field">
          <span>{t.time}</span>
          <input type="time" value={parts.time} disabled={!parts.date} onChange={(e) => patchTask(task.id, partsToDue(parts.date, e.target.value))} />
        </label>
        <label className="field">
          <span>{t.priority}</span>
          <select value={task.priority || 0} onChange={(e) => patchTask(task.id, { priority: Number(e.target.value) })}>
            <option value={0}>{t.pNone}</option>
            <option value={1}>{t.pLow}</option>
            <option value={2}>{t.pMedium}</option>
            <option value={3}>{t.pHigh}</option>
          </select>
        </label>
      </div>

      <div className="field">
        <span>
          {task.kind === 'stages' ? t.steps : t.items} {steps.length > 0 && `· ${doneCount}/${steps.length}`}
        </span>
        <ul className={`step-list ${task.kind}`}>
          {steps.map((s, i) => (
            <li key={s.id} className={s.done ? 'is-done' : ''}>
              <button type="button" className={`check small${s.done ? ' checked' : ''}`} aria-label={s.title} onClick={() => toggleStep(s)}>
                {s.done ? '✓' : task.kind === 'stages' ? i + 1 : ''}
              </button>
              <span dir={textDir(s.title)}>{s.title}</span>
              <button type="button" className="icon-btn" aria-label={t.delete} onClick={() => removeStep(s)}>
                ×
              </button>
            </li>
          ))}
        </ul>
        <form
          className="inline-add"
          onSubmit={(e) => {
            e.preventDefault();
            addStep();
          }}
        >
          <input value={newStep} dir={textDir(newStep)} onChange={(e) => setNewStep(e.target.value)} placeholder={t.addStep} maxLength={500} />
        </form>
      </div>

      {extra?.details && (
        <div className="field">
          <span>{t.details}</span>
          <p className="summary pre" dir={textDir(extra.details)}>
            {extra.details}
          </p>
        </div>
      )}
      {extra?.source_text && (
        <details className="field source">
          <summary>{t.source}</summary>
          <p className="pre" dir={textDir(extra.source_text)}>
            {extra.source_text}
          </p>
        </details>
      )}
      {files.length > 0 && (
        <div className="field">
          <span>{t.files}</span>
          <ul className="file-list">
            {files.map((f) => (
              <li key={f.id}>
                <span>📎 {f.name}</span>
                <button type="button" className="link-button" onClick={() => openFile(f)}>
                  {t.openFile}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {task.status === 'inbox' && (
        <button type="button" className="primary wide" onClick={() => onOrganize(task, extra)}>
          ✦ {t.organizeAI}
        </button>
      )}
      <div className="sheet-row">
        {!done && (
          <button type="button" className="sheet-btn good" onClick={() => onDone(task)}>
            {t.done}
          </button>
        )}
        <button type="button" className="sheet-btn" onClick={() => onArchive(task.id)}>
          {t.archive}
        </button>
        <button type="button" className="sheet-btn danger" onClick={() => onDelete(task.id)}>
          {t.delete}
        </button>
      </div>
    </Sheet>
  );
}
