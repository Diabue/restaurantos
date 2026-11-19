import { Body, ConflictException, Controller, Get, Headers, Inject, Ip, NotFoundException, Param, Post, UnauthorizedException } from '@nestjs/common';
import { z } from 'zod';
import type { TableTransfer } from '../shared/model';
import { Live } from './live';
import { applyOrderAction, orderAction } from './kitchen';
import { activeVisit, asLines, editable, json, orderInclude, pricedLine, selection, withTotal } from './orders';
import { Attempts, bearer, checkPassword, db, demo, digest, id, passwordHash, read, requireStaff, token, transact, username } from './store';

const invalidHash = passwordHash('invalid staff login');
const identity = (employee: Awaited<ReturnType<typeof requireStaff>>) => ({
  id: employee.id, name: employee.name, roles: employee.roles, canFiscalize: employee.canFiscalize,
  restaurant: { name: employee.restaurant.name, slug: employee.restaurant.slug }, demo: demo(),
});

@Controller('api/staff')
export class StaffController {
  constructor(@Inject(Live) private readonly live: Live, @Inject(Attempts) private readonly attempts: Attempts) {}

  @Post('login')
  async login(@Body() input: unknown, @Ip() ip: string) {
    const { slug, user, password } = read(z.object({ slug: username, user: username, password: z.string().min(1).max(128) }), input);
    this.attempts.take(`login-ip:${ip}`, 45);
    this.attempts.take(`login:${ip}:${slug}:${user}`, 12);
    const employee = await db.employee.findFirst({ where: { username: user, restaurant: { slug } }, include: { restaurant: true } });
    if (!checkPassword(password, employee?.password ?? invalidHash) || !employee?.active) throw new UnauthorizedException('Sprawdź lokal, login i hasło.');
    const secret = token();
    await db.staffAccess.create({ data: { digest: digest(secret), employeeId: employee.id, expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000) } });
    return { secret, employee: identity(employee) };
  }

  @Get('me')
  async me(@Headers('authorization') auth: string) {
    return identity(await requireStaff(db, bearer(auth)));
  }

  @Post('logout')
  async logout(@Headers('authorization') auth: string) {
    await db.staffAccess.deleteMany({ where: { digest: digest(bearer(auth)) } });
    return { ok: true };
  }

  @Get('floor')
  async floor(@Headers('authorization') auth: string) {
    const { restaurantId } = await requireStaff(db, bearer(auth), 'WAITER');
    const [tables, categories] = await Promise.all([
      db.diningTable.findMany({ where: { restaurantId }, orderBy: { number: 'asc' }, include: {
        visits: { where: { activeTable: { not: null } }, take: 1, include: orderInclude },
      } }),
      db.category.findMany({ where: { restaurantId }, orderBy: { position: 'asc' }, include: { products: { where: { available: true } } } }),
    ]);
    return { tables: tables.map(({ visits, ...table }) => ({ ...table, visit: visits[0] ? withTotal(visits[0]) : null })), categories };
  }

  @Get('kitchen')
  async kitchen(@Headers('authorization') auth: string) {
    const { restaurantId, restaurant } = await requireStaff(db, bearer(auth), 'KITCHEN');
    const orders = await db.order.findMany({ where: { visit: { activeTable: { not: null }, table: { restaurantId } },
      status: { in: ['ACCEPTED', 'PREPARING', 'READY', 'SERVED', 'CANCELED'] } }, orderBy: { createdAt: 'asc' },
      include: { visit: { select: { table: { select: { number: true } } } } } });
    return orders.filter(order => order.status !== 'SERVED' || asLines(order.lines).some(line => line.canceled || line.changes?.length))
      .map(({ id, status, createdAt, acceptedAt, lines, visit, reason }) => ({ id, status, createdAt, acceptedAt, reason,
      table: visit.table.number, kitchenAlertMinutes: restaurant.kitchenAlertMinutes,
      lines: asLines(lines).map(({ key, name, option, note, quantity, station, startedAt, readyAt, canceled, canceledAt, changes }) =>
        ({ key, name, option, note, quantity, station, startedAt, readyAt, canceled, canceledAt, changes })),
    }));
  }

  @Post('tables/:tableId/open')
  async open(@Headers('authorization') auth: string, @Param('tableId') tableId: string) {
    const result = await transact(async tx => {
      const { restaurantId } = await requireStaff(tx, bearer(auth), 'WAITER');
      if (!(await tx.diningTable.findFirst({ where: { id: tableId, restaurantId } }))) throw new NotFoundException('Nie znaleziono stolika.');
      const existing = await tx.visit.findUnique({ where: { activeTable: tableId } });
      if (existing) return { restaurantId, visit: existing };
      const visit = await tx.visit.create({ data: { tableId, activeTable: tableId } });
      return { restaurantId, visit };
    });
    this.live.publish(result.restaurantId, result.visit.id);
    return result.visit;
  }

  @Post('tables/:tableId/close-empty')
  async closeEmpty(@Headers('authorization') auth: string, @Param('tableId') tableId: string, @Body() input?: unknown) {
    const { visitId } = read(z.object({ visitId: id.optional() }), input ?? {});
    const visit = await transact(async tx => {
      const { restaurantId } = await requireStaff(tx, bearer(auth), 'WAITER');
      const visit = await activeVisit(tx, restaurantId, tableId, visitId);
      await editable(tx, visit.id);
      if (asLines(visit.cart).length || await tx.order.count({ where: { visitId: visit.id, status: { notIn: ['REJECTED', 'CANCELED'] } } })) {
        throw new ConflictException('Na stoliku są pozycje lub zamówienia do rozliczenia.');
      }
      await tx.visit.update({ where: { id: visit.id }, data: { activeTable: null, pin: null, closedAt: new Date() } });
      await tx.serviceCall.updateMany({ where: { openVisit: visit.id }, data: { openVisit: null, resolvedAt: new Date() } });
      return visit;
    });
    this.live.publish(visit.table.restaurantId, visit.id, true);
    return { ok: true };
  }

  @Post('tables/:tableId/manual')
  async manual(@Headers('authorization') auth: string, @Param('tableId') tableId: string, @Body() input: unknown) {
    const { request, items, visitId } = read(z.object({ request: id, items: z.array(selection).min(1).max(50), visitId: id.optional() }), input);
    const { visit, order } = await transact(async tx => {
      const { restaurantId } = await requireStaff(tx, bearer(auth), 'WAITER');
      const visit = await activeVisit(tx, restaurantId, tableId, visitId);
      const existing = await tx.order.findUnique({ where: { visitId_key: { visitId: visit.id, key: request } } });
      if (existing) return { visit, order: existing };
      await editable(tx, visit.id);
      const lines = await Promise.all(items.map(async (item, index) => ({ ...(await pricedLine(tx, restaurantId, item)), key: String(index) })));
      const order = await tx.order.create({ data: { visitId: visit.id, key: request, status: 'ACCEPTED', source: 'STAFF', acceptedAt: new Date(), lines: json(lines) } });
      return { visit, order };
    });
    this.live.publish(visit.table.restaurantId, visit.id);
    return order;
  }

  @Post('tables/:tableId/transfer')
  async transfer(@Headers('authorization') auth: string, @Param('tableId') tableId: string, @Body() input: unknown) {
    const { visitId, targetTableId, request } = read(z.object({ visitId: id, targetTableId: id, request: id }), input);
    const result = await transact(async tx => {
      const employee = await requireStaff(tx, bearer(auth), 'WAITER');
      const restaurantId = employee.restaurantId;
      const visit = await tx.visit.findFirst({ where: { id: visitId, table: { restaurantId } }, include: { table: true } });
      if (!visit) throw new NotFoundException('Nie znaleziono wizyty.');
      if (!visit.activeTable) throw new ConflictException('Ta wizyta jest już zamknięta.');
      const transfers = visit.transfers as TableTransfer[];
      const previous = transfers.find(move => move.request === request);
      if (previous) {
        if (previous.fromId !== tableId || previous.toId !== targetTableId) throw new ConflictException('Żądanie dotyczy innego przeniesienia.');
        return { restaurantId, tableId: visit.activeTable };
      }
      if (visit.activeTable !== tableId) throw new ConflictException('Wizyta została już przeniesiona. Sprawdź mapę sali.');
      if (tableId === targetTableId) throw new ConflictException('Wybierz inny stolik.');
      await editable(tx, visit.id);
      const target = await tx.diningTable.findFirst({ where: { id: targetTableId, restaurantId } });
      if (!target) throw new NotFoundException('Nie znaleziono docelowego stolika.');
      const occupied = await tx.visit.findUnique({ where: { activeTable: target.id }, select: { id: true } });
      if (occupied) throw new ConflictException('Wybrany stolik jest już zajęty.');
      const move: TableTransfer = {
        request, fromId: tableId, toId: target.id, fromNumber: visit.table.number, toNumber: target.number,
        employeeId: employee.id, employeeName: employee.name, at: new Date().toISOString(),
      };
      await tx.visit.update({ where: { id: visit.id }, data: { tableId: target.id, activeTable: target.id, transfers: [...transfers, move] } });
      return { restaurantId, tableId: target.id };
    });
    this.live.publish(result.restaurantId, visitId, true);
    return { tableId: result.tableId };
  }

  @Post('tables/:tableId/discard-cart')
  async discardCart(@Headers('authorization') auth: string, @Param('tableId') tableId: string, @Body() input: unknown) {
    const { visitId, snapshot } = read(z.object({ visitId: id, snapshot: z.array(z.object({ key: z.string(), quantity: z.number().int(), price: z.number().int() })).max(100) }), input);
    const visit = await transact(async tx => {
      const { restaurantId } = await requireStaff(tx, bearer(auth), 'WAITER');
      const visit = await activeVisit(tx, restaurantId, tableId);
      const cart = asLines(visit.cart);
      if (visit.id !== visitId || cart.length !== snapshot.length ||
          cart.some(line => !snapshot.some(item => item.key === line.key && item.quantity === line.quantity && item.price === line.price))) {
        throw new ConflictException('Koszyk zmienił się od otwarcia podsumowania.');
      }
      await editable(tx, visit.id);
      await tx.visit.update({ where: { id: visit.id }, data: { cart: [] } });
      return visit;
    });
    this.live.publish(visit.table.restaurantId, visit.id);
    return { ok: true };
  }

  @Post('orders/:orderId')
  async updateOrder(@Headers('authorization') auth: string, @Param('orderId') orderId: string, @Body() input: unknown) {
    const data = read(orderAction, input);
    const kitchen = ['PREPARE', 'READY', 'READY_LINE'].includes(data.action);
    const result = await transact(async tx => {
      const { restaurantId } = await requireStaff(tx, bearer(auth), kitchen ? 'KITCHEN' : 'WAITER');
      const order = await tx.order.findFirst({ where: { id: orderId, visit: { activeTable: { not: null }, table: { restaurantId } } } });
      if (!order) throw new NotFoundException('Nie znaleziono aktywnego zamówienia.');
      if (!kitchen && data.action !== 'SERVE') await editable(tx, order.visitId);
      const update = applyOrderAction(order, data, new Date());
      if (update) await tx.order.update({ where: { id: order.id }, data: update });
      return { restaurantId, visitId: order.visitId };
    });
    this.live.publish(result.restaurantId, result.visitId);
    return { ok: true };
  }

  @Post('calls/:callId/resolve')
  async resolveCall(@Headers('authorization') auth: string, @Param('callId') callId: string) {
    const result = await transact(async tx => {
      const { restaurantId } = await requireStaff(tx, bearer(auth), 'WAITER');
      const call = await tx.serviceCall.findFirst({ where: { id: callId, visit: { table: { restaurantId } } } });
      if (!call) throw new NotFoundException('Nie znaleziono wezwania.');
      if (call.openVisit) await tx.serviceCall.update({ where: { id: call.id }, data: { openVisit: null, resolvedAt: new Date() } });
      return { restaurantId, visitId: call.visitId };
    });
    this.live.publish(result.restaurantId, result.visitId);
    return { ok: true };
  }
}
