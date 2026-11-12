'use client';

import { useEffect, useRef, useState } from 'react';

function pickMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) {
    if (MediaRecorder.isTypeSupported?.(m)) return m;
  }
  return '';
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

const MAX_SECONDS = 180;

// Records a voice message in the browser. stop() resolves with { blob, mime, seconds } or null.
export function useRecorder() {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const rec = useRef(null);
  const chunks = useRef([]);
  const stream = useRef(null);
  const timer = useRef(null);
  const done = useRef(null);
  const started = useRef(0);

  function cleanup() {
    clearInterval(timer.current);
    stream.current?.getTracks().forEach((tr) => tr.stop());
    stream.current = null;
    rec.current = null;
    setRecording(false);
  }

  useEffect(() => () => {
    if (rec.current && rec.current.state !== 'inactive') {
      done.current = null;
      rec.current.stop();
    }
    cleanup();
  }, []);

  async function start() {
    if (rec.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('no-mic');
    stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = pickMime();
    const r = new MediaRecorder(stream.current, mime ? { mimeType: mime } : undefined);
    chunks.current = [];
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    r.onstop = () => {
      const type = r.mimeType || mime || 'audio/webm';
      const blob = new Blob(chunks.current, { type });
      const secs = Math.round((Date.now() - started.current) / 1000);
      cleanup();
      done.current?.(blob.size ? { blob, mime: type, seconds: secs } : null);
      done.current = null;
    };
    rec.current = r;
    started.current = Date.now();
    setSeconds(0);
    r.start(1000);
    setRecording(true);
    timer.current = setInterval(() => {
      const s = Math.round((Date.now() - started.current) / 1000);
      setSeconds(s);
      if (s >= MAX_SECONDS) stop();
    }, 500);
  }

  function stop() {
    return new Promise((resolve) => {
      if (!rec.current || rec.current.state === 'inactive') return resolve(null);
      done.current = resolve;
      rec.current.stop();
    });
  }

  function cancel() {
    if (rec.current && rec.current.state !== 'inactive') {
      done.current = null;
      rec.current.stop();
    } else cleanup();
  }

  return { recording, seconds, start, stop, cancel };
}

export const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
