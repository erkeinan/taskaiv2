'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import { textDir, localeOf } from '@/lib/i18n';
import { dueLabel } from '@/lib/dates';
import { normalizeRule, repeatLabel, weekdayName } from '@/lib/recurrence';
import Sheet from './Sheet';
import DateSheet from './DateSheet';
import RemindSheet from './RemindSheet';
import Icon from './Icon';
import { prepareFile } from '@/lib/media';

// Full-screen task page: everything about one task. The phone's back button closes it.
export default function TaskPage({ t, lang, task, categories, people, now, onClose, patchTask, onOrganize, onDone, onArchive, onDelete, onRestore, uploadFile, userId, received, onLeave, onSharesChanged, onSaveContact, onToast }) {
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
  const [members, setMembers] = useState([]); // [{ user_id, name, is_owner }]
  const [shareLink, setShareLink] = useState('');
  const [editUpdate, setEditUpdate] = useState(null); // { id, body }
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const nameOf = (id) => (id === userId ? t.you : members.find((m) => m.user_id === id)?.name || '');
  const isShared = members.length > 1;

  const rule = normalizeRule(task.recurrence);
  const remindOn = task.snoozed_until && Date.parse(task.snoozed_until) > now;
  const late = task.status !== 'done' && task.due_at && Date.parse(task.due_at) < now;
  const fmt = new Intl.DateTimeFormat(localeOf(lang), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

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
      .select('id,kind,body,created_at,updated_at,author_id')
      .eq('task_id', task.id)
      .is('deleted_at', null)
      .order('created_at')
      .limit(200)
      .then(({ data }) => live && setUpdates(data || []));
    supabase.rpc('task_people', { p_task: task.id }).then(({ data }) => live && setMembers(data || []));
    // live: the other people on a shared task see each other's steps and updates at once
    const channel = supabase
      .channel(`task-${task.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'comments', filter: `task_id=eq.${task.id}` }, (p) => {
        const row = p.new;
        if (!row?.id) return;
        setUpdates((prev) => {
          if (row.deleted_at) return prev.filter((u) => u.id !== row.id);
          const i = prev.findIndex((u) => u.id === row.id);
          if (i === -1) return [...prev, row];
          const next = prev.slice();
          next[i] = { ...prev[i], ...row };
          return next;
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_steps', filter: `task_id=eq.${task.id}` }, (p) => {
        const row = p.new;
        if (!row?.id) return;
        setSteps((prev) => {
          if (row.deleted_at) return prev.filter((x) => x.id !== row.id);
          const i = prev.findIndex((x) => x.id === row.id);
          const slim = { id: row.id, title: row.title, done: row.done, position: row.position };
          if (i === -1) return [...prev, slim].sort((a, b) => a.position - b.position);
          const next = prev.slice();
          next[i] = slim;
          return next;
        });
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'files', filter: `task_id=eq.${task.id}` }, (p) => {
        const row = p.new;
        if (row?.id) setFiles((prev) => (prev.some((f) => f.id === row.id) ? prev : [...prev, row]));
      })
      .subscribe();
    return () => {
      live = false;
      supabase.removeChannel(channel);
    };
  }, [task.id]);

  async function logEvent(body) {
    const row = { id: crypto.randomUUID(), task_id: task.id, kind: 'event', body: body.slice(0, 4000), created_at: new Date().toISOString(), author_id: userId };
    setUpdates((prev) => [...prev, row]);
    await getSupabase().from('comments').insert({ id: row.id, task_id: row.task_id, kind: 'event', body: row.body });
  }

  async function addUpdate() {
    const body = newUpdate.trim();
    if (!body) return;
    const row = { id: crypto.randomUUID(), task_id: task.id, kind: 'update', body: body.slice(0, 4000), created_at: new Date().toISOString(), author_id: userId };
    setUpdates((prev) => [...prev, row]);
    setNewUpdate('');
    const { error } = await getSupabase().from('comments').insert({ id: row.id, task_id: row.task_id, kind: 'update', body: row.body });
    if (error) setUpdates((prev) => prev.filter((u) => u.id !== row.id));
  }

  async function saveEditedUpdate() {
    const e = editUpdate;
    setEditUpdate(null);
    const body = e.body.trim().slice(0, 4000);
    if (!body) return;
    const at = new Date().toISOString();
    setUpdates((prev) => prev.map((u) => (u.id === e.id ? { ...u, body, updated_at: at } : u)));
    await getSupabase().from('comments').update({ body }).eq('id', e.id);
  }
  async function deleteUpdate(id) {
    setEditUpdate(null);
    setUpdates((prev) => prev.filter((u) => u.id !== id));
    await getSupabase().from('comments').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  }

  // files: any picture or document, saved with this task or note
  async function addFile(file) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      onToast?.('Max 20 MB');
      return;
    }
    setUploading(true);
    try {
      let att;
      try {
        att = await prepareFile(file, 'document');
      } catch {
        att = { name: file.name || 'file', mime: file.type || 'application/octet-stream', blob: file };
      }
      const row = await uploadFile(att, task.id);
      setFiles((prev) => (prev.some((f) => f.id === row.id) ? prev : [...prev, row]));
    } catch (err) {
      onToast?.(err.message || t.error);
    } finally {
      setUploading(false);
    }
  }

  // ---- sharing by link ----
  async function openShare() {
    setEdit('share');
    if (shareLink) return;
    const supabase = getSupabase();
    const { data: mine } = await supabase.from('task_shares').select('token').eq('task_id', task.id).eq('shared_by', userId).is('recipient_id', null).eq('status', 'pending').limit(1);
    let token = mine?.[0]?.token;
    if (!token) {
      const { data, error } = await supabase.from('task_shares').insert({ task_id: task.id }).select('token').single();
      if (error) {
        onToast?.(error.message);
        return;
      }
      token = data.token;
    }
    setShareLink(`${window.location.origin}/?join=${token}`);
  }
  async function sendInvite() {
    const text = `${task.title}\n${t.shareText}: ${shareLink}`;
    try {
      if (navigator.share) await navigator.share({ title: task.title, text, url: shareLink });
      else window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    } catch {
      /* cancelled */
    }
  }
  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(shareLink);
      onToast?.(t.linkCopied);
    } catch {
      /* not allowed */
    }
  }
  async function removePerson(uid) {
    setMembers((prev) => prev.filter((m) => m.user_id !== uid));
    await getSupabase().from('task_shares').update({ status: 'revoked' }).eq('task_id', task.id).eq('recipient_id', uid);
    onSharesChanged?.();
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
      case 'due':
        return `${t.due}: ${arg ? dueLabel(arg.split('|')[0], arg.split('|')[1] === '1', lang) : t.noDate}`;
      case 'priority':
        return `${t.priority}: ${[t.pNone, t.pLow, t.pMedium, t.pHigh][Number(arg)] || arg}`;
      case 'step':
        return `✓ ${arg}`;
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
    if (doneNow && isShared) logEvent(`step:${step.title}`);
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

  const subtitle = [isNote ? t.note : null, isShared ? `${t.shared} · ${members.map((m) => (m.user_id === userId ? t.you : m.name)).join(', ')}` : null, task.category, task.due_at ? dueLabel(task.due_at, task.due_has_time, lang) : null, rule ? repeatLabel(rule, lang) : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="convo">
      <header className="convo-bar">
        <button type="button" className="icon-top" aria-label={t.back} onClick={close}>
          <Icon name="back" size={24} className="flip-rtl" strokeWidth={2} />
        </button>
        <div className="convo-title">
          <strong dir={textDir(task.title)}>{task.title}</strong>
          <small>{subtitle || t.taskInfo}</small>
        </div>
        <button type="button" className="icon-top" aria-label={t.shareTitle} title={t.shareTitle} onClick={openShare}>
          <Icon name={isShared ? 'users' : 'share'} size={23} />
        </button>
        <div className="menu-wrap">
          <button type="button" className="icon-top" aria-label={t.moreActions} onClick={() => setMenuOpen((v) => !v)}>
            <Icon name="more" size={23} />
          </button>
          {menuOpen && (
            <div className="menu" role="menu">
              {received ? (
                <button type="button" role="menuitem" className="danger" onClick={() => { setMenuOpen(false); saveTexts(); onLeave(task.id); }}>
                  {t.leaveTask}
                </button>
              ) : task.archived_at ? (
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
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); share(); }}>
                {t.sendAsText}
              </button>
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onSaveContact?.(task.assignee_name || '', [task.assignee_name, description.match(/[+\d][\d\s()-]{6,}\d/)?.[0], description.match(/\S+@\S+\.\S+/)?.[0]].filter(Boolean).join(' · ')); }}>
                {t.saveToKnowledge}
              </button>
              {!received && (
                <button type="button" role="menuitem" className="danger" onClick={() => { setMenuOpen(false); onDelete(task.id); }}>
                  {t.delete}
                </button>
              )}
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
                <Icon name={task.status === 'done' ? 'check' : task.status === 'in_progress' ? 'half' : 'circle'} size={15} strokeWidth={2.2} />
                {task.status === 'done' ? t.done : task.status === 'in_progress' ? t.inProgress : t.open}
              </button>
            )}
            {!isNote && (
              <button type="button" className={`prop${task.due_at ? ' set' : ''}${late ? ' late' : ''}`} onClick={() => setEdit('date')}>
                <Icon name="calendar" size={16} />
                {task.due_at ? dueLabel(task.due_at, task.due_has_time, lang) : t.dates}
              </button>
            )}
            <button type="button" className={`prop${remindOn ? ' set' : ''}`} onClick={() => setEdit('remind')}>
              <Icon name="bell" size={16} />
              {remindOn ? fmt.format(new Date(task.snoozed_until)) : t.remind}
            </button>
            {!isNote && (
              <button type="button" className={`prop${rule ? ' set' : ''}`} onClick={() => setEdit('repeat')}>
                <Icon name="repeat" size={16} />
                {rule ? repeatLabel(rule, lang) : t.repeat}
              </button>
            )}
            <button type="button" className={`prop${task.category ? ' set' : ''}`} onClick={() => setEdit('category')}>
              <Icon name="tag" size={16} />
              <span dir={textDir(task.category || '')}>{task.category || t.category}</span>
            </button>
            {!isNote && (
              <button type="button" className={`prop${task.assignee_name ? ' set' : ''}`} onClick={() => setEdit('assignee')}>
                <Icon name="user" size={16} />
                <span dir={textDir(task.assignee_name || '')}>{task.assignee_name || t.assignee}</span>
              </button>
            )}
            {!isNote && (
              <button type="button" className={`prop${task.priority ? ` set prio${task.priority}` : ''}`} onClick={() => setEdit('priority')}>
                <Icon name="flag" size={16} />
                {task.priority ? [t.pNone, t.pLow, t.pMedium, t.pHigh][task.priority] : t.priority}
              </button>
            )}
          </div>

          <AutoText className="desc" value={description} onChange={setDescription} onBlur={saveTexts} maxLength={10000} label={t.description} placeholder={isNote ? t.notePh : t.descriptionPh} />

          <div className="field">
              <span className="inline-ico">
                <Icon name="checklist" size={15} /> {task.kind === 'stages' ? t.steps : t.items} {steps.length > 0 && `· ${doneCount}/${steps.length}`}
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
                <input value={newStep} dir={textDir(newStep)} onChange={(e) => setNewStep(e.target.value)} placeholder={isNote ? t.addItem : t.addStep} maxLength={500} aria-label={t.addStep} />
              </form>
          </div>

          <div className="field">
            <span className="inline-ico">
              <Icon name="clip" size={15} /> {t.files}
            </span>
            {files.length > 0 && (
              <ul className="file-list">
                {files.map((f) => (
                  <li key={f.id}>
                    <span>
                      <Icon name={f.mime?.startsWith('image/') ? 'image' : 'file'} size={16} /> {f.name}
                    </span>
                    <button type="button" className="link-button" onClick={() => openFile(f)}>
                      {t.openFile}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div>
              <button type="button" className="file-add" disabled={uploading} onClick={() => fileRef.current?.click()}>
                <Icon name="plus" size={16} /> {uploading ? t.uploading : t.addFile}
              </button>
              <input ref={fileRef} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; addFile(f); }} />
            </div>
          </div>

          {task.status === 'inbox' && (
            <button type="button" className="primary wide" onClick={() => { saveTexts(); onOrganize(task, { source_text: sourceText }); }}>
              {t.organizeAI}
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

        {updates.map((u) => {
          const mine = !u.author_id || u.author_id === userId;
          const who = isShared ? nameOf(u.author_id) : '';
          if (u.kind === 'event')
            return (
              <div key={u.id} className="sys-pill" dir={textDir(eventText(u.body))}>
                {who && !mine ? `${who}: ` : ''}
                {eventText(u.body)} · {fmt.format(new Date(u.created_at))}
              </div>
            );
          const edited = u.updated_at && Date.parse(u.updated_at) - Date.parse(u.created_at) > 2000;
          return (
            <div
              key={u.id}
              className={`bubble ${mine ? 'out mine' : 'in'}`}
              role={mine ? 'button' : undefined}
              tabIndex={mine ? 0 : undefined}
              onClick={mine ? () => setEditUpdate({ id: u.id, body: u.body }) : undefined}
            >
              {who && !mine && <span className="bubble-author">{who}</span>}
              <span className="bubble-text" dir={textDir(u.body)}>
                {u.body}
              </span>
              <span className="bubble-time">
                {edited && <span className="bubble-edited">{t.edited} · </span>}
                {fmt.format(new Date(u.created_at))}
              </span>
            </div>
          );
        })}
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
          <Icon name="send" size={21} className="flip-rtl" />
        </button>
      </form>

      {editUpdate && (
        <Sheet onClose={() => setEditUpdate(null)}>
          <p className="sheet-title">{t.edit}</p>
          <textarea className="edit-area" autoFocus rows={3} value={editUpdate.body} dir={textDir(editUpdate.body)} maxLength={4000} onChange={(e) => setEditUpdate({ ...editUpdate, body: e.target.value })} />
          <div className="sheet-row">
            <button type="button" className="sheet-btn danger" onClick={() => deleteUpdate(editUpdate.id)}>
              {t.delete}
            </button>
            <button type="button" className="sheet-btn good" disabled={!editUpdate.body.trim()} onClick={saveEditedUpdate}>
              {t.save}
            </button>
          </div>
        </Sheet>
      )}

      {edit === 'share' && (
        <Sheet onClose={() => setEdit(null)}>
          <p className="sheet-title">{t.shareTitle}</p>
          <p className="sheet-sub">{t.shareHelp}</p>
          {members.length > 1 && (
            <div className="field">
              <span>{t.sharedWith}</span>
              <div className="people">
                {members.map((m) => (
                  <span key={m.user_id} className="person-chip">
                    <span className="mini">{[...(m.name || '?')][0].toUpperCase()}</span>
                    <span dir={textDir(m.name)}>{m.user_id === userId ? t.you : m.name}</span>
                    {!received && !m.is_owner && (
                      <button type="button" aria-label={t.removePerson} onClick={() => removePerson(m.user_id)}>
                        <Icon name="close" size={14} />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="share-link">
            <Icon name="link" size={16} />
            <span>{shareLink || '…'}</span>
          </div>
          <button type="button" className="primary wide" disabled={!shareLink} onClick={sendInvite}>
            {t.shareInvite}
          </button>
          <button type="button" className="sheet-btn" disabled={!shareLink} onClick={copyInvite}>
            {t.copyLink}
          </button>
        </Sheet>
      )}

      {edit === 'status' && (
        <Sheet onClose={() => setEdit(null)}>
          <p className="sheet-title">{t.status}</p>
          <div className="pick-list">
            {[
              ['open', 'circle', t.open],
              ['in_progress', 'half', t.inProgress],
              ['done', 'check', t.done],
            ].map(([key, icon, label]) => (
              <button key={key} type="button" className={`inline-ico${task.status === key || (key === 'open' && task.status === 'inbox') ? ' on' : ''}`} onClick={() => { setEdit(null); setStatus(key); }}>
                <Icon name={icon} size={18} /> {label}
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
            if (isShared) logEvent(`due:${patch.due_at ? `${patch.due_at}|${patch.due_has_time ? 1 : 0}` : ''}`);
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
              <button key={label} type="button" className={`inline-ico${(task.priority || 0) === i ? ' on' : ''}`} onClick={() => { patchTask(task.id, { priority: i }); if (isShared) logEvent(`priority:${i}`); setEdit(null); }}>
                <span className={`flag-dot p${i}`} aria-hidden="true"><Icon name="flag" size={18} /></span> {label}
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
