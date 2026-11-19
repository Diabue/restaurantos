import { useEffect, useRef, useState } from 'react';

export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export async function api<T>(path: string, { secret, body, station }: { secret?: string; body?: unknown; station?: string } = {}): Promise<T> {
  let response: Response;
  const multipart = body instanceof FormData;
  try {
    response = await fetch(`/api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
        ...(body !== undefined && !multipart ? { 'Content-Type': 'application/json' } : {}),
        ...(station ? { 'X-Station-Key': station } : {}),
      },
      body: multipart ? body : body === undefined ? undefined : JSON.stringify(body),
    });
  } catch { throw new ApiError(0, 'Brak połączenia. Sprawdź internet i spróbuj ponownie.'); }
  const data = await response.json().catch(() => {
    throw new ApiError(503, 'Usługa jest chwilowo niedostępna. Spróbuj ponownie później.');
  });
  if (!response.ok) throw new ApiError(response.status, data?.message ?? 'Nie udało się wykonać operacji.');
  return data as T;
}

export function requestId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}

export function useLive(kind: 'guest' | 'menu' | 'staff', secret: string, code: string, refresh: () => void) {
  const current = useRef(refresh);
  current.current = refresh;
  const [online, setOnline] = useState(false);
  useEffect(() => {
    setOnline(false);
    if (!secret && kind !== 'menu') return;
    let socket: WebSocket;
    let retry: ReturnType<typeof setTimeout>;
    let closed = false;
    let connected = false;
    function connect() {
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/live`);
      socket.onopen = () => socket.send(JSON.stringify({ kind, secret, code }));
      socket.onmessage = () => { if (!closed) { connected = true; setOnline(true); current.current(); } };
      socket.onclose = () => {
        connected = false;
        if (!closed) { setOnline(false); retry = setTimeout(connect, 2200); }
      };
      socket.onerror = () => socket.close();
    }
    function resume() { if (document.visibilityState === 'visible') current.current(); }
    connect();
    const poll = setInterval(() => { if (!connected) current.current(); }, 5500);
    document.addEventListener('visibilitychange', resume);
    return () => { closed = true; clearTimeout(retry); clearInterval(poll); socket.close(); document.removeEventListener('visibilitychange', resume); };
  }, [kind, secret, code]);
  return online;
}
