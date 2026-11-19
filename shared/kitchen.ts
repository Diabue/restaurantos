import type { Line, OrderStatus, PrepStation } from './model';

export type TicketLine = Pick<Line, 'key' | 'name' | 'note' | 'quantity' | 'option' | 'station' | 'readyAt' | 'startedAt' | 'canceled' | 'canceledAt' | 'changes'>;
export type Ticket = {
  id: string; table: number; status: OrderStatus; createdAt: string; acceptedAt: string | null;
  kitchenAlertMinutes: number; lines: TicketLine[];
};

export function preparationStatus(lines: TicketLine[]): 'ACCEPTED' | 'PREPARING' | 'READY' | 'CANCELED' {
  const active = lines.filter(line => !line.canceled);
  if (!active.length) return 'CANCELED';
  if (active.every(line => line.readyAt)) return 'READY';
  return active.some(line => line.startedAt || line.readyAt) ? 'PREPARING' : 'ACCEPTED';
}

export function atStation(line: TicketLine, station?: PrepStation) {
  return !station || (line.station ?? 'KITCHEN') === station;
}
