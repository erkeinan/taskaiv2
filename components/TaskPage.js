'use client';

import { useEffect, useRef, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import { textDir } from '@/lib/i18n';
import { dueLabel, dueToParts, partsToDue } from '@/lib/dates';
import { normalizeRule, repeatLabel, weekdayName } from '@/lib/recurrence';

const pad = (n) => String(n).padStart(2, '0');
const toLocalInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

function snoozeAt(kind) {
  const d = new Date();
  if (kind === 'hour') d.setHours(d.getHours() + 1);
  else {
    d.setDate(d.getDate() + (kind === 'week' ? 7 : 1));
    d.setHours(9, 0, 0, 0);
  }
  return d.toISOString();
}

// Full-screen task page: everything about one task. The phone's back button closes it.
export default function TaskPage({ t, lang, task, categories, people, now, onClose, patchTask, onOrganize, onDone, onArchive, onDelete, onRestore }) {
  const [menuOpen, setMenuOpen] = useState(false);
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

  const parts = dueToParts(task.due_at, task.due_has_time);
  const rule = normalizeRule(task.recurrence);
  const snoozed = task.snoozed_until && Date.parse(task.snoozed_until) > now;
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

  function snooze(iso) {
    patchTask(task.id, { snoozed_until: iso });
    logEvent(`snooze:${iso}`);
  }

  function unsnooze() {
    patchTask(task.id, { snoozed_until: null });
    logEvent('unsnooze');
  }

  function saveCategory() {
    const v = category.trim().slice(0, 100);
    if (v === (task.category || '')) return;
    patchTask(task.id, { category: v || null });
    if (v) logEvent(`category:${v}`);
  }

  function saveAssignee() {
    const v = assignee.trim().slice(0, 100);
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

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [updates.length]);

  const subtitle = [task.category, task.due_at ? dueLabel(task.due_at, task.due_has_time, lang) : null, rule ? `🔁 ${repeatLabel(rule, lang)}` : null]
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
              <button type="button" role="menuitem" className="danger" onClick={() => { setMenuOpen(false); onDelete(task.id); }}>
                {t.delete}
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="convo-body wallpaper" ref={bodyRef}>
        <section className="info-card">
          <div className="detail-head">
            {task.status === 'inbox' && <span className="pill">{t.inbox}</span>}
            {task.archived_at && <span className="pill">{t.fArchived}</span>}
            {task.needs_answer && <span className="pill warn">{t.needsAnswer}</span>}
            {snoozed && <span className="pill warn">💤 {fmt.format(new Date(task.snoozed_until))}</span>}
          </div>

          <textarea className="detail-title" rows={2} value={title} dir={textDir(title)} onChange={(e) => setTitle(e.target.value)} onBlur={saveTexts} maxLength={500} aria-label={t.title} />

          <div className="segmented status-seg" role="radiogroup" aria-label={t.status}>
            {[
              ['open', t.open],
              ['in_progress', t.inProgress],
              ['done', t.done],
            ].map(([key, label]) => {
              const on = task.status === key || (key === 'open' && task.status === 'inbox');
              return (
                <button key={key} type="button" role="radio" aria-checked={on} className={on ? 'on' : ''} onClick={() => setStatus(key)}>
                  {label}
                </button>
              );
            })}
          </div>

          <div className="card-list">
            <div className="row">
              <span className="row-icon">📅</span>
              <span className="row-label">{t.due}</span>
              <div className="row-value two">
                <input type="date" value={parts.date} aria-label={t.due} onChange={(e) => patchTask(task.id, partsToDue(e.target.value, parts.time))} />
                <input type="time" value={parts.time} aria-label={t.time} disabled={!parts.date} onChange={(e) => patchTask(task.id, partsToDue(parts.date, e.target.value))} />
              </div>
            </div>

            <div className="row">
              <span className="row-icon">🔁</span>
              <span className="row-label">{t.repeat}</span>
              <div className="row-value wrap">
                <select value={freq} aria-label={t.repeat} onChange={(e) => setRepeat(e.target.value === 'none' ? null : { frequency: e.target.value, interval: rule?.interval || 1 })}>
                  <option value="none">{t.noRepeat}</option>
                  <option value="daily">{t.daily}</option>
                  <option value="weekly">{t.weekly}</option>
                  <option value="monthly">{t.monthly}</option>
                  <option value="yearly">{t.yearly}</option>
                </select>
                {rule && (
                  <label className="inline">
                    {t.every}
                    <input type="number" min={1} max={365} value={rule.interval} onChange={(e) => setRepeat({ ...rule, interval: Number(e.target.value) || 1 })} className="num" />
                  </label>
                )}
                {rule?.frequency === 'weekly' && (
                  <select value={rule.weekday ?? ''} aria-label={t.anyDay} onChange={(e) => setRepeat({ ...rule, weekday: e.target.value === '' ? null : Number(e.target.value) })}>
                    <option value="">{t.anyDay}</option>
                    {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                      <option key={d} value={d}>
                        {weekdayName(d, lang)}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            <div className="row">
              <span className="row-icon">💤</span>
              <span className="row-label">{t.snooze}</span>
              <div className="row-value wrap">
                {snoozed ? (
                  <>
                    <span className="muted-small">
                      {t.snoozedUntil} {fmt.format(new Date(task.snoozed_until))}
                    </span>
                    <button type="button" className="chip-btn" onClick={unsnooze}>
                      {t.unsnooze}
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" className="chip-btn" onClick={() => snooze(snoozeAt('hour'))}>
                      {t.inOneHour}
                    </button>
                    <button type="button" className="chip-btn" onClick={() => snooze(snoozeAt('tomorrow'))}>
                      {t.tomorrow}
                    </button>
                    <button type="button" className="chip-btn" onClick={() => snooze(snoozeAt('week'))}>
                      {t.nextWeek}
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="row">
              <span className="row-icon">🏷</span>
              <span className="row-label">{t.category}</span>
              <div className="row-value">
                <input list="taskai-categories" value={category} dir={textDir(category)} placeholder={t.categoryPh} onChange={(e) => setCategory(e.target.value)} onBlur={saveCategory} maxLength={100} aria-label={t.category} />
                <datalist id="taskai-categories">
                  {categories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
            </div>

            <div className="row">
              <span className="row-icon">👤</span>
              <span className="row-label">{t.assignedTo}</span>
              <div className="row-value">
                <input list="taskai-people" value={assignee} dir={textDir(assignee)} placeholder={t.assignPh} onChange={(e) => setAssignee(e.target.value)} onBlur={saveAssignee} maxLength={100} aria-label={t.assignedTo} />
                <datalist id="taskai-people">
                  {people.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </div>
            </div>

            <div className="row">
              <span className="row-icon">⚑</span>
              <span className="row-label">{t.priority}</span>
              <div className="row-value">
                <select value={task.priority || 0} aria-label={t.priority} onChange={(e) => patchTask(task.id, { priority: Number(e.target.value) })}>
                  <option value={0}>{t.pNone}</option>
                  <option value={1}>{t.pLow}</option>
                  <option value={2}>{t.pMedium}</option>
                  <option value={3}>{t.pHigh}</option>
                </select>
              </div>
            </div>
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
              <input value={newStep} dir={textDir(newStep)} onChange={(e) => setNewStep(e.target.value)} placeholder={t.addStep} maxLength={500} aria-label={t.addStep} />
            </form>
          </div>

          <div className="field">
            <span>{t.description}</span>
            <textarea className="desc" rows={2} value={description} dir={textDir(description)} placeholder={t.descriptionPh} onChange={(e) => setDescription(e.target.value)} onBlur={saveTexts} maxLength={10000} aria-label={t.description} />
          </div>

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
    </div>
  );
}
