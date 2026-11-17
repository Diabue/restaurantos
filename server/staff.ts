import { Body, ConflictException, Controller, Get, Headers, Inject, Ip, NotFoundException, Param, Post, UnauthorizedException } from '@nestjs/common';
import { z } from 'zod';
import { Live } from './live';
import { activeVisit, asLines, editable, json, orderInclude, pricedLine, selection, withTotal } from './orders';
import { Attempts, bearer, checkPassword, db, demo, digest, id, note, passwordHash, read, requireStaff, token, transact, username } from './store';

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
    const { restaurantId } = await requireStaff(db, bearer(auth), 'KITCHEN');
    const orders = await db.order.findMany({ where: { visit: { activeTable: { not: null }, table: { restaurantId } },
      status: { in: ['ACCEPTED', 'PREPARING', 'READY', 'SERVED', 'CANCELED'] } }, orderBy: { createdAt: 'asc' },
      include: { visit: { include: { table: true } } } });
    return orders.filter(order => order.status !== 'SERVED' || asLines(order.lines).some(line => line.canceled))
      .map(({ id, status, createdAt, lines, visit, reason }) => ({ id, status, createdAt, reason, table: visit.table.number,
      lines: asLines(lines).map(({ key, name, option, note, quantity, canceled }) => ({ key, name, option, note, quantity, canceled })),
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
  async closeEmpty(@Headers('authorization') auth: string, @Param('tableId') tableId: string) {
    const visit = await transact(async tx => {
      const { restaurantId } = await requireStaff(tx, bearer(auth), 'WAITER');
      const visit = await activeVisit(tx, restaurantId, tableId);
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
    const { request, items } = read(z.object({ request: id, items: z.array(selection).min(1).max(50) }), input);
    const { visit, order } = await transact(async tx => {
      const { restaurantId } = await requireStaff(tx, bearer(auth), 'WAITER');
      const visit = await activeVisit(tx, restaurantId, tableId);
      const existing = await tx.order.findUnique({ where: { visitId_key: { visitId: visit.id, key: request } } });
      if (existing) return { visit, order: existing };
      await editable(tx, visit.id);
      const lines = await Promise.all(items.map(async (item, index) => ({ ...(await pricedLine(tx, restaurantId, item)), key: String(index) })));
      const order = await tx.order.create({ data: { visitId: visit.id, key: request, status: 'ACCEPTED', source: 'STAFF', lines: json(lines) } });
      return { visit, order };
    });
    this.live.publish(visit.table.restaurantId, visit.id);
    return order;
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
    const data = read(z.object({ action: z.enum(['ACCEPT', 'REJECT', 'PREPARE', 'READY', 'SERVE', 'CANCEL_LINE']), key: z.string().max(600).optional(), reason: note.optional() }), input);
    const kitchen = ['PREPARE', 'READY'].includes(data.action);
    const result = await transact(async tx => {
      const { restaurantId } = await requireStaff(tx, bearer(auth), kitchen ? 'KITCHEN' : 'WAITER');
      const order = await tx.order.findFirst({ where: { id: orderId, visit: { activeTable: { not: null }, table: { restaurantId } } } });
      if (!order) throw new NotFoundException('Nie znaleziono aktywnego zamówienia.');
      if (!kitchen && data.action !== 'SERVE') await editable(tx, order.visitId);
      const actions = { ACCEPT: ['PENDING', 'ACCEPTED'], REJECT: ['PENDING', 'REJECTED'], PREPARE: ['ACCEPTED', 'PREPARING'], READY: ['PREPARING', 'READY'], SERVE: ['READY', 'SERVED'] } as const;
      if (data.action === 'CANCEL_LINE') {
        if (!data.reason || !['ACCEPTED', 'PREPARING', 'READY', 'SERVED'].includes(order.status)) throw new ConflictException('Wybierz wysłaną pozycję i podaj powód anulowania.');
        const lines = asLines(order.lines);
        const index = lines.findIndex(line => line.key === data.key && !line.canceled);
        if (index < 0) throw new NotFoundException('Nie znaleziono pozycji do anulowania.');
        lines[index] = { ...lines[index], canceled: data.reason };
        await tx.order.update({ where: { id: order.id }, data: { lines: json(lines), status: lines.every(line => line.canceled) ? 'CANCELED' : order.status } });
      } else {
        const [from, to] = actions[data.action];
        if (order.status === to) return { restaurantId, visitId: order.visitId };
        if (order.status !== from || (data.action === 'REJECT' && !data.reason)) throw new ConflictException('Status zamówienia się zmienił lub brakuje powodu odrzucenia.');
        await tx.order.update({ where: { id: order.id }, data: { status: to, reason: data.action === 'REJECT' ? data.reason : undefined } });
      }
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
