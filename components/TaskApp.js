'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import { strings, textDir } from '@/lib/i18n';
import Login, { LogoIcon } from './Login';
import TaskRow from './TaskRow';
import Celebration from './Celebration';

// Only the columns the list shows. Never the whole row set, never in a loop.
const COLS = 'id,workspace_id,title,status,priority,due_at,snoozed_until,completed_at,archived_at,deleted_at,created_at,updated_at';

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

function visible(task) {
  return !task.deleted_at && !task.archived_at;
}

export default function TaskApp() {
  const [lang, setLang] = useState('en');
  const [session, setSession] = useState(undefined); // undefined = still checking
  const [workspaceId, setWorkspaceId] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [tab, setTab] = useState('open');
  const [text, setText] = useState('');
  const [online, setOnline] = useState(true);
  const [error, setError] = useState('');
  const [snoozing, setSnoozing] = useState(null); // task id
  const [justDone, setJustDone] = useState(null); // task id waiting for archive/delete
  const [celebrate, setCelebrate] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const t = strings[lang];
  const endCelebrate = useCallback(() => setCelebrate(false), []);
  const uiDir = lang === 'he' ? 'rtl' : 'ltr';

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

  // ---- personal workspace + saved language (one small read each, once) ----
  useEffect(() => {
    if (!userId) {
      setWorkspaceId(null);
      return;
    }
    const cachedWs = readLocal(`taskai.ws.${userId}`, null);
    if (cachedWs) setWorkspaceId(cachedWs);
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
  }, [userId]);

  // ---- tasks: show the saved copy at once, load once, then live changes only ----
  useEffect(() => {
    if (!workspaceId) return;
    const cacheKey = `taskai.tasks.${workspaceId}`;
    setTasks(readLocal(cacheKey, []));
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
          if (navigator.onLine) setError(t.error);
          return;
        }
        setTasks(data);
      });

    const channel = supabase
      .channel(`tasks-${workspaceId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tasks', filter: `workspace_id=eq.${workspaceId}` },
        (payload) => {
          setTasks((prev) => {
            if (payload.eventType === 'DELETE') return prev.filter((x) => x.id !== payload.old.id);
            const row = payload.new;
            if (!visible(row)) return prev.filter((x) => x.id !== row.id);
            const i = prev.findIndex((x) => x.id === row.id);
            if (i === -1) return [row, ...prev];
            const next = prev.slice();
            next[i] = { ...prev[i], ...row };
            return next;
          });
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
    // t.error only changes with language; no need to refetch for it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  // keep the saved copy current for instant start and offline viewing
  useEffect(() => {
    if (workspaceId) writeLocal(`taskai.tasks.${workspaceId}`, tasks);
  }, [tasks, workspaceId]);

  // ---- writes: change one row, ask for nothing back ----
  const patchTask = useCallback(async (id, patch) => {
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
    if (err && before) {
      setError(t.error);
      setTasks((prev) => [before, ...prev.filter((x) => x.id !== id)]);
    }
  }, [t.error]);

  async function addTask() {
    const title = text.trim();
    if (!title || !workspaceId) return;
    const row = {
      id: crypto.randomUUID(),
      workspace_id: workspaceId,
      title: title.slice(0, 500),
      status: 'open',
      created_at: new Date().toISOString(),
    };
    setText('');
    setTab('open');
    setTasks((prev) => [row, ...prev]);
    const { error: err } = await getSupabase()
      .from('tasks')
      .insert({ id: row.id, workspace_id: row.workspace_id, title: row.title });
    if (err) {
      setError(t.error);
      setTasks((prev) => prev.filter((x) => x.id !== row.id));
      setText(title);
    }
  }

  function markDone(task) {
    patchTask(task.id, { status: 'done', completed_at: new Date().toISOString(), snoozed_until: null });
    setCelebrate(true);
    setJustDone(task.id);
  }
  function reopen(task) {
    patchTask(task.id, { status: 'open', completed_at: null });
  }
  function archive(id) {
    patchTask(id, { archived_at: new Date().toISOString() });
  }
  function remove(id) {
    patchTask(id, { deleted_at: new Date().toISOString() });
  }
  function snooze(id, kind) {
    patchTask(id, { snoozed_until: snoozeTime(kind) });
    setSnoozing(null);
  }

  function toggleLang() {
    const next = lang === 'en' ? 'he' : 'en';
    setLang(next);
    writeLocal('taskai.lang', next);
    if (userId) getSupabase().from('profiles').update({ locale: next }).eq('id', userId).then(() => {});
  }

  async function signOut() {
    await getSupabase().auth.signOut();
    setTasks([]);
  }

  // ---- what the list shows ----
  const query = text.trim().toLowerCase();
  const fmt = useMemo(
    () => new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' }),
    [lang],
  );
  const openTasks = tasks.filter((x) => x.status !== 'done');
  const doneTasks = tasks.filter((x) => x.status === 'done');
  const isSnoozed = (x) => x.snoozed_until && Date.parse(x.snoozed_until) > now;
  const shown = (tab === 'open'
    ? [...openTasks.filter((x) => !isSnoozed(x)), ...openTasks.filter(isSnoozed)]
    : doneTasks
  ).filter((x) => !query || x.title.toLowerCase().includes(query));

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
          <button type="button" className="link-button on-dark" onClick={toggleLang}>
            {t.language}
          </button>
          <button type="button" className="link-button on-dark" onClick={signOut}>
            {t.signOut}
          </button>
        </div>
      </header>

      <form
        className="addbar"
        onSubmit={(e) => {
          e.preventDefault();
          addTask();
        }}
      >
        <input
          value={text}
          dir={textDir(text) === 'auto' ? undefined : textDir(text)}
          onChange={(e) => setText(e.target.value)}
          placeholder={t.addPlaceholder}
          aria-label={t.addPlaceholder}
          enterKeyHint="send"
        />
        <button type="submit" className="send" aria-label={t.add} disabled={!text.trim()}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 19V5M5 12l7-7 7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </form>

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
              snoozedLabel={!done && isSnoozed(task) ? `${t.snooze} · ${fmt.format(new Date(task.snoozed_until))}` : ''}
            />
          );
        })}
      </ul>

      {shown.length === 0 && (
        <p className="empty">{query ? t.noMatch : tab === 'open' ? t.empty : t.emptyDone}</p>
      )}
      {tab === 'open' && openTasks.length > 0 && openTasks.length < 4 && <p className="hint">{t.swipeHint}</p>}

      {snoozing && (
        <Sheet onClose={() => setSnoozing(null)}>
          <p className="sheet-title">{t.snooze}</p>
          <button type="button" className="sheet-btn" onClick={() => snooze(snoozing, 'hour')}>{t.inOneHour}</button>
          <button type="button" className="sheet-btn" onClick={() => snooze(snoozing, 'tomorrow')}>{t.tomorrow}</button>
          <button type="button" className="sheet-btn" onClick={() => snooze(snoozing, 'week')}>{t.nextWeek}</button>
          <button type="button" className="sheet-btn quiet" onClick={() => setSnoozing(null)}>{t.cancel}</button>
        </Sheet>
      )}

      {justDone && !celebrate && (
        <Sheet onClose={() => setJustDone(null)}>
          <p className="sheet-title">{t.whatNow}</p>
          <button type="button" className="sheet-btn" onClick={() => { archive(justDone); setJustDone(null); }}>{t.archive}</button>
          <button type="button" className="sheet-btn danger" onClick={() => { remove(justDone); setJustDone(null); }}>{t.delete}</button>
          <button type="button" className="sheet-btn quiet" onClick={() => setJustDone(null)}>{t.keepIt}</button>
        </Sheet>
      )}

      {celebrate && <Celebration onEnd={endCelebrate} />}
    </div>
  );
}

function Sheet({ children, onClose }) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
