import { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';

export function useNow() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const update = () => setNow(Date.now());
    const timer = window.setInterval(update, 5_000);
    document.addEventListener('visibilitychange', update);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', update); };
  }, []);
  return now;
}

export function elapsedLabel(since: string, now: number) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(since)) / 60_000));
  if (!Number.isFinite(minutes)) return '—';
  if (minutes === 0) return '< 1 min';
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} godz. ${minutes % 60} min`;
}

type SoundMode = 'waiter' | 'kitchen';
let audio: AudioContext | undefined;

function chime(context: AudioContext, mode: SoundMode) {
  const tones = mode === 'waiter' ? [660, 880] : [880, 660];
  tones.forEach((frequency, index) => {
    const start = context.currentTime + index * 0.19;
    const oscillator = context.createOscillator();
    const volume = context.createGain();
    oscillator.frequency.value = frequency;
    volume.gain.setValueAtTime(0.001, start);
    volume.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
    volume.gain.exponentialRampToValueAtTime(0.001, start + 0.26);
    oscillator.connect(volume).connect(context.destination);
    oscillator.onended = () => { oscillator.disconnect(); volume.disconnect(); };
    oscillator.start(start);
    oscillator.stop(start + 0.27);
  });
}

export function NewOrderSound({ mode, ids, scope = '' }: { mode: SoundMode; ids?: string[]; scope?: string }) {
  const key = `restaurant:sound:${mode}`;
  const [muted, setMuted] = useState(() => localStorage.getItem(key) === 'off');
  const [context, setContext] = useState(audio);
  const [running, setRunning] = useState(audio?.state === 'running');
  const [failed, setFailed] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const seen = useRef<{ scope: string; ids: Set<string> } | undefined>(undefined);
  const available = typeof window.AudioContext === 'function';

  useEffect(() => {
    const sync = () => setRunning(context?.state === 'running');
    sync();
    context?.addEventListener('statechange', sync);
    return () => context?.removeEventListener('statechange', sync);
  }, [context]);

  // Android WebView can suspend audio until the operator first touches the page.
  useEffect(() => {
    if (!available || muted || running) return;
    const unlock = (event: Event) => {
      if (button.current?.contains(event.target as Node)) return;
      try {
        audio ??= new AudioContext();
        setContext(audio);
        if (audio.state !== 'running') void audio.resume().catch(() => {});
      } catch { setFailed(true); }
    };
    document.addEventListener('pointerup', unlock);
    document.addEventListener('keydown', unlock);
    return () => {
      document.removeEventListener('pointerup', unlock);
      document.removeEventListener('keydown', unlock);
    };
  }, [available, muted, running]);

  useEffect(() => {
    if (!ids) return;
    if (seen.current?.scope !== scope) {
      seen.current = { scope, ids: new Set(ids) };
      return;
    }
    const previous = seen.current.ids;
    const added = ids.some(id => !previous.has(id));
    for (const id of ids) previous.add(id);
    if (added && !muted && audio?.state === 'running') chime(audio, mode);
  }, [ids, mode, muted, scope]);

  async function toggle() {
    setFailed(false);
    if (!muted && running) {
      localStorage.setItem(key, 'off');
      setMuted(true);
      return;
    }
    try {
      audio ??= new AudioContext();
      setContext(audio);
      await audio.resume();
      if (audio.state !== 'running') throw new Error();
      localStorage.setItem(key, 'on');
      setMuted(false);
      setRunning(true);
      chime(audio, mode);
    } catch { setFailed(true); }
  }

  const enabled = !muted && running;
  const Icon = enabled ? Volume2 : VolumeX;
  return <div><button type="button" ref={button} className="button quiet" aria-pressed={enabled}
    disabled={!available} onClick={() => void toggle()}><Icon size={17} />
    {available ? enabled ? 'Wycisz dźwięk' : 'Włącz dźwięk' : 'Dźwięk niedostępny'}</button>
    {failed && <small role="status">Sprawdź ustawienia dźwięku na tym urządzeniu i spróbuj ponownie.</small>}</div>;
}
