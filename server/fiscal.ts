import { Body, ConflictException, Controller, ForbiddenException, Headers, Inject, NotFoundException, Param, Post, ServiceUnavailableException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { lineTotal } from '../shared/model';
import { Live } from './live';
import { activeVisit, asLines, billLines, json } from './orders';
import { bearer, demo, digest, note, read, requireStaff, transact, type Tx } from './store';

async function operator(tx: Tx, auth: string) {
  const employee = await requireStaff(tx, bearer(auth), 'WAITER');
  if (!employee.canFiscalize) throw new ForbiddenException('Brak uprawnienia do wystawiania paragonów.');
  return employee;
}

function station(key: string, restaurant: string) {
  const configured = process.env.FISCAL_STATION_KEY;
  if (demo() && !configured && key === 'local-demo') return;
  if (!configured || process.env.FISCAL_RESTAURANT_SLUG !== restaurant || !timingSafeEqual(Buffer.from(digest(configured)), Buffer.from(digest(key ?? '')))) {
    throw new ForbiddenException('Ta operacja wymaga skonfigurowanego tabletu przy barze.');
  }
}

async function receiptFor(tx: Tx, receiptId: string, restaurantId: string) {
  const receipt = await tx.receipt.findFirst({ where: { id: receiptId, visit: { table: { restaurantId } } } });
  if (!receipt) throw new NotFoundException('Nie znaleziono rozliczenia.');
  return receipt;
}

@Controller('api/fiscal')
export class FiscalController {
  constructor(@Inject(Live) private readonly live: Live) {}

  @Post('tables/:tableId/prepare')
  async prepare(@Headers('authorization') auth: string, @Headers('x-station-key') key: string, @Param('tableId') tableId: string, @Body() input: unknown) {
    const { method } = read(z.object({ method: z.enum(['CASH', 'CARD']) }), input);
    if (!demo() && !process.env.FISCAL_STATION_KEY) throw new ServiceUnavailableException('Skonfiguruj drukarkę fiskalną w lokalu.');
    const { receipt, restaurantId } = await transact(async tx => {
      const employee = await operator(tx, auth);
      station(key, employee.restaurant.slug);
      const visit = await activeVisit(tx, employee.restaurantId, tableId);
      const existing = await tx.receipt.findUnique({ where: { lockedVisit: visit.id } });
      if (existing) {
        if (existing.method !== method) throw new ConflictException('Istnieje już rozliczenie z inną metodą płatności.');
        return { receipt: existing, restaurantId: employee.restaurantId };
      }
      const orders = await tx.order.findMany({ where: { visitId: visit.id } });
      if (asLines(visit.cart).length || orders.some(order => ['PENDING', 'ACCEPTED', 'PREPARING', 'READY'].includes(order.status))) {
        throw new ConflictException('Przed rozliczeniem opróżnij koszyk i dokończ obsługę zamówień.');
      }
      const lines = billLines(orders);
      if (!lines.length) throw new ConflictException('Stolik nie ma pozycji do rozliczenia.');
      const receipt = await tx.receipt.create({ data: { visitId: visit.id, lockedVisit: visit.id, total: lineTotal(lines), lines: json(lines), method } });
      return { receipt, restaurantId: employee.restaurantId };
    });
    this.live.publish(restaurantId, receipt.visitId);
    return receipt;
  }

  @Post(':receiptId/claim')
  async claim(@Headers('authorization') auth: string, @Headers('x-station-key') key: string, @Param('receiptId') receiptId: string) {
    const result = await transact(async tx => {
      const employee = await operator(tx, auth);
      station(key, employee.restaurant.slug);
      const receipt = await receiptFor(tx, receiptId, employee.restaurantId);
      if (receipt.status !== 'PREPARED') throw new ConflictException('Zlecenie już wysłano lub wymaga weryfikacji.');
      const updated = await tx.receipt.update({ where: { id: receipt.id }, data: { status: 'SENDING' } });
      return { updated, restaurantId: employee.restaurantId };
    });
    this.live.publish(result.restaurantId, result.updated.visitId);
    return result.updated;
  }

  @Post(':receiptId/result')
  async result(@Headers('authorization') auth: string, @Headers('x-station-key') key: string, @Param('receiptId') receiptId: string, @Body() input: unknown) {
    const result = read(z.object({ status: z.enum(['ISSUED', 'FAILED', 'UNKNOWN']), reference: note.optional() }), input);
    const { updated, restaurantId } = await transact(async tx => {
      const employee = await operator(tx, auth);
      station(key, employee.restaurant.slug);
      const receipt = await receiptFor(tx, receiptId, employee.restaurantId);
      if (receipt.status === result.status && receipt.reference === (result.reference ?? null)) return { updated: receipt, restaurantId: employee.restaurantId };
      if (receipt.status !== 'SENDING' || (result.status === 'ISSUED' && !result.reference)) throw new ConflictException('Zlecenie nie przyjmuje tego wyniku.');
      const updated = await tx.receipt.update({ where: { id: receipt.id }, data: { ...result, lockedVisit: result.status === 'FAILED' ? null : receipt.visitId } });
      return { updated, restaurantId: employee.restaurantId };
    });
    this.live.publish(restaurantId, updated.visitId);
    return updated;
  }

  @Post(':receiptId/resolve')
  async resolve(@Headers('authorization') auth: string, @Param('receiptId') receiptId: string, @Body() input: unknown) {
    const { status, reference } = read(z.object({ status: z.enum(['ISSUED', 'FAILED']), reference: note.min(1) }), input);
    const { updated, restaurantId } = await transact(async tx => {
      const { restaurantId } = await requireStaff(tx, bearer(auth), 'MANAGER');
      const receipt = await receiptFor(tx, receiptId, restaurantId);
      if (!['UNKNOWN', 'SENDING'].includes(receipt.status)) throw new ConflictException('Zlecenie nie wymaga weryfikacji.');
      const updated = await tx.receipt.update({ where: { id: receipt.id }, data: { status, reference, lockedVisit: status === 'FAILED' ? null : receipt.visitId } });
      return { updated, restaurantId };
    });
    this.live.publish(restaurantId, updated.visitId);
    return updated;
  }

  @Post(':receiptId/settle')
  async settle(@Headers('authorization') auth: string, @Headers('x-station-key') key: string, @Param('receiptId') receiptId: string) {
    const { receipt, restaurantId } = await transact(async tx => {
      const employee = await operator(tx, auth);
      station(key, employee.restaurant.slug);
      const receipt = await receiptFor(tx, receiptId, employee.restaurantId);
      if (receipt.settledAt) return { receipt, restaurantId: employee.restaurantId };
      if (receipt.status !== 'ISSUED') throw new ConflictException('Potwierdź wydanie paragonu przed zamknięciem.');
      const closedAt = new Date();
      await tx.visit.update({ where: { id: receipt.visitId }, data: { activeTable: null, pin: null, closedAt } });
      await tx.serviceCall.updateMany({ where: { openVisit: receipt.visitId }, data: { openVisit: null, resolvedAt: closedAt } });
      const updated = await tx.receipt.update({ where: { id: receipt.id }, data: { settledAt: closedAt } });
      return { receipt: updated, restaurantId: employee.restaurantId };
    });
    this.live.publish(restaurantId, receipt.visitId, true);
    return receipt;
  }
}
