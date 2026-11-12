'use client';

import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import { textDir } from '@/lib/i18n';
import Sheet from './Sheet';

// What the assistant knows about the user: people, work, preferences. The user can add, edit and delete.
export default function MemorySheet({ t, onClose }) {
  const [facts, setFacts] = useState(null);
  const [editing, setEditing] = useState(null); // id | 'new'
  const [subject, setSubject] = useState('');
  const [fact, setFact] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    getSupabase()
      .from('memory_facts')
      .select('id,subject,fact,updated_at')
      .order('updated_at', { ascending: false })
      .limit(200)
      .then(({ data, error: err }) => {
        if (err) setError(err.message);
        setFacts(data || []);
      });
  }, []);

  function startEdit(f) {
    setEditing(f ? f.id : 'new');
    setSubject(f?.subject || '');
    setFact(f?.fact || '');
  }

  async function save() {
    const row = { subject: subject.trim().slice(0, 120) || null, fact: fact.trim().slice(0, 2000) };
    if (!row.fact) return;
    const supabase = getSupabase();
    if (editing === 'new') {
      const id = crypto.randomUUID();
      setFacts((prev) => [{ id, ...row }, ...(prev || [])]);
      setEditing(null);
      const { error: err } = await supabase.from('memory_facts').insert({ id, ...row, category: 'other', confirmed: true, source: 'settings' });
      if (err) {
        setError(err.message);
        setFacts((prev) => prev.filter((x) => x.id !== id));
      }
    } else {
      const id = editing;
      setFacts((prev) => prev.map((x) => (x.id === id ? { ...x, ...row } : x)));
      setEditing(null);
      const { error: err } = await supabase.from('memory_facts').update({ ...row, confirmed: true }).eq('id', id);
      if (err) setError(err.message);
    }
  }

  async function remove(id) {
    setFacts((prev) => prev.filter((x) => x.id !== id));
    setEditing(null);
    await getSupabase().from('memory_facts').delete().eq('id', id);
  }

  const form = (
    <form
      className="memory-form"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <input value={subject} dir={textDir(subject)} onChange={(e) => setSubject(e.target.value)} placeholder={t.memSubjectPh} maxLength={120} aria-label={t.memSubject} />
      <textarea value={fact} dir={textDir(fact)} onChange={(e) => setFact(e.target.value)} placeholder={t.memFactPh} maxLength={2000} rows={2} aria-label={t.memFact} autoFocus />
      <div className="sheet-row">
        {editing !== 'new' && (
          <button type="button" className="sheet-btn danger" onClick={() => remove(editing)}>
            {t.delete}
          </button>
        )}
        <button type="button" className="sheet-btn quiet" onClick={() => setEditing(null)}>
          {t.cancel}
        </button>
        <button type="submit" className="sheet-btn good" disabled={!fact.trim()}>
          {t.save}
        </button>
      </div>
    </form>
  );

  return (
    <Sheet onClose={onClose} tall>
      <p className="sheet-title">{t.memoryTitle}</p>
      <p className="sheet-sub">{t.memoryHelp}</p>
      {error && <p className="error">{error}</p>}
      {editing === 'new' ? (
        form
      ) : (
        <button type="button" className="sheet-btn good" onClick={() => startEdit(null)}>
          + {t.memAdd}
        </button>
      )}
      {facts === null && <p className="sheet-sub">…</p>}
      {facts?.length === 0 && editing !== 'new' && <p className="sheet-sub">{t.memEmpty}</p>}
      <ul className="memory-list">
        {facts?.map((f) =>
          editing === f.id ? (
            <li key={f.id}>{form}</li>
          ) : (
            <li key={f.id}>
              <button type="button" onClick={() => startEdit(f)}>
                {f.subject && (
                  <strong dir={textDir(f.subject)}>{f.subject}</strong>
                )}
                <span dir={textDir(f.fact)}>{f.fact}</span>
              </button>
            </li>
          ),
        )}
      </ul>
    </Sheet>
  );
}
