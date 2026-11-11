'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import { strings, textDir } from '@/lib/i18n';
import { callAI, timeZone } from '@/lib/ai';
import { prepareFile } from '@/lib/media';
import { dueLabel, partsToDue } from '@/lib/dates';
import { DEFAULT_PREFS, applyPrefs, mergePrefs, prefsToProfile } from '@/lib/prefs';
import { normalizeRule, repeatLabel } from '@/lib/recurrence';
import Login, { LogoIcon } from './Login';
import TaskRow from './TaskRow';
import Celebration from './Celebration';
import Sheet from './Sheet';
import TaskPage from './TaskPage';
import SettingsSheet from './SettingsSheet';
import AssistantChat from './AssistantChat';
import DateSheet from './DateSheet';

// Only the columns the list shows. Never the whole row set, never in a loop.
const COLS =
  'id,workspace_id,title,kind,status,priority,due_at,due_has_time,snoozed_until,needs_answer,source_kind,category,assignee_name,recurrence,occurrence_of,steps_total,steps_done,preview,completed_at,archived_at,deleted_at,created_at,updated_at';
const DEFAULT_CATEGORIES = ['Work', 'Personal', 'Family', 'Home', 'Finance', 'Health', 'Shopping'];

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
const visible = (task) => !task.deleted_at && !task.archived_at;
const safeName = (name) => name.replace(/[^\w.\-]+/g, '_').slice(-80) || 'file';
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export default function TaskApp() {
  const [lang, setLang] = useState('en');
  const [session, setSession] = useState(undefined);
  const [workspaceId, setWorkspaceId] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [archived, setArchived] = useState(null);
  const [filter, setFilter] = useState('all');
  const [text, setText] = useState('');
  const [online, setOnline] = useState(true);
  const [error, setError] = useState('');
  const [justDone, setJustDone] = useState(null);
  const [celebrate, setCelebrate] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [ai, setAi] = useState(null);
  const [view, setView] = useState(null); // {type:'assistant'} | {type:'task', id}
  const [pending, setPending] = useState(null);
  const [dateFor, setDateFor] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  const [alerts, setAlerts] = useState('off');
  const [lastChat, setLastChat] = useState(null);
  const [wide, setWide] = useState(false);
  const cameraRef = useRef(null);
  const fileRef = useRef(null);
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  const t = strings[lang];
  const uiDir = lang === 'he' ? 'rtl' : 'ltr';
  const endCelebrate = useCallback(() => setCelebrate(false), []);
  const userId = session?.user?.id ?? null;

  // ---- language, prefs, layout size ----
  useEffect(() => {
    setLang(readLocal('taskai.lang', 'en') === 'he' ? 'he' : 'en');
    setPrefs({ ...DEFAULT_PREFS, ...readLocal('taskai.prefs', {}) });
    const cached = readLocal('taskai.chat', []);
    if (cached.length) setLastChat(cached.at(-1));
    const a = readLocal('taskai.alerts', 'off');
    if (typeof Notification !== 'undefined') {
      if (a === 'on' && Notification.permission === 'granted') setAlerts('on');
      else if (Notification.permission === 'denied') setAlerts('blocked');
    }
    const mq = window.matchMedia('(min-width: 900px)');
    const onSize = () => setWide(mq.matches);
    onSize();
    mq.addEventListener?.('change', onSize);
    return () => mq.removeEventListener?.('change', onSize);
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = uiDir;
  }, [lang, uiDir]);
  useEffect(() => {
    applyPrefs(prefs);
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq || prefs.theme !== 'system') return undefined;
    const onChange = () => applyPrefs(prefs);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [prefs]);

  function updatePrefs(next) {
    setPrefs(next);
    writeLocal('taskai.prefs', next);
    if (userId) getSupabase().from('profiles').update(prefsToProfile(next)).eq('id', userId).then(() => {});
  }

  // ---- service worker, online state, clock ----
  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') navigator.serviceWorker.register('/sw.js').catch(() => {});
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

  // ---- open / close the right panel; the phone's back button closes it ----
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    const onPop = () => {
      if (viewRef.current) setView(null);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  function openView(v) {
    if (!viewRef.current && !wide) window.history.pushState({ taskai: 'view' }, '');
    setView(v);
  }
  function closeView() {
    if (window.history.state?.taskai === 'view') window.history.back();
    else setView(null);
  }

  // ---- auth ----
  useEffect(() => {
    let supabase;
    try {
      supabase = getSupabase();
    } catch (e) {
      setError(e.message);
      setSession(null);
      return undefined;
    }
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  // ---- workspace, profile, AI connection (small reads, once per sign-in) ----
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
      .select('locale,theme,accent,celebration,remind_minutes,time_zone,prefs')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        if (data.locale && data.locale !== readLocal('taskai.lang', 'en')) {
          setLang(data.locale);
          writeLocal('taskai.lang', data.locale);
        }
        const merged = mergePrefs(data);
        setPrefs(merged);
        writeLocal('taskai.prefs', merged);
        const tz = timeZone();
        if (tz && tz !== data.time_zone) supabase.from('profiles').update({ time_zone: tz }).eq('id', userId).then(() => {});
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

  // ---- tasks: saved copy at once, one load, then only live changes ----
  useEffect(() => {
    if (!workspaceId) return undefined;
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
          const slim = Object.fromEntries(COLS.split(',').map((k) => [k, row[k]]));
          const i = prev.findIndex((x) => x.id === row.id);
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

  // archived tasks load only when that filter is opened
  useEffect(() => {
    if (filter !== 'archived' || !workspaceId) return;
    getSupabase()
      .from('tasks')
      .select(COLS)
      .eq('workspace_id', workspaceId)
      .is('deleted_at', null)
      .not('archived_at', 'is', null)
      .order('archived_at', { ascending: false })
      .limit(100)
      .then(({ data }) => setArchived(data || []));
  }, [filter, workspaceId]);

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
      setArchived((prev) => (prev ? prev.map((x) => (x.id === id ? { ...x, ...patch } : x)).filter((x) => x.archived_at && !x.deleted_at) : prev));
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

  // Apply what the assistant decided. Returns [{id, title, kind: 'created'|'updated'}].
  async function applyChatActions(actions) {
    const supabase = getSupabase();
    const refs = {};
    const saved = [];
    const titleOf = (id) => tasksRef.current.find((x) => x.id === id)?.title || saved.find((s) => s.id === id)?.title || '';
    const mark = (id) => {
      if (!saved.some((s) => s.id === id)) saved.push({ id, title: titleOf(id), kind: 'updated' });
    };
    for (const a of actions) {
      try {
        if (a.type === 'create_task') {
          const id = crypto.randomUUID();
          refs[a.ref] = id;
          const row = {
            id,
            workspace_id: workspaceId,
            title: String(a.title).slice(0, 500),
            kind: a.kind || 'single',
            status: 'open',
            priority: a.priority || 0,
            ...partsToDue(a.due, a.time),
            category: a.category || null,
            recurrence: normalizeRule(a.repeat),
            details: [a.details, a.person ? `${t.person}: ${a.person}` : ''].filter(Boolean).join('\n\n').slice(0, 10000) || null,
            source_kind: 'chat',
          };
          setTasks((prev) => [{ ...row, details: undefined, steps_total: a.steps?.length || 0, steps_done: 0, created_at: new Date().toISOString() }, ...prev]);
          const { error: err } = await supabase.from('tasks').insert(row);
          if (err) throw err;
          if (a.steps?.length) {
            await supabase.from('task_steps').insert(a.steps.map((title, i) => ({ task_id: id, title: String(title).slice(0, 500), position: i + 1 })));
          }
          saved.push({ id, title: row.title, kind: 'created' });
          continue;
        }
        const id = refs[a.task_id] || a.task_id;
        switch (a.type) {
          case 'add_step':
            await supabase.from('task_steps').insert({ task_id: id, title: String(a.title).slice(0, 500), position: Date.now() / 1000 });
            break;
          case 'add_update':
            await supabase.from('comments').insert({ task_id: id, kind: 'update', body: String(a.text).slice(0, 4000) });
            break;
          case 'set_due':
            await patchTask(id, partsToDue(a.due, a.time));
            break;
          case 'set_repeat':
            await patchTask(id, { recurrence: normalizeRule(a.repeat) });
            break;
          case 'set_category':
            await patchTask(id, { category: String(a.category).slice(0, 100) });
            break;
          case 'assign':
            await patchTask(id, { assignee_name: String(a.person).slice(0, 100) });
            break;
          case 'complete':
            await patchTask(id, { status: 'done', completed_at: new Date().toISOString() });
            break;
          default:
            continue;
        }
        mark(id);
      } catch (e) {
        setError(e.message || t.error);
      }
    }
    return saved;
  }

  // ---- capture from the home screen ----
  function askAssistant(note, attachment) {
    setText('');
    setPending({ text: note, attachment, at: Date.now() });
    openView({ type: 'assistant' });
  }

  async function saveToInbox() {
    const title = text.trim();
    if (!title || !workspaceId) return;
    const row = { id: crypto.randomUUID(), workspace_id: workspaceId, title: title.slice(0, 500), status: 'inbox', kind: 'single', source_kind: 'text' };
    setText('');
    setFilter('all');
    setTasks((prev) => [{ ...row, steps_total: 0, steps_done: 0, created_at: new Date().toISOString() }, ...prev]);
    const { error: err } = await getSupabase().from('tasks').insert(row);
    if (err) {
      setError(err.message);
      setTasks((prev) => prev.filter((x) => x.id !== row.id));
    }
  }

  async function attachFromHome(file, source) {
    try {
      askAssistant(text.trim(), await prepareFile(file, source));
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    if (!session || view?.type === 'assistant' || settingsOpen) return undefined;
    const onPaste = (e) => {
      for (const it of e.clipboardData?.items || []) {
        if (it.kind === 'file' && it.type.startsWith('image/')) {
          const f = it.getAsFile();
          if (f) {
            e.preventDefault();
            attachFromHome(f, 'screenshot');
            return;
          }
        }
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, view, settingsOpen, text]);

  function organizeWithAI(task, extra) {
    const note = [`${t.organizeAI}:`, task.title, extra?.source_text].filter(Boolean).join('\n');
    askAssistant(note, null);
  }

  // ---- task actions ----
  function markDone(task) {
    patchTask(task.id, { status: 'done', completed_at: new Date().toISOString(), snoozed_until: null });
    setCelebrate(true);
    setJustDone(task.id);
  }
  const reopen = (task) => patchTask(task.id, { status: 'open', completed_at: null });
  function archive(id) {
    if (view?.type === 'task' && view.id === id) closeView();
    patchTask(id, { archived_at: new Date().toISOString() });
  }
  function restore(id) {
    patchTask(id, { archived_at: null });
    const row = archived?.find((x) => x.id === id);
    if (row) setTasks((prev) => [{ ...row, archived_at: null }, ...prev.filter((x) => x.id !== id)]);
  }
  async function reallyDelete(id) {
    setConfirmDel(null);
    if (view?.type === 'task' && view.id === id) closeView();
    setArchived((prev) => (prev ? prev.filter((x) => x.id !== id) : prev));
    await patchTask(id, { deleted_at: new Date().toISOString() });
  }

  // ---- task alerts on this device (while the app is open) ----
  async function setAlertsOn(on) {
    if (!on) {
      setAlerts('off');
      writeLocal('taskai.alerts', 'off');
      return;
    }
    if (typeof Notification === 'undefined') {
      setAlerts('blocked');
      return;
    }
    const perm = await Notification.requestPermission();
    const next = perm === 'granted' ? 'on' : perm === 'denied' ? 'blocked' : 'off';
    setAlerts(next);
    writeLocal('taskai.alerts', next);
  }
  useEffect(() => {
    if (alerts !== 'on') return undefined;
    const check = () => {
      const sent = readLocal('taskai.alerted', {});
      const nowMs = Date.now();
      let changed = false;
      for (const task of tasksRef.current) {
        if (!task.due_at || task.status === 'done') continue;
        if (task.snoozed_until && Date.parse(task.snoozed_until) > nowMs) continue;
        const due = Date.parse(task.due_at);
        const key = `${task.id}:${task.due_at}`;
        if (nowMs >= due - prefs.remindMinutes * 60000 && nowMs < due + 3600000 && !sent[key]) {
          sent[key] = nowMs;
          changed = true;
          navigator.serviceWorker?.ready
            .then((reg) => reg.showNotification(t.reminderTitle, { body: `${task.title}\n${dueLabel(task.due_at, task.due_has_time, lang)}`, tag: key, icon: '/icons/icon-192.png' }))
            .catch(() => {});
        }
      }
      if (changed) {
        for (const k of Object.keys(sent)) if (nowMs - sent[k] > 14 * 86400000) delete sent[k];
        writeLocal('taskai.alerted', sent);
      }
    };
    check();
    const id = setInterval(check, 30000);
    return () => clearInterval(id);
  }, [alerts, prefs.remindMinutes, lang, t.reminderTitle]);

  function toggleLang() {
    const next = lang === 'en' ? 'he' : 'en';
    setLang(next);
    writeLocal('taskai.lang', next);
    if (userId) getSupabase().from('profiles').update({ locale: next }).eq('id', userId).then(() => {});
  }
  async function signOut() {
    setSettingsOpen(false);
    setView(null);
    await getSupabase().auth.signOut();
    setTasks([]);
  }

  // ---- what the list shows ----
  const nowDate = new Date(now);
  const isSnoozed = (x) => x.snoozed_until && Date.parse(x.snoozed_until) > now;
  const isOverdue = (x) => x.status !== 'done' && x.due_at && Date.parse(x.due_at) < now;
  const isToday = (x) => x.due_at && sameDay(new Date(x.due_at), nowDate);
  const sorters = {
    due: (a, b) => (a.due_at ? Date.parse(a.due_at) : Infinity) - (b.due_at ? Date.parse(b.due_at) : Infinity) || Date.parse(b.created_at) - Date.parse(a.created_at),
    newest: (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
    oldest: (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at),
    title: (a, b) => a.title.localeCompare(b.title, lang),
  };
  const sortFn = sorters[prefs.sort] || sorters.due;
  const query = text.trim().toLowerCase();
  const open = tasks.filter((x) => x.status !== 'done');
  const done = tasks.filter((x) => x.status === 'done');
  let shown;
  if (filter === 'done') shown = [...done].sort((a, b) => Date.parse(b.completed_at || b.created_at) - Date.parse(a.completed_at || a.created_at));
  else if (filter === 'archived') shown = archived || [];
  else {
    let base = open;
    if (filter === 'today') base = open.filter(isToday);
    else if (filter === 'overdue') base = open.filter(isOverdue);
    else if (filter === 'inbox') base = open.filter((x) => x.status === 'inbox');
    else if (filter.startsWith('cat:')) base = open.filter((x) => x.category === filter.slice(4));
    shown = [...base.filter((x) => !isSnoozed(x)).sort(sortFn), ...base.filter(isSnoozed).sort(sortFn)];
  }
  if (query) shown = shown.filter((x) => x.title.toLowerCase().includes(query) || (x.category || '').toLowerCase().includes(query));
  const usedCategories = [...new Set(tasks.map((x) => x.category).filter(Boolean))];
  const categories = [...new Set([...usedCategories, ...DEFAULT_CATEGORIES])];
  const people = [...new Set(tasks.map((x) => x.assignee_name).filter(Boolean))];
  const counts = { today: open.filter(isToday).length, overdue: open.filter(isOverdue).length, inbox: open.filter((x) => x.status === 'inbox').length };
  const fmtSnooze = new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const fmtClock = new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
  const detailTask = view?.type === 'task' ? tasks.find((x) => x.id === view.id) || archived?.find((x) => x.id === view.id) : null;
  const dateTask = dateFor ? tasks.find((x) => x.id === dateFor) : null;

  function rowProps(task) {
    const isDone = task.status === 'done';
    let dateLabel = '';
    let dateTone = '';
    if (!isDone && isSnoozed(task)) {
      dateLabel = `💤 ${fmtSnooze.format(new Date(task.snoozed_until))}`;
      dateTone = 'snoozed';
    } else if (task.due_at) {
      dateLabel = dueLabel(task.due_at, task.due_has_time, lang);
      dateTone = isDone ? '' : isOverdue(task) ? 'late' : isToday(task) ? 'today' : '';
    }
    const subParts = [];
    if (task.status === 'in_progress') subParts.push(t.inProgress);
    if (task.steps_total > 0) subParts.push(`☑ ${task.steps_done}/${task.steps_total}`);
    if (task.category) subParts.push(task.category);
    if (task.assignee_name) subParts.push(`👤 ${task.assignee_name}`);
    if (task.preview) subParts.push(task.preview);
    const badges = (
      <>
        {task.recurrence && <span title={repeatLabel(task.recurrence, lang)}>🔁</span>}
        {task.status === 'inbox' && <span className="pill tiny">{t.inbox}</span>}
        {task.needs_answer && <span className="dot-badge">?</span>}
        {task.priority > 0 && !isDone && <span className={`prio-dot p${task.priority}`} />}
      </>
    );
    let actions;
    if (task.archived_at)
      actions = [
        { key: 'restore', label: t.restore, tone: 'neutral', onClick: () => restore(task.id) },
        { key: 'delete', label: t.delete, tone: 'danger', onClick: () => setConfirmDel(task.id) },
      ];
    else if (isDone)
      actions = [
        { key: 'reopen', label: t.reopen, tone: 'neutral', onClick: () => reopen(task) },
        { key: 'archive', label: t.archive, tone: 'calm', onClick: () => archive(task.id) },
        { key: 'delete', label: t.delete, tone: 'danger', onClick: () => setConfirmDel(task.id) },
      ];
    else
      actions = [
        { key: 'done', label: t.done, tone: 'good', onClick: () => markDone(task) },
        { key: 'snooze', label: t.snooze, tone: 'warn', onClick: () => setDateFor(task.id) },
      ];
    return {
      task,
      uiDir,
      done: isDone || !!task.archived_at,
      selected: view?.type === 'task' && view.id === task.id,
      actions,
      dateLabel,
      dateTone,
      subtitle: subParts.join(' · ') || (task.category ?? ''),
      badges,
      onOpen: () => openView({ type: 'task', id: task.id }),
      onDate: () => setDateFor(task.id),
    };
  }

  if (session === undefined) return <div className="splash" />;
  if (!session) return <Login t={t} onToggleLang={toggleLang} />;

  const chips = [
    ['all', t.all],
    ['today', `${t.fToday}${counts.today ? ` ${counts.today}` : ''}`],
    ['overdue', `${t.fOverdue}${counts.overdue ? ` ${counts.overdue}` : ''}`],
    ['inbox', `${t.fInbox}${counts.inbox ? ` ${counts.inbox}` : ''}`],
    ['done', t.fDone],
    ['archived', t.fArchived],
    ...usedCategories.map((c) => [`cat:${c}`, c]),
  ];

  let detail = null;
  if (view?.type === 'assistant')
    detail = (
      <AssistantChat
        t={t}
        lang={lang}
        ai={ai}
        pending={pending}
        onPendingUsed={() => setPending(null)}
        applyActions={applyChatActions}
        uploadFile={uploadFile}
        onOpenTask={(id) => setView({ type: 'task', id })}
        onOpenSettings={() => setSettingsOpen(true)}
        onBack={wide ? null : closeView}
        onLastMessage={setLastChat}
      />
    );
  else if (detailTask)
    detail = (
      <TaskPage
        key={detailTask.id}
        t={t}
        lang={lang}
        task={detailTask}
        categories={categories}
        people={people}
        now={now}
        onClose={closeView}
        patchTask={patchTask}
        onOrganize={organizeWithAI}
        onDone={markDone}
        onArchive={archive}
        onRestore={restore}
        onDelete={(id) => setConfirmDel(id)}
      />
    );

  return (
    <div className={`shell${view ? ' has-view' : ''}`}>
      <section className="list-pane">
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
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) attachFromHome(f, 'photo'); }} />
          <input ref={fileRef} type="file" accept="image/*,application/pdf,text/plain,.txt,.md,.csv" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) attachFromHome(f, 'screenshot'); }} />
        </header>

        <form
          className="searchbar"
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) return;
            if (ai?.hasKey) askAssistant(text.trim(), null);
            else saveToInbox();
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className="search-icon">
            <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M16 16l4.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            value={text}
            dir={textDir(text) === 'auto' ? undefined : textDir(text)}
            onChange={(e) => setText(e.target.value)}
            placeholder={t.addPlaceholder}
            aria-label={t.addPlaceholder}
            enterKeyHint="send"
          />
          {text && (
            <button type="button" className="icon-btn" aria-label={t.cancel} onClick={() => setText('')}>
              ×
            </button>
          )}
        </form>
        {text.trim() && (
          <div className="capture-choices">
            <button type="button" className="choice primary-soft" onClick={() => askAssistant(text.trim(), null)}>
              ✦ {t.askAI}
            </button>
            <button type="button" className="choice" onClick={saveToInbox}>
              + {t.toInbox}
            </button>
          </div>
        )}

        {!online && <p className="banner">{t.offline}</p>}
        {error && (
          <button type="button" className="banner error" onClick={() => setError('')}>
            {error}
          </button>
        )}

        <nav className="chips" aria-label={t.menu}>
          {chips.map(([key, label]) => (
            <button key={key} type="button" className={filter === key ? 'on' : ''} dir={textDir(label)} onClick={() => setFilter(key)}>
              {label}
            </button>
          ))}
        </nav>

        <ul className="wa-list">
          {!query && filter === 'all' && (
            <li className={`wa-row pinned${view?.type === 'assistant' ? ' selected' : ''}`}>
              <button type="button" className="wa-front as-button" onClick={() => openView({ type: 'assistant' })}>
                <span className="avatar ai" aria-hidden="true">
                  ✦
                </span>
                <span className="wa-main">
                  <span className="wa-line">
                    <span className="wa-title">{t.assistant}</span>
                    <span className="wa-date">{lastChat ? fmtClock.format(new Date(lastChat.created_at)) : ''}</span>
                  </span>
                  <span className="wa-line">
                    <span className="wa-sub" dir={textDir(lastChat?.content || t.assistantSub)}>
                      {lastChat?.content || t.assistantSub}
                    </span>
                  </span>
                </span>
              </button>
            </li>
          )}
          {shown.map((task) => (
            <TaskRow key={task.id} {...rowProps(task)} />
          ))}
        </ul>
        {shown.length === 0 && <p className="empty">{query ? `${t.noMatch} ${ai?.hasKey ? t.noMatchAdd : ''}` : filter === 'done' ? t.emptyDone : t.empty}</p>}
        {filter === 'all' && open.length > 0 && open.length < 4 && <p className="hint">{t.swipeHint}</p>}

        <button type="button" className="fab" aria-label={t.assistant} onClick={() => openView({ type: 'assistant' })}>
          ✦
        </button>
      </section>

      <section className="detail-pane">
        {detail || (
          <div className="empty-detail wallpaper">
            <span className="logo-mark large" aria-hidden="true">
              <LogoIcon />
            </span>
            <p>{t.emptyDetail}</p>
          </div>
        )}
      </section>

      {dateTask && (
        <DateSheet
          t={t}
          task={dateTask}
          onClose={() => setDateFor(null)}
          onSave={(patch) => {
            patchTask(dateTask.id, patch);
            setDateFor(null);
          }}
          onSnooze={(iso) => {
            patchTask(dateTask.id, { snoozed_until: iso });
            setDateFor(null);
          }}
        />
      )}

      {justDone && !celebrate && (
        <Sheet onClose={() => setJustDone(null)}>
          <p className="sheet-title">{t.whatNow}</p>
          <button type="button" className="sheet-btn" onClick={() => { archive(justDone); setJustDone(null); }}>
            {t.archive}
          </button>
          <button type="button" className="sheet-btn danger" onClick={() => { setConfirmDel(justDone); setJustDone(null); }}>
            {t.delete}
          </button>
          <button type="button" className="sheet-btn quiet" onClick={() => setJustDone(null)}>
            {t.keepIt}
          </button>
        </Sheet>
      )}

      {confirmDel && (
        <Sheet onClose={() => setConfirmDel(null)}>
          <p className="sheet-title">{t.confirmDelete}</p>
          <p className="sheet-sub">{t.confirmDeleteBody}</p>
          <button type="button" className="sheet-btn danger strong" onClick={() => reallyDelete(confirmDel)}>
            {t.delete}
          </button>
          <button type="button" className="sheet-btn quiet" onClick={() => setConfirmDel(null)}>
            {t.cancel}
          </button>
        </Sheet>
      )}

      {settingsOpen && (
        <SettingsSheet
          t={t}
          lang={lang}
          prefs={prefs}
          onPrefs={updatePrefs}
          onTryCelebration={() => setCelebrate(true)}
          alerts={alerts}
          onAlerts={setAlertsOn}
          ai={ai}
          onAIChange={updateAi}
          onToggleLang={toggleLang}
          onSignOut={signOut}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {celebrate && <Celebration effect={prefs.celebration} direction={prefs.direction} onEnd={endCelebrate} />}
    </div>
  );
}
