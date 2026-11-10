import { getSupabase } from './supabase';

// Calls the "ai" Edge Function. Returns the JSON body or throws an Error with a readable message.
export async function callAI(body) {
  const { data, error } = await getSupabase().functions.invoke('ai', { body });
  if (error) {
    let message = error.message || 'Something went wrong.';
    let code;
    try {
      const res = error.context;
      if (res && typeof res.json === 'function') {
        const j = await res.json();
        if (j?.error) message = j.error;
        code = j?.code;
      }
    } catch {
      /* keep the generic message */
    }
    const e = new Error(message);
    e.code = code;
    throw e;
  }
  return data;
}

export function localNow() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return `${days[d.getDay()]} ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function timeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
