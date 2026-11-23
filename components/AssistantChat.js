'use client';

import { useEffect, useRef, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import { textDir, localeOf } from '@/lib/i18n';
import { callAI, localNow, timeZone } from '@/lib/ai';
import { prepareFile } from '@/lib/media';
import { dueLabel, partsToDue } from '@/lib/dates';
import { useRecorder, blobToBase64, clock } from '@/lib/voice';
import Icon from './Icon';

const CHAT_CACHE = 'taskai.chat';

function readCache() {
  try {
    return JSON.parse(localStorage.getItem(CHAT_CACHE) || '[]');
  } catch {
    return [];
  }
}
function writeCache(list) {
  try {
    localStorage.setItem(CHAT_CACHE, JSON.stringify(list.slice(-60).map(({ previewUrl, ...m }) => m)));
  } catch {
    /* ignore */
  }
}

function buildCapture(text, att) {
  const c = { now: localNow(), timeZone: timeZone() };
  if (text) c.text = text;
  if (att?.kind === 'image') c.image = { data: att.base64, mime: att.mime };
  if (att?.kind === 'pdf') c.file = { data: att.base64, mime: 'application/pdf', name: att.name };
  if (att?.kind === 'text') {
    c.fileText = att.text;
    c.fileName = att.name;
  }
  return c;
}

// The AI assistant as a WhatsApp-style conversation. It asks one question at a time
// with tap answers and a date picker, and saves or links tasks.
export default function AssistantChat({ t, lang, ai, pending, onPendingUsed, applyActions, uploadFile, onOpenTask, onOpenSettings, onBack, onLastMessage }) {
  const [messages, setMessages] = useState(() => readCache());
  const [text, setText] = useState('');
  const [attachment, setAttachment] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [keepOffer, setKeepOffer] = useState(null); // { att, tasks: [{id,title}] }
  const [menuOpen, setMenuOpen] = useState(false);
  const flowAtt = useRef(null); // the file being discussed, until a task is saved from it
  const scrollRef = useRef(null);
  const fileRef = useRef(null);
  const cameraRef = useRef(null);
  const inputRef = useRef(null);
  const voice = useRecorder();
  const [hearing, setHearing] = useState(false);
  const [editing, setEditing] = useState(null); // the user's own message being corrected

  // load the recent conversation once
  useEffect(() => {
    getSupabase()
      .from('chat_messages')
      .select('id,role,content,meta,created_at')
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data }) => {
        if (!data) return;
        const list = data.reverse();
        setMessages((prev) => {
          const ids = new Set(list.map((m) => m.id));
          const merged = [...list, ...prev.filter((m) => !ids.has(m.id) && (m.previewUrl || m.meta?.pending))];
          writeCache(merged);
          return merged;
        });
      });
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    const last = messages.at(-1);
    if (last) onLastMessage?.(last);
  }, [messages, busy, keepOffer, onLastMessage]);

  // a message started from the home screen's bar
  useEffect(() => {
    if (!pending) return;
    onPendingUsed();
    if (pending.voice) startVoice();
    else send(pending.text, { attachment: pending.attachment, mode: pending.mode });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  function push(msg) {
    setMessages((prev) => {
      const next = [...prev, msg];
      writeCache(next);
      return next;
    });
  }

  async function startVoice() {
    if (!ai?.hasKey) {
      setError(t.needAI);
      onOpenSettings();
      return;
    }
    setError('');
    try {
      await voice.start();
    } catch {
      setError(t.micBlocked);
    }
  }

  async function finishVoice() {
    const rec = await voice.stop();
    if (!rec) return;
    if (rec.seconds < 1) return;
    setHearing(true);
    try {
      const res = await callAI({ action: 'transcribe', audio: { data: await blobToBase64(rec.blob), mime: rec.mime }, language: lang });
      const said = (res.text || '').trim();
      if (!said) setError(t.heardNothing);
      else {
        setHearing(false);
        await send(said, { voice: true });
      }
    } catch (e) {
      setError(e.message || t.error);
    } finally {
      setHearing(false);
    }
  }

  // Correct a message already sent: the bubble changes, and the assistant fixes what it saved from it.
  async function sendEdit() {
    const msg = editing;
    const next = text.trim();
    setEditing(null);
    setText('');
    if (!msg || !next || next === msg.content || busy) return;
    setMessages((prev) => {
      const list = prev.map((m) => (m.id === msg.id ? { ...m, content: next, meta: { ...m.meta, edited: true } } : m));
      writeCache(list);
      return list;
    });
    getSupabase().from('chat_messages').update({ content: next.slice(0, 24000), meta: { ...(msg.meta || {}), edited: true } }).eq('id', msg.id).then(() => {});
    setBusy(true);
    try {
      const note = `[I edited my earlier message. Before: "${msg.content}". Now: "${next}". Update or fix whatever you saved from it; do not create a duplicate.]`;
      const reply = await callAI({ action: 'chat', capture: buildCapture(note, null), lang });
      const saved = await applyActions(reply.actions || []);
      const botMsg = { id: crypto.randomUUID(), role: 'assistant', content: reply.message || (saved.length ? t.updated : '…'), meta: { question: reply.question || null, saved }, created_at: new Date().toISOString() };
      push(botMsg);
      await getSupabase().from('chat_messages').insert({ id: botMsg.id, role: 'assistant', content: botMsg.content.slice(0, 24000), meta: botMsg.meta });
    } catch (e) {
      setError(e.message || t.error);
    } finally {
      setBusy(false);
    }
  }

  async function send(raw, { answer, attachment: att, mode, voice: isVoice } = {}) {
    const shown = (raw || '').trim();
    const a = att ?? attachment;
    if ((!shown && !a) || busy) return;
    if (!ai?.hasKey) {
      setError(t.needAI);
      onOpenSettings();
      return;
    }
    setError('');
    setText('');
    setAttachment(null);
    setDate('');
    setTime('');
    const userMsg = {
      id: crypto.randomUUID(),
      role: 'user',
      content: shown,
      meta: { ...(answer && answer !== shown ? { answer } : {}), ...(a ? { attachment: { name: a.name, kind: a.kind } } : {}), ...(isVoice ? { voice: true } : {}), ...(mode ? { mode } : {}) },
      created_at: new Date().toISOString(),
      previewUrl: a?.previewUrl,
    };
    userMsg.meta.pending = true;
    push(userMsg);
    setBusy(true);
    try {
      const forAI = answer && answer !== shown ? `${shown} [${answer}]` : shown;
      const reply = await callAI({ action: 'chat', capture: buildCapture(forAI, a), lang, ...(mode ? { mode } : {}), ...(isVoice ? { voice: true } : {}) });
      const saved = await applyActions(reply.actions || []);
      const botMsg = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: reply.message || (saved.length ? t.saved : '…'),
        meta: { question: reply.question || null, saved },
        created_at: new Date().toISOString(),
      };
      push(botMsg);
      const supabase = getSupabase();
      const { pending: _p, ...userMeta } = userMsg.meta;
      userMsg.meta = userMeta;
      await supabase.from('chat_messages').insert({ id: userMsg.id, role: 'user', content: userMsg.content.slice(0, 24000), meta: userMeta });
      await supabase.from('chat_messages').insert({ id: botMsg.id, role: 'assistant', content: botMsg.content.slice(0, 24000), meta: botMsg.meta });
      if (a) flowAtt.current = a;
      const created = saved.filter((s) => s.kind === 'created');
      if (flowAtt.current && created.length) {
        setKeepOffer({ att: flowAtt.current, tasks: created });
        flowAtt.current = null;
      }
    } catch (e) {
      setError(e.message || t.error);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  async function keepFile(yes) {
    const offer = keepOffer;
    setKeepOffer(null);
    if (!yes || !offer) return;
    try {
      await uploadFile(offer.att, offer.tasks[0].id);
      push({ id: crypto.randomUUID(), role: 'assistant', content: t.fileKept, meta: { local: true }, created_at: new Date().toISOString() });
    } catch (e) {
      setError(e.message || t.error);
    }
  }

  async function attach(file, source) {
    try {
      setAttachment(await prepareFile(file, source));
      inputRef.current?.focus();
    } catch (e) {
      setError(e.message);
    }
  }

  async function clearChat() {
    setMenuOpen(false);
    setMessages([]);
    writeCache([]);
    const ids = messages.filter((m) => m.role).map((m) => m.id);
    if (ids.length) await getSupabase().from('chat_messages').delete().in('id', ids);
  }

  const fmtTime = new Intl.DateTimeFormat(localeOf(lang), { hour: '2-digit', minute: '2-digit' });
  const last = messages.at(-1);
  const question = !busy && last?.role === 'assistant' ? last.meta?.question : null;

  return (
    <div className="convo">
      <header className="convo-bar">
        {onBack && (
          <button type="button" className="icon-top" aria-label={t.back} onClick={onBack}>
            <svg viewBox="0 0 24 24" aria-hidden="true" className="flip-rtl">
              <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        <span className="avatar ai" aria-hidden="true">
          <Icon name="sparkle" size={22} />
        </span>
        <div className="convo-title">
          <strong>{t.assistant}</strong>
          <small>{busy ? t.aiReading : ai?.hasKey ? `AI · ${{ openai: 'OpenAI', gemini: 'Gemini', claude: 'Claude' }[ai.provider] || ''}` : t.notConnected}</small>
        </div>
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
              <button type="button" role="menuitem" onClick={clearChat}>
                {t.clearChat}
              </button>
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onOpenSettings(); }}>
                {t.settings}
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="convo-body wallpaper" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="bubble in">
            <span dir={textDir(t.chatWelcome)}>{t.chatWelcome}</span>
          </div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`bubble ${m.role === 'user' ? 'out' : 'in'}${m.role === 'user' && m.content && !m.meta?.pending && !m.meta?.voice ? ' mine' : ''}`}
            title={m.role === 'user' ? t.edit : undefined}
            onClick={
              m.role === 'user' && m.content && !m.meta?.pending && !m.meta?.voice && !busy
                ? () => {
                    setEditing(m);
                    setText(m.content);
                    setTimeout(() => inputRef.current?.focus(), 0);
                  }
                : undefined
            }
          >
            {m.previewUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="bubble-img" src={m.previewUrl} alt="" />
            )}
            {!m.previewUrl && m.meta?.attachment && (
              <span className="bubble-file inline-ico">
                <Icon name="clip" size={14} /> {m.meta.attachment.name}
              </span>
            )}
            {m.meta?.voice && (
              <span className="bubble-voice inline-ico">
                <Icon name="mic" size={14} /> {t.voiceMessage}
              </span>
            )}
            {m.meta?.mode === 'note' && (
              <span className="bubble-voice inline-ico">
                <Icon name="note" size={14} /> {t.note}
              </span>
            )}
            {m.content && (
              <span className="bubble-text" dir={textDir(m.content)}>
                {m.content}
              </span>
            )}
            {m.role === 'assistant' && m.meta?.question?.title && !/[?？]\s*$/.test(m.content) && (
              <span className="bubble-q" dir={textDir(m.meta.question.title)}>
                {m.meta.question.title}
              </span>
            )}
            {m.meta?.saved?.length > 0 && (
              <span className="saved-list">
                {m.meta.saved.map((s) => (
                  <button key={`${s.id}-${s.kind}`} type="button" className="saved-chip" onClick={() => onOpenTask(s.id)}>
                    <Icon name={s.note ? 'note' : s.kind === 'created' ? 'check' : 'edit'} size={14} /> {s.note ? t.noteSaved : s.kind === 'created' ? t.saved : t.updated} · <span dir={textDir(s.title)}>{s.title}</span>
                  </button>
                ))}
              </span>
            )}
            <span className="bubble-time">
              {m.meta?.edited && <span className="bubble-edited">{t.edited} · </span>}
              {fmtTime.format(new Date(m.created_at))}
            </span>
          </div>
        ))}
      {question && (question.options?.length > 0 || question.allow_date) && (
          <div className="quick-replies in-body">
            {question.options?.map((o, i) => (
              <button key={i} type="button" className="option" dir={textDir(o.label)} onClick={() => send(o.label, { answer: o.value })}>
                {o.label}
              </button>
            ))}
            {question.allow_date && (
              <form
                className="date-answer"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (date) send(`📅 ${dueLabel(partsToDue(date, time).due_at, !!time, lang)}`, { answer: `Date: ${date}${time ? ` ${time}` : ''}` });
                }}
              >
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label={t.due} />
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label={t.time} />
                <button type="submit" className="option strong" disabled={!date}>
                  {t.setDate}
                </button>
              </form>
            )}
          </div>
        )}
        {hearing && (
          <div className="bubble out">
            <span className="bubble-voice inline-ico">
              <Icon name="mic" size={14} /> {t.transcribing}
            </span>
          </div>
        )}
        {busy && (
          <div className="bubble in typing" aria-label={t.aiReading}>
            <span />
            <span />
            <span />
          </div>
        )}
        {keepOffer && (
          <div className="bubble in">
            <span className="bubble-text">{t.keepFile}</span>
            <span className="options">
              <button type="button" className="option" onClick={() => keepFile(true)}>
                {t.yes}
              </button>
              <button type="button" className="option" onClick={() => keepFile(false)}>
                {t.no}
              </button>
            </span>
          </div>
        )}
      </div>

      {error && (
        <button type="button" className="banner error" onClick={() => setError('')}>
          {error}
        </button>
      )}

      {attachment && (
        <div className="attachment in-chat">
          {attachment.previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={attachment.previewUrl} alt="" />
          ) : (
            <span className="file-badge">📄</span>
          )}
          <span className="attachment-name">{attachment.name}</span>
          <button type="button" className="icon-btn" aria-label={t.removeAttachment} onClick={() => setAttachment(null)}>
            ×
          </button>
        </div>
      )}

      {editing && (
        <div className="edit-bar">
          <Icon name="edit" size={16} />
          <span dir={textDir(editing.content)}>
            {t.editing}: {editing.content}
          </span>
          <button type="button" className="icon-btn" aria-label={t.cancel} onClick={() => { setEditing(null); setText(''); }}>
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          if (editing) sendEdit();
          else send(text);
        }}
      >
        {voice.recording ? (
          <div className="composer-box recording">
            <button type="button" className="icon-in" aria-label={t.cancel} onClick={voice.cancel}>
              <Icon name="trash" size={21} />
            </button>
            <span className="rec-dot" aria-hidden="true" />
            <span className="rec-time">{clock(voice.seconds)}</span>
            <span className="rec-hint">{t.recording}</span>
          </div>
        ) : (
          <div className="composer-box">
            <button type="button" className="icon-in" aria-label={t.attach} title={t.attach} onClick={() => fileRef.current?.click()}>
              <Icon name="plus" size={23} strokeWidth={2} />
            </button>
            <input
              ref={inputRef}
              value={text}
              dir={textDir(text) === 'auto' ? undefined : textDir(text)}
              placeholder={t.typeMessage}
              aria-label={t.typeMessage}
              onChange={(e) => setText(e.target.value)}
              onPaste={(e) => {
                for (const it of e.clipboardData?.items || []) {
                  if (it.kind === 'file' && it.type.startsWith('image/')) {
                    const f = it.getAsFile();
                    if (f) {
                      e.preventDefault();
                      attach(f, 'screenshot');
                      return;
                    }
                  }
                }
              }}
              enterKeyHint="send"
            />
            <button type="button" className="icon-in" aria-label={t.camera} onClick={() => cameraRef.current?.click()}>
              <Icon name="camera" size={22} />
            </button>
          </div>
        )}
        {voice.recording ? (
          <button type="button" className="send" aria-label={t.send} onClick={finishVoice}>
            <Icon name="send" size={21} className="flip-rtl" />
          </button>
        ) : !text.trim() && !attachment ? (
          <button type="button" className="send" aria-label={t.recordVoice} title={t.recordVoice} disabled={busy || hearing} onClick={startVoice}>
            <Icon name="mic" size={22} strokeWidth={2} />
          </button>
        ) : (
          <button type="submit" className="send" aria-label={t.send} disabled={busy}>
            <Icon name="send" size={21} className="flip-rtl" />
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/*,application/pdf,text/plain,.txt,.md,.csv" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) attach(f, 'screenshot'); }} />
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) attach(f, 'photo'); }} />
      </form>
    </div>
  );
}
