import { useEffect, useRef, type ReactNode } from 'react';
import { Utensils, X } from 'lucide-react';
import { statusLabel, type OrderStatus } from '../shared/model';

const formatter = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });
export const money = (cents: number) => formatter.format(cents / 100);
export const clock = (time: string) => new Date(time).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
export const tableNumber = (number: number) => String(number).padStart(2, '0');
export const message = (error: unknown) => error instanceof Error ? error.message : 'Wystąpił nieoczekiwany błąd.';

export function Mark({ image }: { image?: string }) {
  return <span className="mark">{image ? <img src={image} alt="" /> : <Utensils size={22} strokeWidth={1.7} />}</span>;
}

export function Status({ status }: { status: OrderStatus }) {
  return <span className={`status status-${status.toLowerCase()}`}><i />{statusLabel[status]}</span>;
}

export function Dialog({ children, title, close, sheet = false }: { children: ReactNode; title: string; close: () => void; sheet?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const node = ref.current!; node.showModal(); return () => node.close(); }, []);
  return <dialog ref={ref} className={sheet ? 'dialog sheet' : 'dialog'} aria-label={title}
    onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <div className="dialog-body">
      <div className="dialog-heading"><h2>{title}</h2><button className="icon-button" aria-label="Zamknij" onClick={close}><X size={20} /></button></div>
      {children}
    </div>
  </dialog>;
}

export function Feedback({ text, alert = true }: { text: string; alert?: boolean }) {
  return text ? <p className={`feedback ${alert ? 'feedback-error' : 'feedback-info'}`} role={alert ? 'alert' : 'status'}>{text}</p> : null;
}
