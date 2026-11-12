'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import { textDir } from '@/lib/i18n';
import { dueLabel } from '@/lib/dates';
import { normalizeRule, repeatLabel, weekdayName } from '@/lib/recurrence';
import Sheet from './Sheet';
import DateSheet from './DateSheet';
import RemindSheet from './RemindSheet';

// Full-screen task page: everything about one task. The phone's back button closes it.
export default function TaskPage({ t, lang, task, categories, people, now, onClose, patchTask, onOrganize, onDone, onArchive, onDelete, onRestore }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [edit, setEdit] = useState(null);
  const isNote = task.kind === 'note';
  const bodyRef = useRef(null);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [steps, setSteps] = useState([]);
  const [files, setFiles] = useState([]);
  const [updates, setUpdates] = useState([]);
  const [newStep, setNewStep] = useState('');
  const [newUpdate, setNewUpdate] = useState('');
  const [category, setCategory] = useState(task.category || '');
  const [assignee, setAssignee] = useState(task.assignee_name || '');
  const loadedDescription = useRef('');

  const rule = normalizeRule(task.recurrence);
  const remindOn = task.snoozed_until && Date.parse(task.snoozed_until) > now;
  const late = task.status !== 'done' && task.due_at && Date.parse(task.due_at) < now;
  const fmt = new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  // One small read per section, only when the page opens.
  useEffect(() => {
    const supabase = getSupabase();
    let live = true;
    supabase
      .from('tasks')
      .select('details,source_text')
      .eq('id', task.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!live || !data) return;
        loadedDescription.current = data.details || '';
        setDescription(data.details || '');
        setSourceText(data.source_text || '');
      });
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
    supabase
      .from('comments')
      .select('id,kind,body,created_at')
      .eq('task_id', task.id)
      .is('deleted_at', null)
      .order('created_at')
      .limit(200)
      .then(({ data }) => live && setUpdates(data || []));
    return () => {
      live = false;
    };
  }, [task.id]);

  async function logEvent(body) {
    const row = { id: crypto.randomUUID(), task_id: task.id, kind: 'event', body: body.slice(0, 4000), created_at: new Date().toISOString() };
    setUpdates((prev) => [...prev, row]);
    await getSupabase().from('comments').insert({ id: row.id, task_id: row.task_id, kind: 'event', body: row.body });
  }

  async function addUpdate() {
    const body = newUpdate.trim();
    if (!body) return;
    const row = { id: crypto.randomUUID(), task_id: task.id, kind: 'update', body: body.slice(0, 4000), created_at: new Date().toISOString() };
    setUpdates((prev) => [...prev, row]);
    setNewUpdate('');
    const { error } = await getSupabase().from('comments').insert({ id: row.id, task_id: row.task_id, kind: 'update', body: row.body });
    if (error) setUpdates((prev) => prev.filter((u) => u.id !== row.id));
  }

  function eventText(body) {
    const [code, ...rest] = body.split(':');
    const arg = rest.join(':');
    switch (code) {
      case 'status':
        return t[`ev_${arg}`] || arg;
      case 'snooze':
        return `${t.ev_snooze} ${fmt.format(new Date(arg))}`;
      case 'unsnooze':
        return t.ev_unsnooze;
      case 'repeat':
        if (arg === 'created') return t.ev_created;
        if (arg === 'off') return t.ev_repeatOff;
        try {
          return `${t.ev_repeat} ${repeatLabel(JSON.parse(arg), lang)}`;
        } catch {
          return t.ev_repeat;
        }
      case 'assign':
        return `${t.ev_assign} ${arg}`;
      case 'category':
        return `${t.ev_category} ${arg}`;
      default:
        return body;
    }
  }

  // ---- field changes ----
  function setStatus(status) {
    if (status === task.status) return;
    if (status === 'done') {
      saveTexts();
      onDone(task);
      return;
    }
    patchTask(task.id, { status, completed_at: null });
    logEvent(`status:${status}`);
  }

  function setRepeat(next) {
    const r = normalizeRule(next);
    patchTask(task.id, { recurrence: r });
    logEvent(r ? `repeat:${JSON.stringify(r)}` : 'repeat:off');
  }

  function remind(iso) {
    patchTask(task.id, { snoozed_until: iso });
    logEvent(`snooze:${iso}`);
  }

  function unremind() {
    patchTask(task.id, { snoozed_until: null });
    logEvent('unsnooze');
  }

  function saveCategory(value) {
    const v = value.trim().slice(0, 100);
    if (v === (task.category || '')) return;
    patchTask(task.id, { category: v || null });
    if (v) logEvent(`category:${v}`);
  }

  function saveAssignee(value) {
    const v = value.trim().slice(0, 100);
    if (v === (task.assignee_name || '')) return;
    patchTask(task.id, { assignee_name: v || null });
    if (v) logEvent(`assign:${v}`);
  }

  function saveTexts() {
    const v = title.trim();
    if (v && v !== task.title) patchTask(task.id, { title: v.slice(0, 500) });
    if (description !== loadedDescription.current) {
      loadedDescription.current = description;
      patchTask(task.id, { details: description.slice(0, 10000) || null });
    }
  }

  // ---- steps ----
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
    else if (task.kind === 'single') patchTask(task.id, { kind: 'checklist' });
  }
  async function removeStep(step) {
    setSteps((prev) => prev.filter((s) => s.id !== step.id));
    await getSupabase().from('task_steps').update({ deleted_at: new Date().toISOString() }).eq('id', step.id);
  }

  async function openFile(f) {
    const { data } = await getSupabase().storage.from('files').createSignedUrl(f.storage_path, 120);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener');
  }

  async function share() {
    const lines = [task.title];
    if (task.due_at) lines.push(`📅 ${dueLabel(task.due_at, task.due_has_time, lang)}`);
    steps.filter((s) => !s.done).forEach((s) => lines.push(`• ${s.title}`));
    if (description) lines.push('', description);
    lines.push('', t.sentFrom);
    const text = lines.join('\n');
    try {
      if (navigator.share) await navigator.share({ title: task.title, text });
      else window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    } catch {
      /* user cancelled */
    }
  }

  function close() {
    saveTexts();
    onClose();
  }

  const doneCount = steps.filter((s) => s.done).length;
  const freq = rule?.frequency || 'none';

  const seenUpdates = useRef(-1);
  useEffect(() => {
    // first load: stay at the top; a newly added update: scroll to it
    if (seenUpdates.current >= 0 && updates.length > seenUpdates.current) {
      const el = bodyRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
    seenUpdates.current = updates.length;
  }, [updates.length]);

  const subtitle = [isNote ? `📝 ${t.note}` : null, task.category, task.due_at ? dueLabel(task.due_at, task.due_has_time, lang) : null, rule ? `🔁 ${repeatLabel(rule, lang)}` : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="convo">
      <header className="convo-bar">
        <button type="button" className="icon-top" aria-label={t.back} onClick={close}>
          <svg viewBox="0 0 24 24" aria-hidden="true" className="flip-rtl">
            <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="convo-title">
          <strong dir={textDir(task.title)}>{task.title}</strong>
          <small>{subtitle || t.taskInfo}</small>
        </div>
        <button type="button" className="icon-top" aria-label={t.share} onClick={share}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 13v6h14v-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="menu-wrap">
          <button type="button" className="icon-top" aria-label={t.moreActions} onClick={() => setMenuOpen((v) => !v)}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="5" r="1.8" fill="currentColor" />
              <circle cx="12" cy="12" r="1.8" fill="currentColor" />
              <circle cx="12" cy="19" r="1.8" fill="currentColor" />
            </svg>
          </button>
          {menuOpen && (
            <div className="menu" role="menu">
              {task.archived_at ? (
                <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onRestore(task.id); }}>
                  {t.restore}
                </button>
              ) : (
                <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); saveTexts(); onArchive(task.id); }}>
                  {t.archive}
                </button>
              )}
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); saveTexts(); patchTask(task.id, isNote ? { kind: 'single', status: 'open' } : { kind: 'note' }); }}>
                {isNote ? t.makeTask : t.makeNote}
              </button>
              <button type="button" role="menuitem" className="danger" onClick={() => { setMenuOpen(false); onDelete(task.id); }}>
                {t.delete}
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="convo-body wallpaper" ref={bodyRef}>
        <section className="info-card">
          {(task.status === 'inbox' || task.archived_at || task.needs_answer) && (
            <div className="detail-head">
              {task.status === 'inbox' && <span className="pill">{t.inbox}</span>}
              {task.archived_at && <span className="pill">{t.fArchived}</span>}
              {task.needs_answer && <span className="pill warn">{t.needsAnswer}</span>}
            </div>
          )}

          <AutoText className="detail-title" value={title} onChange={setTitle} onBlur={saveTexts} maxLength={500} label={t.title} />

          <div className="prop-chips">
            {!isNote && (
              <button type="button" className={`prop status-${task.status}`} onClick={() => setEdit('status')}>
                <span aria-hidden="true">{task.status === 'done' ? '✓' : task.status === 'in_progress' ? '◐' : '○'}</span>
                {task.status === 'done' ? t.done : task.status === 'in_progress' ? t.inProgress : t.open}
              </button>
            )}
            {!isNote && (
              <button type="button" className={`prop${task.due_at ? ' set' : ''}${late ? ' late' : ''}`} onClick={() => setEdit('date')}>
                <span aria-hidden="true">📅</span>
                {task.due_at ? dueLabel(task.due_at, task.due_has_time, lang) : t.dates}
              </button>
            )}
            <button type="button" className={`prop${remindOn ? ' set' : ''}`} onClick={() => setEdit('remind')}>
              <span aria-hidden="true">⏰</span>
              {remindOn ? fmt.format(new Date(task.snoozed_until)) : t.remind}
            </button>
            {!isNote && (
              <button type="button" className={`prop${rule ? ' set' : ''}`} onClick={() => setEdit('repeat')}>
                <span aria-hidden="true">🔁</span>
                {rule ? repeatLabel(rule, lang) : t.repeat}
              </button>
            )}
            <button type="button" className={`prop${task.category ? ' set' : ''}`} onClick={() => setEdit('category')}>
              <span aria-hidden="true">🏷</span>
              <span dir={textDir(task.category || '')}>{task.category || t.category}</span>
            </button>
            {!isNote && (
              <button type="button" className={`prop${task.assignee_name ? ' set' : ''}`} onClick={() => setEdit('assignee')}>
                <span aria-hidden="true">👤</span>
                <span dir={textDir(task.assignee_name || '')}>{task.assignee_name || t.assignee}</span>
              </button>
            )}
            {!isNote && (
              <button type="button" className={`prop${task.priority ? ` set prio${task.priority}` : ''}`} onClick={() => setEdit('priority')}>
                <span aria-hidden="true" className="flag">⚑</span>
                {task.priority ? [t.pNone, t.pLow, t.pMedium, t.pHigh][task.priority] : t.priority}
              </button>
            )}
          </div>

          <AutoText className="desc" value={description} onChange={setDescription} onBlur={saveTexts} maxLength={10000} label={t.description} placeholder={isNote ? t.notePh : t.descriptionPh} />

          {(!isNote || steps.length > 0) && (
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
                <input value={newStep} dir={textDir(newStep)} onChange={(e) => setNewStep(e.target.value)} placeholder={t.addStep} maxLength={500} aria-label={t.addStep} />
              </form>
            </div>
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
            <button type="button" className="primary wide" onClick={() => { saveTexts(); onOrganize(task, { source_text: sourceText }); }}>
              ✦ {t.organizeAI}
            </button>
          )}
        </section>

        {sourceText && (
          <div className="bubble in">
            <span className="bubble-q">{t.original}</span>
            <span className="bubble-text" dir={textDir(sourceText)}>
              {sourceText}
            </span>
          </div>
        )}

        {updates.map((u) =>
          u.kind === 'event' ? (
            <div key={u.id} className="sys-pill" dir={textDir(eventText(u.body))}>
              {eventText(u.body)} · {fmt.format(new Date(u.created_at))}
            </div>
          ) : (
            <div key={u.id} className="bubble out">
              <span className="bubble-text" dir={textDir(u.body)}>
                {u.body}
              </span>
              <span className="bubble-time">{fmt.format(new Date(u.created_at))}</span>
            </div>
          ),
        )}
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          addUpdate();
        }}
      >
        <div className="composer-box">
          <input value={newUpdate} dir={textDir(newUpdate) === 'auto' ? undefined : textDir(newUpdate)} onChange={(e) => setNewUpdate(e.target.value)} placeholder={t.addUpdate} maxLength={4000} aria-label={t.addUpdate} />
        </div>
        <button type="submit" className="send" aria-label={t.send} disabled={!newUpdate.trim()}>
          <svg viewBox="0 0 24 24" aria-hidden="true" className="flip-rtl">
            <path d="M4 12l16-8-6 16-2.5-6.5z" fill="currentColor" />
          </svg>
        </button>
      </form>

      {edit === 'status' && (
        <Sheet onClose={() => setEdit(null)}>
          <p className="sheet-title">{t.status}</p>
          <div className="pick-list">
            {[
              ['open', `○ ${t.open}`],
              ['in_progress', `◐ ${t.inProgress}`],
              ['done', `✓ ${t.done}`],
            ].map(([key, label]) => (
              <button key={key} type="button" className={task.status === key || (key === 'open' && task.status === 'inbox') ? 'on' : ''} onClick={() => { setEdit(null); setStatus(key); }}>
                {label}
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {edit === 'date' && (
        <DateSheet
          t={t}
          task={task}
          onClose={() => setEdit(null)}
          onSave={(patch) => {
            patchTask(task.id, patch);
            setEdit(null);
          }}
        />
      )}
      {edit === 'remind' && (
        <RemindSheet
          t={t}
          lang={lang}
          current={remindOn ? task.snoozed_until : null}
          onClose={() => setEdit(null)}
          onPick={(iso) => {
            setEdit(null);
            remind(iso);
          }}
          onClear={() => {
            setEdit(null);
            unremind();
          }}
        />
      )}
      {edit === 'repeat' && (
        <Sheet onClose={() => setEdit(null)}>
          <p className="sheet-title">{t.repeat}</p>
          <div className="pick-list">
            {[
              ['none', t.noRepeat],
              ['daily', t.daily],
              ['weekly', t.weekly],
              ['monthly', t.monthly],
              ['yearly', t.yearly],
            ].map(([key, label]) => (
              <button key={key} type="button" className={freq === key ? 'on' : ''} onClick={() => setRepeat(key === 'none' ? null : { frequency: key, interval: rule?.interval || 1, weekday: key === 'weekly' ? rule?.weekday ?? null : null })}>
                {label}
              </button>
            ))}
          </div>
          {rule && (
            <div className="field-row two-col">
              <label className="field">
                <span>{t.every}</span>
                <input type="number" min={1} max={365} value={rule.interval} onChange={(e) => setRepeat({ ...rule, interval: Number(e.target.value) || 1 })} />
              </label>
              {rule.frequency === 'weekly' && (
                <label className="field">
                  <span>{t.anyDay}</span>
                  <select value={rule.weekday ?? ''} onChange={(e) => setRepeat({ ...rule, weekday: e.target.value === '' ? null : Number(e.target.value) })}>
                    <option value="">{t.anyDay}</option>
                    {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                      <option key={d} value={d}>
                        {weekdayName(d, lang)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )}
          <button type="button" className="primary wide" onClick={() => setEdit(null)}>
            {t.done}
          </button>
        </Sheet>
      )}
      {(edit === 'category' || edit === 'assignee') && (
        <Sheet onClose={() => setEdit(null)}>
          <p className="sheet-title">{edit === 'category' ? t.category : t.assignedTo}</p>
          <form
            className="inline-add"
            onSubmit={(e) => {
              e.preventDefault();
              if (edit === 'category') saveCategory(category);
              else saveAssignee(assignee);
              setEdit(null);
            }}
          >
            <input
              autoFocus
              value={edit === 'category' ? category : assignee}
              dir={textDir(edit === 'category' ? category : assignee)}
              placeholder={edit === 'category' ? t.categoryPh : t.assignPh}
              maxLength={100}
              onChange={(e) => (edit === 'category' ? setCategory(e.target.value) : setAssignee(e.target.value))}
            />
          </form>
          <div className="chip-row">
            {(edit === 'category' ? categories : people).map((v) => (
              <button
                key={v}
                type="button"
                className={`chip-btn${(edit === 'category' ? task.category : task.assignee_name) === v ? ' on' : ''}`}
                dir={textDir(v)}
                onClick={() => {
                  if (edit === 'category') {
                    setCategory(v);
                    saveCategory(v);
                  } else {
                    setAssignee(v);
                    saveAssignee(v);
                  }
                  setEdit(null);
                }}
              >
                {v}
              </button>
            ))}
          </div>
          <div className="sheet-row">
            {(edit === 'category' ? task.category : task.assignee_name) && (
              <button type="button" className="sheet-btn" onClick={() => { if (edit === 'category') { setCategory(''); saveCategory(''); } else { setAssignee(''); saveAssignee(''); } setEdit(null); }}>
                {t.clear}
              </button>
            )}
            <button type="button" className="sheet-btn good" onClick={() => { if (edit === 'category') saveCategory(category); else saveAssignee(assignee); setEdit(null); }}>
              {t.save}
            </button>
          </div>
        </Sheet>
      )}
      {edit === 'priority' && (
        <Sheet onClose={() => setEdit(null)}>
          <p className="sheet-title">{t.priority}</p>
          <div className="pick-list">
            {[t.pNone, t.pLow, t.pMedium, t.pHigh].map((label, i) => (
              <button key={label} type="button" className={(task.priority || 0) === i ? 'on' : ''} onClick={() => { patchTask(task.id, { priority: i }); setEdit(null); }}>
                <span className={`flag-dot p${i}`} aria-hidden="true">⚑</span> {label}
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </div>
  );
}

// A text box that grows with its text, so long descriptions never scroll inside a small box.
function AutoText({ className, value, onChange, onBlur, maxLength, label, placeholder }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      className={className}
      rows={1}
      value={value}
      dir={textDir(value)}
      placeholder={placeholder}
      aria-label={label}
      maxLength={maxLength}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
    />
  );
}
