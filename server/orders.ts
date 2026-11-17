import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { lineTotal, type Line, type Option } from '../shared/model';
import { id, note, type Tx } from './store';

export const selection = z.object({ productId: id, optionId: z.string().max(60).optional(), note, quantity: z.number().int().min(1).max(99) });
export const asLines = (value: Prisma.JsonValue) => value as Line[];
export const json = (value: Line[]) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export const orderInclude = { orders: { orderBy: { createdAt: 'asc' as const } }, calls: true, receipts: { orderBy: { createdAt: 'desc' as const } } };

export async function pricedLine(tx: Tx, restaurantId: string, item: z.infer<typeof selection>): Promise<Line> {
  const product = await tx.product.findFirst({ where: { id: item.productId, available: true, category: { restaurantId } } });
  if (!product) throw new ConflictException('To danie jest obecnie niedostępne.');
  const options = product.options as Option[];
  const option = options.find(option => option.id === item.optionId);
  if ((options.length > 0 && !option) || (item.optionId && !option)) throw new ConflictException('Wybierz aktualną opcję dania.');
  return {
    key: JSON.stringify([product.id, option?.id ?? '', item.note]), productId: product.id, name: product.name,
    optionId: option?.id, option: option?.name, note: item.note, price: product.price + (option?.extra ?? 0),
    quantity: item.quantity, fiscalCode: product.fiscalCode, vatCode: product.vatCode,
  };
}

export function billLines(orders: { status: string; lines: Prisma.JsonValue }[]) {
  return orders.filter(order => ['ACCEPTED', 'PREPARING', 'READY', 'SERVED'].includes(order.status))
    .flatMap(order => asLines(order.lines).filter(line => !line.canceled));
}

export async function editable(tx: Tx, visitId: string) {
  const lock = await tx.receipt.findUnique({ where: { lockedVisit: visitId } });
  if (lock) throw new ConflictException('Trwa rozliczanie stolika.');
}

export async function activeVisit(tx: Tx, restaurantId: string, tableId: string) {
  const visit = await tx.visit.findFirst({ where: { activeTable: tableId, table: { restaurantId } }, include: { table: true } });
  if (!visit) throw new NotFoundException('Najpierw otwórz stolik.');
  return visit;
}

export const withTotal = <T extends { orders: { status: string; lines: Prisma.JsonValue }[] }>(visit: T) => ({ ...visit, total: lineTotal(billLines(visit.orders)) });
