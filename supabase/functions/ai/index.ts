// TaskAI "ai" Edge Function
// - Stores each user's AI provider + API key, encrypted (AES-GCM). Keys never go back to the device.
// - Turns text, a screenshot/photo, or a document into ONE task suggestion, using the
//   provider the user chose (OpenAI, Gemini or Claude). Always returns the same JSON shape.
// Auth: the caller's Supabase access token is checked here (deployed with verify_jwt = false).

import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

type Provider = 'openai' | 'gemini' | 'claude';
const PROVIDERS: Provider[] = ['openai', 'gemini', 'claude'];
const DEFAULT_MODELS: Record<Provider, string> = {
  openai: 'gpt-5-mini',
  gemini: 'gemini-3.6-flash',
  claude: 'claude-haiku-5-5',
};
const MAX_B64 = 14_000_000; // ~10 MB file

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---------- encryption ----------
const toB64 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

let keyPromise: Promise<CryptoKey> | null = null;
function encKey() {
  if (!keyPromise) {
    // Optional dedicated secret; otherwise derive a key from the server-only service role key.
    // (If that key is ever rotated, users simply paste their AI key again.)
    const raw = Deno.env.get('TASKAI_ENC_KEY');
    keyPromise = raw
      ? crypto.subtle.importKey('raw', fromB64(raw), 'AES-GCM', false, ['encrypt', 'decrypt'])
      : crypto.subtle
          .importKey('raw', new TextEncoder().encode(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!), 'HKDF', false, ['deriveKey'])
          .then((base) =>
            crypto.subtle.deriveKey(
              { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('taskai'), info: new TextEncoder().encode('ai-provider-keys') },
              base,
              { name: 'AES-GCM', length: 256 },
              false,
              ['encrypt', 'decrypt'],
            ),
          );
  }
  return keyPromise;
}
async function encrypt(text: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encKey(), new TextEncoder().encode(text)));
  return `${toB64(iv)}.${toB64(ct)}`;
}
async function decrypt(blob: string) {
  const [iv, ct] = blob.split('.');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, await encKey(), fromB64(ct));
  return new TextDecoder().decode(pt);
}

// ---------- prompt ----------
const SYSTEM = `You are TaskAI's task organizer. Read the user's input (typed text, a screenshot of a chat or email, a photo of a paper note, or a document) and turn the actionable request into ONE task suggestion.
Rules:
- Write title, steps, summary and questions in the main language of the content (Hebrew stays Hebrew, English stays English).
- title: short, starts with a verb when possible, under 80 characters.
- kind: "single" for one action; "checklist" for a list of items done in any order (shopping, packing, items to check); "stages" for ordered steps where each depends on the one before.
- steps: [] for "single"; the items for "checklist"; the ordered stages for "stages". At most 20, each under 120 characters.
- due_date: "YYYY-MM-DD" when a date or relative day is stated or clearly implied, resolved against the current date given; otherwise null.
- due_time: "HH:MM" (24h) only when a time is stated; otherwise null.
- priority: 0 none, 1 low, 2 medium, 3 high. Use 3 only for explicit urgency.
- person: the sender, customer, supplier or other person involved, if identifiable; otherwise null.
- summary: one or two short sentences: what the source is and what is being asked.
- questions: up to 3 short questions when something important is unclear (who, when, which item); [] when clear.
- If nothing is actionable, give your best guess and ask in questions.
Reply with ONLY a JSON object with exactly these keys: title, kind, steps, due_date, due_time, priority, person, summary, questions.`;

type Capture = {
  text?: string;
  image?: { data: string; mime: string };
  file?: { data: string; mime: string; name?: string };
  fileText?: string;
  fileName?: string;
  previousTitle?: string;
  now?: string;
  timeZone?: string;
};

function userText(c: Capture) {
  const parts = [`Current date and time: ${c.now || new Date().toISOString()} (${c.timeZone || 'UTC'}).`];
  if (c.text) parts.push(`User's note:\n${c.text}`);
  if (c.fileText) parts.push(`Document "${c.fileName || 'file'}":\n${c.fileText.slice(0, 20000)}`);
  if (c.image) parts.push('The attached image is the source.');
  if (c.file) parts.push(`The attached document "${c.file.name || 'file'}" is the source.`);
  if (c.previousTitle) parts.push(`Give a different suggestion than this one: "${c.previousTitle}".`);
  return parts.join('\n\n');
}

// ---------- providers ----------
async function callProvider(provider: Provider, model: string, key: string, c: Capture, maxTokens = 1500): Promise<string> {
  const text = userText(c);

  if (provider === 'openai') {
    const content: unknown[] = [{ type: 'text', text }];
    if (c.image) content.push({ type: 'image_url', image_url: { url: `data:${c.image.mime};base64,${c.image.data}` } });
    if (c.file) content.push({ type: 'file', file: { filename: c.file.name || 'document.pdf', file_data: `data:${c.file.mime};base64,${c.file.data}` } });
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content }],
        response_format: { type: 'json_object' },
        max_completion_tokens: maxTokens * 4,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ProviderError('OpenAI', res.status, body?.error?.message);
    return body?.choices?.[0]?.message?.content ?? '';
  }

  if (provider === 'gemini') {
    const parts: unknown[] = [{ text }];
    if (c.image) parts.push({ inline_data: { mime_type: c.image.mime, data: c.image.data } });
    if (c.file) parts.push({ inline_data: { mime_type: c.file.mime, data: c.file.data } });
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts }],
        generationConfig: { responseMimeType: 'application/json', maxOutputTokens: maxTokens * 4 },
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ProviderError('Gemini', res.status, body?.error?.message);
    return (body?.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('');
  }

  // claude
  const content: unknown[] = [];
  if (c.image) content.push({ type: 'image', source: { type: 'base64', media_type: c.image.mime, data: c.image.data } });
  if (c.file) content.push({ type: 'document', source: { type: 'base64', media_type: c.file.mime, data: c.file.data } });
  content.push({ type: 'text', text });
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: maxTokens, system: SYSTEM, messages: [{ role: 'user', content }] }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ProviderError('Claude', res.status, body?.error?.message);
  return (body?.content ?? []).filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('');
}

class ProviderError extends Error {
  constructor(public provider: string, public status: number, detail?: string) {
    super(`${provider} error ${status}${detail ? `: ${String(detail).slice(0, 240)}` : ''}`);
  }
}

// ---------- output cleanup ----------
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
function normalize(raw: string) {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('The AI reply could not be read. Please try again.');
  const o = JSON.parse(raw.slice(start, end + 1));
  const kind = ['single', 'checklist', 'stages'].includes(o.kind) ? o.kind : 'single';
  const steps = Array.isArray(o.steps) ? o.steps.map((s: unknown) => str(s, 200)).filter(Boolean).slice(0, 20) : [];
  const date = /^\d{4}-\d{2}-\d{2}$/.test(o.due_date ?? '') ? o.due_date : null;
  const time = date && /^\d{2}:\d{2}$/.test(o.due_time ?? '') ? o.due_time : null;
  const pr = Number(o.priority);
  return {
    title: str(o.title, 200) || 'New task',
    kind: kind === 'single' && steps.length > 1 ? 'checklist' : kind,
    steps: kind === 'single' && steps.length <= 1 ? [] : steps,
    due_date: date,
    due_time: time,
    priority: Number.isInteger(pr) && pr >= 0 && pr <= 3 ? pr : 0,
    person: str(o.person, 120) || null,
    summary: str(o.summary, 600),
    questions: Array.isArray(o.questions) ? o.questions.map((q: unknown) => str(q, 200)).filter(Boolean).slice(0, 3) : [],
  };
}

function checkCapture(c: Capture) {
  if (!c.text && !c.image && !c.file && !c.fileText) throw new Error('Nothing to read.');
  if (c.image && (c.image.data.length > MAX_B64 || !/^image\/(png|jpeg|webp|gif)$/.test(c.image.mime))) throw new Error('This image is too large or not supported.');
  if (c.file && (c.file.data.length > MAX_B64 || c.file.mime !== 'application/pdf')) throw new Error('Only PDF documents up to 10 MB are supported.');
  if (c.text && c.text.length > 20000) c.text = c.text.slice(0, 20000);
}

// ---------- handler ----------
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: auth } = await admin.auth.getUser(token);
  const user = auth?.user;
  if (!user) return json({ error: 'Please sign in again.' }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Bad request' }, 400);
  }

  try {
    switch (body.action) {
      case 'get-settings': {
        const { data } = await admin.from('ai_settings').select('provider, model, key_ciphertext').eq('user_id', user.id).maybeSingle();
        if (!data) return json({ provider: null, model: null, hasKey: false, defaults: DEFAULT_MODELS });
        return json({ provider: data.provider, model: data.model, hasKey: !!data.key_ciphertext, defaults: DEFAULT_MODELS });
      }

      case 'save-settings': {
        const provider = body.provider as Provider;
        if (!PROVIDERS.includes(provider)) return json({ error: 'Choose OpenAI, Gemini or Claude.' }, 400);
        const model = str(body.model, 80) || DEFAULT_MODELS[provider];
        const apiKey = str(body.apiKey, 400);
        let cipher: string | null = null;
        if (apiKey) {
          cipher = await encrypt(apiKey);
        } else {
          const { data } = await admin.from('ai_settings').select('provider, key_ciphertext').eq('user_id', user.id).maybeSingle();
          if (!data?.key_ciphertext || data.provider !== provider) return json({ error: 'Paste your API key.' }, 400);
          cipher = data.key_ciphertext;
        }
        // Test the key with a tiny request before saving it.
        try {
          await callProvider(provider, model, apiKey || (await decrypt(cipher)), { text: 'Test: remind me to call Dana tomorrow.' }, 300);
        } catch (e) {
          return json({ error: `The key or model did not work. ${e instanceof Error ? e.message : ''}`.trim() }, 400);
        }
        const { error } = await admin
          .from('ai_settings')
          .upsert({ user_id: user.id, provider, model, key_ciphertext: cipher }, { onConflict: 'user_id' });
        if (error) throw error;
        return json({ provider, model, hasKey: true, defaults: DEFAULT_MODELS });
      }

      case 'delete-settings': {
        await admin.from('ai_settings').delete().eq('user_id', user.id);
        return json({ provider: null, model: null, hasKey: false, defaults: DEFAULT_MODELS });
      }

      case 'capture': {
        const c = (body.capture ?? {}) as Capture;
        checkCapture(c);
        const { data } = await admin.from('ai_settings').select('provider, model, key_ciphertext').eq('user_id', user.id).maybeSingle();
        if (!data?.key_ciphertext) return json({ error: 'Connect an AI provider in Settings first.', code: 'no_ai' }, 400);
        const raw = await callProvider(data.provider, data.model || DEFAULT_MODELS[data.provider as Provider], await decrypt(data.key_ciphertext), c);
        return json({ suggestion: normalize(raw) });
      }

      default:
        return json({ error: 'Unknown action' }, 400);
    }
  } catch (e) {
    const status = e instanceof ProviderError ? 502 : 400;
    console.error(JSON.stringify({ event: 'ai_error', action: body.action, message: e instanceof Error ? e.message : String(e) }));
    return json({ error: e instanceof Error ? e.message : 'Something went wrong.' }, status);
  }
});
