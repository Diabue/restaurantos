import { useState } from 'react';
import { AlertTriangle, Check, ChefHat, Clock, GlassWater } from 'lucide-react';
import { atStation, preparationStatus, type Ticket, type TicketLine } from '../shared/kitchen';
import { stationLabel, type LineChange, type OrderStatus, type PrepStation } from '../shared/model';
import { elapsedLabel, NewOrderSound, useNow } from './service-alerts';
import { clock, Status, tableNumber } from './ui';
import './kitchen-board.css';

type Filter = PrepStation | 'ALL';
type TicketAction = { action: 'PREPARE' | 'READY'; station: PrepStation } | { action: 'READY_LINE'; key: string };
type StationTicket = Ticket & { station: PrepStation };
const stations = ['KITCHEN', 'BAR'] as const;
const columns = [
  { name: 'Nowe bony', states: ['ACCEPTED'] },
  { name: 'W przygotowaniu', states: ['PREPARING'] },
  { name: 'Gotowe i zmiany', states: ['READY', 'SERVED', 'CANCELED'] },
];

function stationTickets(tickets: Ticket[], filter: Filter): StationTicket[] {
  const result: StationTicket[] = [];
  for (const ticket of tickets) {
    for (const station of stations) {
      if (filter !== 'ALL' && station !== filter) continue;
      const lines = ticket.lines.filter(line => atStation(line, station));
      if (!lines.length) continue;
      const status = preparationStatus(lines);
      if (ticket.status === 'SERVED' && !lines.some(line => line.canceled || line.changes?.length)) continue;
      result.push({ ...ticket, station, lines, status: ticket.status === 'SERVED' && status !== 'CANCELED' ? 'SERVED' : status });
    }
  }
  return result.sort((a, b) => Date.parse(a.acceptedAt ?? a.createdAt) - Date.parse(b.acceptedAt ?? b.createdAt));
}

export function KitchenBoard({ data, venue, busy, send }: {
  data?: Ticket[]; venue: string; busy: boolean; send: (orderId: string, action: TicketAction) => void;
}) {
  const storageKey = `restaurant:kitchen-station:${venue}`;
  const [filter, setFilter] = useState<Filter>(() => {
    const saved = localStorage.getItem(storageKey);
    return saved === 'KITCHEN' || saved === 'BAR' ? saved : 'ALL';
  });
  const now = useNow();
  const cards = stationTickets(data ?? [], filter);
  const soundIds = data && cards.map(ticket => `${ticket.id}-${ticket.station}`);
  return <>
    <div className="kitchen-tools">
      <div className="segmented" role="group" aria-label="Stanowisko">
        {(['ALL', ...stations] as const).map(station => <button key={station} aria-pressed={filter === station} className={filter === station ? 'selected' : ''}
          onClick={() => { setFilter(station); localStorage.setItem(storageKey, station); }}>
          {station === 'ALL' ? 'Wszystkie stanowiska' : stationLabel[station]}</button>)}
      </div>
      <NewOrderSound mode="kitchen" scope={`${venue}/${filter}`} ids={soundIds} />
    </div>
    <div className="kitchen-columns">{columns.map(column => {
      const tickets = cards.filter(ticket => column.states.includes(ticket.status));
      return <section className="kitchen-column" key={column.name}><h2>{column.name}<span className="section-count">{tickets.length}</span></h2>
        {tickets.length ? tickets.map(ticket => <TicketCard key={`${ticket.id}-${ticket.station}`} ticket={ticket} now={now} busy={busy} send={action => send(ticket.id, action)} />)
          : <p className="empty-card">{data ? 'Brak bonów' : 'Ładowanie…'}</p>}
      </section>;
    })}</div>
  </>;
}

function TicketCard({ ticket, now, busy, send }: { ticket: StationTicket; now: number; busy: boolean; send: (action: TicketAction) => void }) {
  const start = ticket.acceptedAt ?? ticket.createdAt;
  const open = ticket.status === 'ACCEPTED' || ticket.status === 'PREPARING';
  const overdue = open && now - Date.parse(start) >= ticket.kitchenAlertMinutes * 60_000;
  const begin = ticket.lines.some(line => !line.canceled && !line.startedAt && !line.readyAt);
  const StationIcon = ticket.station === 'BAR' ? GlassWater : ChefHat;
  return <article className={`panel ticket station-ticket${overdue ? ' ticket-overdue' : ''}`}>
    <div className="order-head"><strong>Stolik {tableNumber(ticket.table)}</strong>
      <span className="ticket-station"><StationIcon size={16} />{stationLabel[ticket.station]}</span></div>
    <div className="ticket-state"><Status status={ticket.status} />
      {open && <span className={`ticket-age${overdue ? ' overdue' : ''}`}>{overdue ? <AlertTriangle size={15} /> : <Clock size={15} />}
        {overdue ? 'Długi czas' : 'Czeka'} · {elapsedLabel(start, now)}</span>}
    </div>
    <small className="ticket-received">{ticket.acceptedAt ? 'Przyjęto' : 'Złożono'} {clock(start)}</small>
    {ticket.lines.map(line => <TicketItem key={line.key} line={line} status={ticket.status} disabled={busy}
      markReady={() => send({ action: 'READY_LINE', key: line.key })} />)}
    {open && <button className="button primary" disabled={busy} onClick={() => send({ action: begin ? 'PREPARE' : 'READY', station: ticket.station })}>
      {begin ? (ticket.status === 'PREPARING' ? 'Rozpocznij pozostałe pozycje' : 'Rozpocznij przygotowanie') : 'Oznacz bon jako gotowy'}
    </button>}
  </article>;
}

function TicketItem({ line, status, disabled, markReady }: { line: TicketLine; status: OrderStatus; disabled: boolean; markReady: () => void }) {
  const canFinish = !line.canceled && !line.readyAt && (status === 'ACCEPTED' || status === 'PREPARING');
  return <div className="ticket-item"><div className="ticket-item-head"><strong>{line.quantity} × {line.name}</strong>
    {!line.canceled && line.readyAt && <span className="ticket-item-ready"><Check size={14} /> Gotowe · {clock(line.readyAt)}</span>}
    {canFinish && <button className="button quiet ticket-item-action" disabled={disabled} aria-label={`Oznacz jako gotowe: ${line.quantity} × ${line.name}`} onClick={markReady}><Check size={15} /> Gotowe</button>}
  </div>
    {line.option && <span>{line.option}</span>}{line.note && <span className="ticket-item-note">{line.note}</span>}
    {line.canceled && <div className="ticket-event ticket-event-cancel"><strong>Anulowano{line.canceledAt ? ` · ${clock(line.canceledAt)}` : ''}</strong><span>{line.canceled}</span></div>}
    {[...(line.changes ?? [])].reverse().map(change => <Correction key={change.id} change={change} />)}
  </div>;
}

function Correction({ change }: { change: LineChange }) {
  return <div className="ticket-event ticket-event-change"><strong>Zmieniono · {clock(change.at)}</strong>
    {change.previousQuantity !== change.quantity && <span>Ilość {change.previousQuantity} → {change.quantity}</span>}
    {change.previousNote !== change.note && <span>Uwagi „{change.previousNote || 'brak'}” → „{change.note || 'brak'}”</span>}
    <span>Powód · {change.reason}</span>
  </div>;
}
