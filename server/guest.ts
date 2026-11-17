import { Body, ConflictException, Controller, Get, Headers, Inject, Ip, NotFoundException, Param, Post, UnauthorizedException } from '@nestjs/common';
import { z } from 'zod';
import { lineTotal } from '../shared/model';
import { Live } from './live';
import { asLines, editable, json, pricedLine, selection } from './orders';
import { Attempts, bearer, db, demo, digest, id, read, requireGuest, token, transact, type Tx } from './store';

const pinInput = z.object({ pin: z.string().regex(/^\d{6}$/, 'Wpisz dokładnie 6 cyfr.') });

async function grantGuestAccess(tx: Tx, visitId: string) {
  const secret = token();
  await tx.guestAccess.create({ data: { digest: digest(secret), visitId } });
  return secret;
}

@Controller('api')
export class GuestController {
  constructor(@Inject(Live) private readonly live: Live, @Inject(Attempts) private readonly attempts: Attempts) {}

  @Get('demo/tables')
  async demoTables() {
    if (!demo()) throw new NotFoundException();
    const entry = await db.diningTable.findUnique({ where: { code: 'demo' }, select: {
      restaurant: { select: { name: true, tables: { orderBy: { number: 'asc' }, select: { code: true, number: true } } } },
    } });
    if (!entry) throw new NotFoundException('Nie znaleziono stolików demonstracyjnych.');
    return entry.restaurant;
  }

  @Get('menu/:code')
  async menu(@Param('code') code: string) {
    const table = await db.diningTable.findUnique({ where: { code }, include: {
      visits: { where: { activeTable: { not: null }, pin: { not: null } }, select: { id: true }, take: 1 },
      restaurant: { include: { categories: {
        orderBy: [{ position: 'asc' }, { name: 'asc' }], include: { products: { where: { available: true }, orderBy: { createdOrder: 'asc' } } },
      } } },
    } });
    if (!table) throw new NotFoundException('Nie znaleziono stolika. Sprawdź kod QR.');
    const { slug, name, tagline, image, logo, categories } = table.restaurant;
    return { restaurant: { slug, name, tagline, image, logo }, table: { number: table.number, pinConfigured: table.visits.length > 0 }, categories };
  }

  @Post('menu/:code/start')
  async start(@Param('code') code: string, @Ip() ip: string, @Body() input: unknown) {
    const { pin } = read(pinInput, input);
    this.limitAccessAttempts(ip, code);
    const { restaurantId, visitId, secret } = await transact(async tx => {
      const table = await tx.diningTable.findUnique({ where: { code }, select: { id: true, restaurantId: true } });
      if (!table) throw new NotFoundException('Nie znaleziono stolika. Sprawdź kod QR.');
      const active = await tx.visit.findUnique({ where: { activeTable: table.id } });
      if (active?.pin != null) throw new ConflictException('Goście przy tym stoliku już ustawili PIN. Wpisz ich kod, aby dołączyć.');
      if (active) await editable(tx, active.id);
      const visit = active
        ? await tx.visit.update({ where: { id: active.id }, data: { pin } })
        : await tx.visit.create({ data: { tableId: table.id, activeTable: table.id, pin } });
      return { restaurantId: table.restaurantId, visitId: visit.id, secret: await grantGuestAccess(tx, visit.id) };
    });
    this.live.publish(restaurantId, visitId, true);
    return { secret };
  }

  @Post('menu/:code/join')
  async join(@Param('code') code: string, @Ip() ip: string, @Body() input: unknown) {
    const { pin } = read(pinInput, input);
    this.limitAccessAttempts(ip, code);
    return transact(async tx => {
      const visit = await tx.visit.findFirst({ where: { activeTable: { not: null }, table: { code } }, select: { id: true, pin: true } });
      if (visit?.pin == null) throw new ConflictException('Na tym stoliku nie ma aktywnego PIN-u. Ustaw kod na nową wizytę.');
      if (pin !== visit.pin) throw new UnauthorizedException('Nieprawidłowy PIN stolika.');
      return { secret: await grantGuestAccess(tx, visit.id) };
    });
  }

  private limitAccessAttempts(ip: string, code: string) {
    this.attempts.take(`pin-ip:${ip}`, 35);
    this.attempts.take(`pin-table:${code}`, 120);
  }

  @Get('guest')
  async state(@Headers('authorization') auth: string) {
    return transact(async tx => {
      const visit = await requireGuest(tx, bearer(auth));
      const orders = await tx.order.findMany({ where: { visitId: visit.id }, orderBy: { createdAt: 'desc' } });
      const call = await tx.serviceCall.findUnique({ where: { openVisit: visit.id } });
      return { cart: visit.cart, orders, call, total: lineTotal(asLines(visit.cart)) };
    });
  }

  @Post('guest/cart')
  async cart(@Headers('authorization') auth: string, @Body() input: unknown) {
    const command = read(z.discriminatedUnion('action', [
      z.object({ action: z.literal('add'), request: id, item: selection }),
      z.object({ action: z.literal('change'), request: id, key: z.string().max(600), delta: z.union([z.literal(-1), z.literal(1)]).optional() }),
    ]), input);
    const visit = await transact(async tx => {
      const visit = await requireGuest(tx, bearer(auth));
      if (await tx.cartOperation.findUnique({ where: { visitId_key: { visitId: visit.id, key: command.request } } })) return visit;
      await editable(tx, visit.id);
      let cart = asLines(visit.cart);
      if (command.action === 'add') {
        const line = await pricedLine(tx, visit.table.restaurantId, command.item);
        const index = cart.findIndex(item => item.key === line.key);
        if (index < 0) cart = [...cart, line];
        else cart[index] = { ...line, quantity: cart[index].quantity + line.quantity };
      } else {
        const index = cart.findIndex(line => line.key === command.key);
        if (index < 0) throw new ConflictException('Ta pozycja zmieniła się na innym telefonie.');
        if (command.delta === undefined || cart[index].quantity + command.delta <= 0) cart.splice(index, 1);
        else cart[index] = { ...cart[index], quantity: cart[index].quantity + command.delta };
      }
      if (cart.length > 100 || cart.some(line => line.quantity > 99)) throw new ConflictException('Osiągnięto limit koszyka.');
      await tx.visit.update({ where: { id: visit.id }, data: { cart: json(cart) } });
      await tx.cartOperation.create({ data: { visitId: visit.id, key: command.request } });
      return visit;
    });
    this.live.publish(visit.table.restaurantId, visit.id);
    return { ok: true };
  }

  @Post('guest/order')
  async submit(@Headers('authorization') auth: string, @Body() input: unknown) {
    const { request, snapshot } = read(z.object({ request: id, snapshot: z.array(z.object({ key: z.string().max(600), quantity: z.number().int(), price: z.number().int() })).max(100) }), input);
    const { visit, order } = await transact(async tx => {
      const visit = await requireGuest(tx, bearer(auth));
      const existing = await tx.order.findUnique({ where: { visitId_key: { visitId: visit.id, key: request } } });
      if (existing) return { visit, order: existing };
      await editable(tx, visit.id);
      const cart = asLines(visit.cart);
      if (!cart.length) throw new ConflictException('Koszyk jest pusty.');
      if (snapshot.length !== cart.length || cart.some(line => !snapshot.some(item => item.key === line.key && item.quantity === line.quantity && item.price === line.price))) {
        throw new ConflictException('Koszyk zmienił się na innym telefonie. Sprawdź aktualne pozycje.');
      }
      const lines = await Promise.all(cart.map(line => pricedLine(tx, visit.table.restaurantId, line)));
      if (lines.some((line, index) => line.price !== cart[index].price)) {
        await tx.visit.update({ where: { id: visit.id }, data: { cart: json(lines) } });
        return { visit, order: null };
      }
      const order = await tx.order.create({ data: { visitId: visit.id, key: request, source: 'QR', status: 'PENDING', lines: json(lines) } });
      await tx.visit.update({ where: { id: visit.id }, data: { cart: [] } });
      return { visit, order };
    });
    this.live.publish(visit.table.restaurantId, visit.id);
    if (!order) throw new ConflictException('Ceny zostały zaktualizowane. Sprawdź koszyk przed zamówieniem.');
    return order;
  }

  @Post('guest/call')
  async call(@Headers('authorization') auth: string) {
    const visit = await transact(async tx => {
      const visit = await requireGuest(tx, bearer(auth));
      await tx.serviceCall.upsert({ where: { openVisit: visit.id }, create: { visitId: visit.id, openVisit: visit.id }, update: {} });
      return visit;
    });
    this.live.publish(visit.table.restaurantId, visit.id);
    return { ok: true };
  }
}
