'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

export type ApiResult<T = any> = { ok: true; data: T } | { ok: false; error: string; extra?: any; status: number };

function waitForOnline(): Promise<void> {
  if (typeof navigator === 'undefined' || navigator.onLine) return Promise.resolve();
  return new Promise((resolve) => window.addEventListener('online', () => resolve(), { once: true }));
}

/**
 * POST JSON. If the connection drops, waits until the device is back online and sends again.
 * Callers pass an idempotency key in the body for money actions, so a resend can never double-charge.
 */
export async function apiSend<T = any>(url: string, body: unknown, opts: { method?: string; onQueued?: () => void; steppedUp?: boolean } = {}): Promise<ApiResult<T>> {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      opts.onQueued?.();
      await waitForOnline();
    }
    try {
      const res = await fetch(url, {
        method: opts.method ?? 'POST',
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'same-origin',
      });
      const json = await res.json().catch(() => ({}));
      // Money and committee actions may ask for a fresh code first: show "Confirm it's you", then retry once.
      if (res.status === 401 && json.error === 'step_up_required' && typeof window !== 'undefined' && window.__ahadiStepUp && !opts.steppedUp) {
        const ok = await window.__ahadiStepUp();
        if (!ok) return { ok: false, error: 'step_up_cancelled', status: 401 };
        return apiSend<T>(url, body, { ...opts, steppedUp: true });
      }
      if (!res.ok) return { ok: false, error: json.error ?? 'generic', extra: json.extra, status: res.status };
      return { ok: true, data: json as T };
    } catch {
      opts.onQueued?.();
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      await waitForOnline();
    }
  }
  return { ok: false, error: 'network', status: 0 };
}

export async function apiGet<T = any>(url: string): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: json.error ?? 'generic', status: res.status };
    return { ok: true, data: json as T };
  } catch {
    return { ok: false, error: 'network', status: 0 };
  }
}

/** State that is saved to this phone as the user types, so nothing is lost on a dropped connection or reload. */
export function useDraft<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void, () => void] {
  const [value, setValue] = useState<T>(initial);
  const loaded = useRef(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) setValue({ ...initial, ...JSON.parse(raw) });
    } catch {
      /* storage unavailable: keep in memory only */
    }
    loaded.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    if (!loaded.current) return;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  }, [key, value]);
  const clear = useCallback(() => {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }, [key]);
  return [value, setValue, clear];
}

export function newIdempotencyKey(): string {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export const fmtMoney = (amount: number, currency = 'UGX') => `${currency} ${Math.round(amount).toLocaleString('en-US')}`;

/** Digits only, for amount inputs that show thousands separators. */
export const digits = (s: string) => s.replace(/[^\d]/g, '');
export const withCommas = (s: string) => (s ? Number(digits(s)).toLocaleString('en-US') : '');

/**
 * Logout on a shared phone: remove pages the offline helper stored and the form drafts kept on this device
 * (they can hold a phone number). Never throws.
 */
export async function clearDeviceData() {
  try {
    navigator.serviceWorker?.controller?.postMessage('ahadi:clear');
    if (typeof caches !== 'undefined') for (const k of await caches.keys()) await caches.delete(k);
  } catch { /* nothing stored */ }
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith('ahadi:') && k !== 'ahadi:pledgeView') localStorage.removeItem(k);
    }
  } catch { /* storage blocked */ }
}
