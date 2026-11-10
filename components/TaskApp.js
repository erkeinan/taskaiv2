'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import { strings, textDir } from '@/lib/i18n';
import { callAI, localNow, timeZone } from '@/lib/ai';
import { prepareFile } from '@/lib/media';
import { dueLabel, partsToDue } from '@/lib/dates';
import Login, { LogoIcon } from './Login';
import TaskRow from './TaskRow';
import Celebration from './Celebration';
import Sheet from './Sheet';
import SuggestionSheet from './SuggestionSheet';
import TaskDetail from './TaskDetail';
import SettingsSheet from './SettingsSheet';

// Only the columns the list shows. Never the whole row set, never in a loop.
const COLS =
  'id,workspace_id,title,kind,status,priority,due_at,due_has_time,snoozed_until,needs_answer,source_kind,completed_at,archived_at,deleted_at,created_at,updated_at';

function readLocal(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
function writeLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: the app still works online */
  }
}

function snoozeTime(kind) {
  const d = new Date();
  if (kind === 'hour') d.setHours(d.getHours() + 1);
  else {
    d.setDate(d.getDate() + (kind === 'week' ? 7 : 1));
    d.setHours(9, 0, 0, 0);
  }
  return d.toISOString();
}

const visible = (task) => !task.deleted_at && !task.archived_at;
const safeName = (name) => name.replace(/[^\w.\-]+/g, '_').slice(-80) || 'file';

export default function TaskApp() {
  const [lang, setLang] = useState('en');
  const [session, setSession] = useState(undefined); // undefined = still checking
  const [workspaceId, setWorkspaceId] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [tab, setTab] = useState('open');
  const [text, setText] = useState('');
  const [online, setOnline] = useState(true);
  const [error, setError] = useState('');
  const [snoozing, setSnoozing] = useState(null);
  const [justDone, setJustDone] = useState(null);
  const [celebrate, setCelebrate] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [ai, setAi] = useState(null);
  const [attachment, setAttachment] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [suggestion, setSuggestion] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const cameraRef = useRef(null);
  const fileRef = useRef(null);
  const inputRef = useRef(null);

  const t = strings[lang];
  const uiDir = lang === 'he' ? 'rtl' : 'ltr';
  const endCelebrate = useCallback(() => setCelebrate(false), []);

  // ---- language + direction ----
  useEffect(() => {
    setLang(readLocal('taskai.lang', 'en') === 'he' ? 'he' : 'en');
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = uiDir;
  }, [lang, uiDir]);

  // ---- service worker, online state, clock for snoozes ----
  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    const tick = setInterval(() => setNow(Date.now()), 60000);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      clearInterval(tick);
    };
  }, []);

  // ---- auth ----
  useEffect(() => {
    let supabase;
    try {
      supabase = getSupabase();
    } catch (e) {
      setError(e.message);
      setSession(null);
      return;
    }
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  const userId = session?.user?.id ?? null;

  // ---- workspace, language, AI connection (small reads, once per sign-in) ----
  useEffect(() => {
    if (!userId) {
      setWorkspaceId(null);
      setAi(null);
      return;
    }
    const cachedWs = readLocal(`taskai.ws.${userId}`, null);
    if (cachedWs) setWorkspaceId(cachedWs);
    setAi(readLocal(`taskai.ai.${userId}`, null));
    const supabase = getSupabase();
    supabase
      .from('workspaces')
      .select('id')
      .eq('owner_id', userId)
      .eq('kind', 'personal')
      .maybeSingle()
      .then(({ data }) => {
        if (data?.id) {
          setWorkspaceId(data.id);
          writeLocal(`taskai.ws.${userId}`, data.id);
        }
      });
    supabase
      .from('profiles')
      .select('locale')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.locale && data.locale !== readLocal('taskai.lang', 'en')) {
          setLang(data.locale);
          writeLocal('taskai.lang', data.locale);
        }
      });
    callAI({ action: 'get-settings' })
      .then((res) => {
        setAi(res);
        writeLocal(`taskai.ai.${userId}`, res);
      })
      .catch(() => {});
  }, [userId]);

  const updateAi = (res) => {
    setAi(res);
    if (userId) writeLocal(`taskai.ai.${userId}`, res);
  };

  // ---- tasks: show the saved copy at once, load once, then live changes only ----
  useEffect(() => {
    if (!workspaceId) return;
    setTasks(readLocal(`taskai.tasks.${workspaceId}`, []));
    const supabase = getSupabase();
    let cancelled = false;

    supabase
      .from('tasks')
      .select(COLS)
      .eq('workspace_id', workspaceId)
      .is('deleted_at', null)
      .is('archived_at', null)
      .order('created_at', { ascending: false })
      .limit(300)
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) {
          if (navigator.onLine) setError(err.message);
          return;
        }
        setTasks(data);
      });

    const channel = supabase
      .channel(`tasks-${workspaceId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `workspace_id=eq.${workspaceId}` }, (payload) => {
        setTasks((prev) => {
          if (payload.eventType === 'DELETE') return prev.filter((x) => x.id !== payload.old.id);
          const row = payload.new;
          if (!visible(row)) return prev.filter((x) => x.id !== row.id);
          const i = prev.findIndex((x) => x.id === row.id);
          const slim = Object.fromEntries(COLS.split(',').map((k) => [k, row[k]]));
          if (i === -1) return [slim, ...prev];
          const next = prev.slice();
          next[i] = { ...prev[i], ...slim };
          return next;
        });
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [workspaceId]);

  useEffect(() => {
    if (workspaceId) writeLocal(`taskai.tasks.${workspaceId}`, tasks);
  }, [tasks, workspaceId]);

  // ---- paste a screenshot anywhere on the main screen ----
  const sheetOpen = !!(suggestion || detailId || settingsOpen || snoozing || justDone);
  useEffect(() => {
    if (!session || sheetOpen) return;
    const onPaste = (e) => {
      const items = e.clipboardData?.items || [];
      for (const it of items) {
        if (it.kind === 'file' && it.type.startsWith('image/')) {
          const f = it.getAsFile();
          if (f) {
            e.preventDefault();
            attach(f, 'screenshot');
            return;
          }
        }
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
    // attach is stable enough for this listener's purpose
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, sheetOpen]);

  async function attach(file, source) {
    try {
      const prepared = await prepareFile(file, source);
      setAttachment((old) => {
        if (old?.previewUrl) URL.revokeObjectURL(old.previewUrl);
        return prepared;
      });
      inputRef.current?.focus();
    } catch (e) {
      setError(e.message);
    }
  }
  function clearAttachment() {
    setAttachment((old) => {
      if (old?.previewUrl) URL.revokeObjectURL(old.previewUrl);
      return null;
    });
  }

  // ---- writes: change one row, ask for nothing back ----
  const patchTask = useCallback(
    async (id, patch) => {
      let before;
      setTasks((prev) =>
        prev
          .map((x) => {
            if (x.id !== id) return x;
            before = x;
            return { ...x, ...patch };
          })
          .filter(visible),
      );
      const { error: err } = await getSupabase().from('tasks').update(patch).eq('id', id);
      if (err) {
        setError(err.message || t.error);
        if (before) setTasks((prev) => [before, ...prev.filter((x) => x.id !== id)]);
      }
    },
    [t.error],
  );

  async function uploadFile(att, taskId) {
    const fileId = crypto.randomUUID();
    const path = `${workspaceId}/${fileId}-${safeName(att.name)}`;
    const supabase = getSupabase();
    const up = await supabase.storage.from('files').upload(path, att.blob, { contentType: att.mime, upsert: false });
    if (up.error) throw up.error;
    const { error: err } = await supabase.from('files').insert({
      id: fileId,
      workspace_id: workspaceId,
      task_id: taskId,
      storage_path: path,
      name: att.name.slice(0, 255),
      mime: att.mime,
      size_bytes: att.blob.size,
    });
    if (err) throw err;
  }

  async function insertTask(row, steps, att, keepFile) {
    setTasks((prev) => [{ ...row, details: undefined, source_text: undefined, created_at: new Date().toISOString() }, ...prev]);
    const supabase = getSupabase();
    const { error: err } = await supabase.from('tasks').insert(row);
    if (err) {
      setError(err.message || t.error);
      setTasks((prev) => prev.filter((x) => x.id !== row.id));
      return false;
    }
    if (steps.length) {
      const { error: stepErr } = await supabase
        .from('task_steps')
        .insert(steps.map((title, i) => ({ task_id: row.id, title: title.slice(0, 500), position: i + 1 })));
      if (stepErr) setError(stepErr.message);
    }
    if (keepFile && att) {
      try {
        await uploadFile(att, row.id);
      } catch (e) {
        setError(e.message || t.error);
      }
    }
    return true;
  }

  // "Task · organize later": straight to the Inbox, no AI.
  async function organizeLater() {
    const title = text.trim() || attachment?.name || '';
    if (!title || !workspaceId) return;
    const att = attachment;
    const row = {
      id: crypto.randomUUID(),
      workspace_id: workspaceId,
      title: title.slice(0, 500),
      status: 'inbox',
      kind: 'single',
      source_kind: att ? att.source : 'text',
      source_text: att?.kind === 'text' ? att.text : null,
    };
    setText('');
    clearAttachment();
    setTab('open');
    await insertTask(row, [], att, !!att);
  }

  function buildCapture(note, att, previousTitle) {
    const c = { now: localNow(), timeZone: timeZone() };
    if (note) c.text = note;
    if (previousTitle) c.previousTitle = previousTitle;
    if (att?.kind === 'image') c.image = { data: att.base64, mime: att.mime };
    if (att?.kind === 'pdf') c.file = { data: att.base64, mime: 'application/pdf', name: att.name };
    if (att?.kind === 'text') {
      c.fileText = att.text;
      c.fileName = att.name;
    }
    return c;
  }

  async function askAI(capture) {
    if (!ai?.hasKey) {
      setError(t.needAI);
      setSettingsOpen(true);
      return null;
    }
    setAiBusy(true);
    try {
      const res = await callAI({ action: 'capture', capture });
      return res.suggestion;
    } catch (e) {
      setError(e.message);
      if (e.code === 'no_ai') setSettingsOpen(true);
      return null;
    } finally {
      setAiBusy(false);
    }
  }

  // "Let AI understand"
  async function understand() {
    const note = text.trim();
    if (!note && !attachment) return;
    const s = await askAI(buildCapture(note, attachment));
    if (s) setSuggestion({ data: s, mode: 'create', note, attachment, version: Date.now() });
  }

  async function suggestAnother(previousTitle) {
    const cur = suggestion;
    const s = await askAI({ ...buildCapture(cur.note, cur.attachment), previousTitle });
    if (s) setSuggestion({ ...cur, data: s, version: Date.now() });
  }

  async function organizeWithAI(task, extra) {
    setDetailId(null);
    const note = [task.title, extra?.source_text].filter(Boolean).join('\n\n');
    const s = await askAI(buildCapture(note, null));
    if (s) setSuggestion({ data: s, mode: 'organize', taskId: task.id, note, attachment: null, version: Date.now() });
  }

  function detailsText(d) {
    const lines = [];
    if (d.summary) lines.push(d.summary);
    if (d.person) lines.push(`${t.person}: ${d.person}`);
    if (d.questions?.length) lines.push(`${t.needsAnswer}:\n${d.questions.map((q) => `• ${q}`).join('\n')}`);
    return lines.join('\n\n').slice(0, 10000) || null;
  }

  async function confirmSuggestion(draft, keepFile) {
    const s = suggestion;
    setSuggestion(null);
    const due = partsToDue(draft.due_date, draft.due_time);
    const common = {
      title: draft.title.slice(0, 500),
      kind: draft.kind,
      priority: draft.priority,
      ...due,
      details: detailsText(draft),
      needs_answer: (draft.questions || []).length > 0,
    };

    if (s.mode === 'organize') {
      await patchTask(s.taskId, { ...common, status: 'open' });
      if (draft.steps.length) {
        await getSupabase()
          .from('task_steps')
          .insert(draft.steps.map((title, i) => ({ task_id: s.taskId, title: title.slice(0, 500), position: 100 + i })));
      }
      return;
    }

    const att = s.attachment;
    const row = {
      id: crypto.randomUUID(),
      workspace_id: workspaceId,
      status: 'open',
      ...common,
      source_kind: att ? att.source : 'text',
      source_text: (s.note || (att?.kind === 'text' ? att.text : '') || '').slice(0, 24000) || null,
    };
    setText('');
    clearAttachment();
    setTab('open');
    await insertTask(row, draft.steps, att, keepFile);
  }

  // ---- task actions ----
  function markDone(task) {
    setDetailId(null);
    patchTask(task.id, { status: 'done', completed_at: new Date().toISOString(), snoozed_until: null });
    setCelebrate(true);
    setJustDone(task.id);
  }
  const reopen = (task) => patchTask(task.id, { status: 'open', completed_at: null });
  const archive = (id) => {
    setDetailId(null);
    patchTask(id, { archived_at: new Date().toISOString() });
  };
  const remove = (id) => {
    setDetailId(null);
    patchTask(id, { deleted_at: new Date().toISOString() });
  };
  const snooze = (id, kind) => {
    patchTask(id, { snoozed_until: snoozeTime(kind) });
    setSnoozing(null);
  };

  function toggleLang() {
    const next = lang === 'en' ? 'he' : 'en';
    setLang(next);
    writeLocal('taskai.lang', next);
    if (userId) getSupabase().from('profiles').update({ locale: next }).eq('id', userId).then(() => {});
  }

  async function signOut() {
    setSettingsOpen(false);
    await getSupabase().auth.signOut();
    setTasks([]);
  }

  // ---- what the list shows ----
  const query = attachment ? '' : text.trim().toLowerCase();
  const fmt = useMemo(
    () => new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' }),
    [lang],
  );
  const openTasks = tasks.filter((x) => x.status !== 'done');
  const doneTasks = tasks.filter((x) => x.status === 'done');
  const isSnoozed = (x) => x.snoozed_until && Date.parse(x.snoozed_until) > now;
  const shown = (tab === 'open' ? [...openTasks.filter((x) => !isSnoozed(x)), ...openTasks.filter(isSnoozed)] : doneTasks).filter(
    (x) => !query || x.title.toLowerCase().includes(query),
  );
  const detailTask = detailId ? tasks.find((x) => x.id === detailId) : null;
  const hasInput = !!(text.trim() || attachment);

  function rowMeta(task, done) {
    const chips = [];
    if (task.status === 'inbox') chips.push({ key: 'inbox', label: t.inbox, tone: 'inbox' });
    if (task.needs_answer) chips.push({ key: 'q', label: '?', tone: 'warn' });
    if (task.due_at) {
      const late = !done && Date.parse(task.due_at) < now;
      chips.push({ key: 'due', label: dueLabel(task.due_at, task.due_has_time, lang), tone: late ? 'late' : '' });
    }
    if (task.kind === 'checklist') chips.push({ key: 'kind', label: `☑ ${t.checklist}` });
    if (task.kind === 'stages') chips.push({ key: 'kind', label: `⇢ ${t.stages}` });
    if (['screenshot', 'photo'].includes(task.source_kind)) chips.push({ key: 'src', label: '🖼' });
    if (task.source_kind === 'document') chips.push({ key: 'src', label: '📄' });
    const snoozed = !done && isSnoozed(task);
    if (snoozed) chips.push({ key: 'snz', label: `${t.snooze} · ${fmt.format(new Date(task.snoozed_until))}`, tone: 'warn' });
    return { chips, snoozed };
  }

  // ---- screens ----
  if (session === undefined) return <div className="splash" />;
  if (!session) return <Login t={t} onToggleLang={toggleLang} />;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo-mark" aria-hidden="true">
            <LogoIcon />
          </span>
          <span className="brand-name">TaskAI</span>
        </div>
        <div className="topbar-actions">
          <button type="button" className="icon-top" aria-label={t.camera} title={t.camera} onClick={() => cameraRef.current?.click()}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 8h3l2-2.5h6L17 8h3v11H4z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              <circle cx="12" cy="13" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
            </svg>
          </button>
          <button type="button" className="icon-top" aria-label={t.attach} title={t.attach} onClick={() => fileRef.current?.click()}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M16.5 7.5l-7 7a2.5 2.5 0 003.5 3.5l7.5-7.5a4.5 4.5 0 00-6.4-6.4L6.4 11.8a6.5 6.5 0 009.2 9.2l5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
          <button type="button" className="icon-top" aria-label={t.settings} title={t.settings} onClick={() => setSettingsOpen(true)}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="5" r="1.8" fill="currentColor" />
              <circle cx="12" cy="12" r="1.8" fill="currentColor" />
              <circle cx="12" cy="19" r="1.8" fill="currentColor" />
            </svg>
          </button>
        </div>
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) attach(f, 'photo');
          }}
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf,text/plain,.txt,.md,.csv"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) attach(f, 'screenshot');
          }}
        />
      </header>

      <div className="capture">
        {attachment && (
          <div className="attachment">
            {attachment.previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={attachment.previewUrl} alt="" />
            ) : (
              <span className="file-badge">📄</span>
            )}
            <span className="attachment-name">{attachment.name}</span>
            <button type="button" className="icon-btn" aria-label={t.removeAttachment} onClick={clearAttachment}>
              ×
            </button>
          </div>
        )}
        <form
          className="addbar"
          onSubmit={(e) => {
            e.preventDefault();
            if (!hasInput || aiBusy) return;
            if (ai?.hasKey) understand();
            else organizeLater();
          }}
        >
          <input
            ref={inputRef}
            value={text}
            dir={textDir(text) === 'auto' ? undefined : textDir(text)}
            onChange={(e) => setText(e.target.value)}
            placeholder={t.addPlaceholder}
            aria-label={t.addPlaceholder}
            enterKeyHint="send"
          />
          <button type="submit" className="send" aria-label={t.add} disabled={!hasInput || aiBusy}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 19V5M5 12l7-7 7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </form>
        {hasInput && !aiBusy && (
          <div className="capture-choices">
            <button type="button" className="choice primary-soft" onClick={understand}>
              ✦ {t.letAI}
            </button>
            <button type="button" className="choice" onClick={organizeLater}>
              {t.organizeLater}
            </button>
          </div>
        )}
        {aiBusy && (
          <div className="ai-working" role="status">
            <span className="spinner" aria-hidden="true" /> {t.aiReading}
          </div>
        )}
      </div>

      {!online && <p className="banner">{t.offline}</p>}
      {error && (
        <button type="button" className="banner error" onClick={() => setError('')}>
          {error}
        </button>
      )}

      <nav className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'open'} className={tab === 'open' ? 'active' : ''} onClick={() => setTab('open')}>
          {t.open} ({openTasks.length})
        </button>
        <button type="button" role="tab" aria-selected={tab === 'done'} className={tab === 'done' ? 'active' : ''} onClick={() => setTab('done')}>
          {t.done} ({doneTasks.length})
        </button>
      </nav>

      <ul className="task-list">
        {shown.map((task) => {
          const done = task.status === 'done';
          const actions = done
            ? [
                { key: 'reopen', label: t.reopen, tone: 'neutral', onClick: () => reopen(task) },
                { key: 'archive', label: t.archive, tone: 'calm', onClick: () => archive(task.id) },
                { key: 'delete', label: t.delete, tone: 'danger', onClick: () => remove(task.id) },
              ]
            : [
                { key: 'done', label: t.done, tone: 'good', onClick: () => markDone(task) },
                { key: 'snooze', label: t.snooze, tone: 'warn', onClick: () => setSnoozing(task.id) },
              ];
          return (
            <TaskRow
              key={task.id}
              task={task}
              uiDir={uiDir}
              done={done}
              actions={actions}
              onToggle={() => (done ? reopen(task) : markDone(task))}
              onOpen={() => setDetailId(task.id)}
              meta={rowMeta(task, done)}
            />
          );
        })}
      </ul>

      {shown.length === 0 && <p className="empty">{query ? t.noMatch : tab === 'open' ? t.empty : t.emptyDone}</p>}
      {tab === 'open' && openTasks.length > 0 && openTasks.length < 4 && <p className="hint">{t.swipeHint}</p>}

      {snoozing && (
        <Sheet onClose={() => setSnoozing(null)}>
          <p className="sheet-title">{t.snooze}</p>
          <button type="button" className="sheet-btn" onClick={() => snooze(snoozing, 'hour')}>
            {t.inOneHour}
          </button>
          <button type="button" className="sheet-btn" onClick={() => snooze(snoozing, 'tomorrow')}>
            {t.tomorrow}
          </button>
          <button type="button" className="sheet-btn" onClick={() => snooze(snoozing, 'week')}>
            {t.nextWeek}
          </button>
          <button type="button" className="sheet-btn quiet" onClick={() => setSnoozing(null)}>
            {t.cancel}
          </button>
        </Sheet>
      )}

      {justDone && !celebrate && (
        <Sheet onClose={() => setJustDone(null)}>
          <p className="sheet-title">{t.whatNow}</p>
          <button type="button" className="sheet-btn" onClick={() => { archive(justDone); setJustDone(null); }}>
            {t.archive}
          </button>
          <button type="button" className="sheet-btn danger" onClick={() => { remove(justDone); setJustDone(null); }}>
            {t.delete}
          </button>
          <button type="button" className="sheet-btn quiet" onClick={() => setJustDone(null)}>
            {t.keepIt}
          </button>
        </Sheet>
      )}

      {suggestion && (
        <SuggestionSheet
          key={suggestion.version}
          t={t}
          suggestion={suggestion.data}
          hasFile={suggestion.mode === 'create' && !!suggestion.attachment}
          mode={suggestion.mode}
          busy={aiBusy}
          onSubmit={confirmSuggestion}
          onAnother={suggestAnother}
          onCancel={() => setSuggestion(null)}
        />
      )}

      {detailTask && (
        <TaskDetail
          key={detailTask.id}
          t={t}
          task={detailTask}
          onClose={() => setDetailId(null)}
          patchTask={patchTask}
          onOrganize={organizeWithAI}
          onDone={markDone}
          onArchive={archive}
          onDelete={remove}
        />
      )}

      {settingsOpen && (
        <SettingsSheet
          t={t}
          ai={ai}
          onAIChange={updateAi}
          onToggleLang={toggleLang}
          onSignOut={signOut}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {celebrate && <Celebration onEnd={endCelebrate} />}
    </div>
  );
}
