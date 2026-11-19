import { ConflictException, NotFoundException } from '@nestjs/common';
import type { Order } from '@prisma/client';
import { z } from 'zod';
import { atStation, preparationStatus } from '../shared/kitchen';
import { asLines, json, lineKey as key } from './orders';
import { id, note } from './store';

const station = z.enum(['KITCHEN', 'BAR']).optional();
const quantity = z.number().int().min(1).max(99);
const reason = note.min(1, 'Podaj powód zmiany.');
export const orderAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('ACCEPT') }),
  z.object({ action: z.literal('REJECT'), reason }),
  z.object({ action: z.literal('PREPARE'), station }),
  z.object({ action: z.literal('READY'), station }),
  z.object({ action: z.literal('READY_LINE'), key }),
  z.object({ action: z.literal('SERVE') }),
  z.object({ action: z.literal('CANCEL_LINE'), key, reason }),
  z.object({ action: z.literal('CHANGE_LINE'), key, request: id, reason, quantity, note, previousQuantity: quantity, previousNote: note }),
]);

export function applyOrderAction(order: Order, action: z.infer<typeof orderAction>, time: Date) {
  const timestamp = time.toISOString();
  const lines = asLines(order.lines);
  const conflict = () => new ConflictException('Stan zamówienia się zmienił. Sprawdź aktualny bon.');
  switch (action.action) {
    case 'ACCEPT':
    case 'REJECT':
    case 'SERVE': {
      const next = { ACCEPT: 'ACCEPTED', REJECT: 'REJECTED', SERVE: 'SERVED' } as const;
      if (order.status === next[action.action]) return;
      if (order.status !== (action.action === 'SERVE' ? 'READY' : 'PENDING')) throw conflict();
      return { status: next[action.action], acceptedAt: action.action === 'ACCEPT' ? time : undefined,
        reason: action.action === 'REJECT' ? action.reason : undefined };
    }
    case 'CHANGE_LINE':
    case 'CANCEL_LINE':
    case 'READY_LINE': {
      const line = lines.find(line => line.key === action.key);
      if (!line) throw new NotFoundException('Nie znaleziono pozycji.');
      if (action.action === 'CANCEL_LINE') {
        if (line.canceled === action.reason) return;
        if (line.canceled || !['ACCEPTED', 'PREPARING', 'READY', 'SERVED'].includes(order.status)) throw conflict();
        line.canceled = action.reason;
        line.canceledAt = timestamp;
      } else if (action.action === 'READY_LINE') {
        if (line.canceled) throw conflict();
        if (line.readyAt) return;
        if (!['ACCEPTED', 'PREPARING'].includes(order.status)) throw conflict();
        line.startedAt ??= timestamp;
        line.readyAt = timestamp;
      } else {
        if (line.changes?.some(change => change.id === action.request)) return;
        if (line.canceled || line.readyAt || !['ACCEPTED', 'PREPARING'].includes(order.status)) throw conflict();
        if (line.quantity !== action.previousQuantity || line.note !== action.previousNote) throw conflict();
        if (line.quantity === action.quantity && line.note === action.note) throw new ConflictException('Zmień ilość lub uwagi do pozycji.');
        (line.changes ??= []).push({ id: action.request, at: timestamp, reason: action.reason,
          previousQuantity: line.quantity, quantity: action.quantity, previousNote: line.note, note: action.note });
        line.quantity = action.quantity;
        line.note = action.note;
      }
      break;
    }
    case 'PREPARE':
    case 'READY': {
      if (!['ACCEPTED', 'PREPARING', 'READY'].includes(order.status)) throw conflict();
      const active = lines.filter(line => !line.canceled && atStation(line, action.station));
      if (!active.length) throw conflict();
      if (action.action === 'READY' && active.some(line => !line.readyAt && !line.startedAt)) throw new ConflictException('Najpierw rozpocznij przygotowanie na tym stanowisku.');
      for (const line of active) {
        line.startedAt ??= timestamp;
        if (action.action === 'READY') line.readyAt ??= timestamp;
      }
      break;
    }
  }
  const status = preparationStatus(lines);
  return { lines: json(lines), status: order.status === 'SERVED' && status !== 'CANCELED' ? 'SERVED' as const : status };
}
