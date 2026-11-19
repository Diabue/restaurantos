import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile, rm, rmdir } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { db, passwordHash } from '../server/store';
import { productImageDirectory } from '../server/product-images';
import type { GuestState, Menu, Order, Receipt, Table } from '../shared/model';
import type { Ticket } from '../shared/kitchen';

const base = process.env.TEST_ORIGIN || `http://127.0.0.1:${process.env.PORT || 3001}`;

async function request<T>(path: string, body?: unknown, secret = '', expected?: number | number[], station = ''): Promise<T> {
  const response = await fetch(`${base}/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers: {
    ...(secret ? { Authorization: `Bearer ${secret}` } : {}), ...(station ? { 'X-Station-Key': station } : {}),
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
  }, body: body === undefined ? undefined : JSON.stringify(body) });
  const payload = await response.json();
  if (Array.isArray(expected)) assert.ok(expected.includes(response.status), `${path}: ${response.status} ${JSON.stringify(payload)}`);
  else if (expected) assert.equal(response.status, expected, `${path}: ${JSON.stringify(payload)}`);
  else assert.ok(response.ok, `${path}: ${response.status} ${JSON.stringify(payload)}`);
  return payload as T;
}

test('guest PIN, two phones, waiter approval, kitchen, cancellation and fiscal recovery', { timeout: 45000 }, async () => {
  const slug = `test-${randomUUID().slice(0, 8)}`;
  const otherSlug = `${slug}-other`;
  const password = 'automated-test-password';
  const passwordDigest = passwordHash(password);
  const restaurant = await db.restaurant.create({ data: { slug, name: slug,
    employees: { create: [
      { username: 'waiter', name: 'Waiter', roles: ['WAITER'], canFiscalize: true, password: passwordDigest },
      { username: 'kitchen', name: 'Kitchen', roles: ['KITCHEN'], password: passwordDigest },
      { username: 'manager', name: 'Manager', roles: ['MANAGER'], password: passwordDigest },
    ] }, tables: { create: { number: 8 } },
    categories: { create: { name: 'Test', products: { create: [
      { name: 'Fries', price: 1400, fiscalCode: 'FR', vatCode: 'A' },
      { name: 'Drink', price: 1000, fiscalCode: 'DR', vatCode: 'A', options: [{ id: 'lg', name: 'Large', extra: 500 }] },
    ] } } },
  }, include: { tables: true, categories: { include: { products: true } } } });
  const other = await db.restaurant.create({ data: { slug: otherSlug, name: otherSlug, employees: { create: { username: 'waiter', name: 'Other', roles: ['WAITER'], password: passwordDigest } } } });
  const table = restaurant.tables[0];
  const fries = restaurant.categories[0].products.find(product => product.fiscalCode === 'FR')!;
  const drink = restaurant.categories[0].products.find(product => product.fiscalCode === 'DR')!;
  const login = async (user: string, venue = slug) => (await request<{ secret: string }>('/staff/login', { slug: venue, user, password })).secret;
  let live: WebSocket | undefined;
  let uploadedImage: string | undefined;

  try {
    assert.deepEqual(await request('/health'), { ok: true });
    const protectedTables = await db.$queryRaw<{ name: string; protected: boolean }[]>`
      SELECT c.relname AS name, c.relrowsecurity AS protected
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema() AND c.relkind = 'r'
    `;
    for (const name of ['Employee', 'Visit', 'GuestAccess', 'StaffAccess', '_prisma_migrations']) {
      assert.equal(protectedTables.find(table => table.name === name)?.protected, true, `${name} must reject direct unprivileged reads`);
    }
    const [waiter, kitchen, manager, outsider] = await Promise.all([login('waiter'), login('kitchen'), login('manager'), login('waiter', otherSlug)]);
    const floor = (secret: string) => request<{ tables: Table[] }>('/staff/floor', undefined, secret);
    const queue = () => request<Ticket[]>('/staff/kitchen', undefined, kitchen);
    const venueSettings = { name: restaurant.name, tagline: '', image: '', logo: '', kitchenAlertMinutes: 4 };
    await request('/manager/restaurant', venueSettings, kitchen, 403);
    await request('/manager/restaurant', { ...venueSettings, kitchenAlertMinutes: 0 }, manager, 400);
    await request('/manager/restaurant', venueSettings, manager);
    await request('/manager/product', { ...drink, station: 'BAR' }, manager);
    assert.equal((await floor(outsider)).tables.length, 0);
    await request('/staff/floor', undefined, kitchen, 403);
    await request('/manager', undefined, waiter, 403);
    const move = { id: table.id, x: 53, y: 67 };
    await request('/manager/layout', { moves: [move] }, waiter, 403);
    await request('/manager/layout', { moves: [move, { ...move, id: randomUUID() }] }, manager, 404);
    assert.equal((await floor(waiter)).tables[0].x, table.x);
    await request('/manager/layout', { moves: [move] }, manager);
    assert.deepEqual((await floor(waiter)).tables.map(({ id, x, y, number }) => ({ id, x, y, number })), [{ ...move, number: 8 }]);

    const product = { id: fries.id, categoryId: fries.categoryId, name: fries.name, description: '', image: '', price: fries.price,
      available: true, options: [], fiscalCode: fries.fiscalCode, vatCode: fries.vatCode };
    const photo = await readFile('public/images/burrata.jpg');
    const upload = (secret: string, bytes: Uint8Array<ArrayBuffer>) => {
      const form = new FormData();
      form.set('product', JSON.stringify(product));
      form.set('photo', new Blob([bytes], { type: 'image/jpeg' }), 'danie.jpg');
      return fetch(`${base}/api/manager/product`, { method: 'POST', headers: { Authorization: `Bearer ${secret}` }, body: form });
    };
    assert.equal((await upload(waiter, new Uint8Array(photo))).status, 403);
    const uploadResponse = await upload(manager, new Uint8Array(photo));
    assert.equal(uploadResponse.status, 201);
    const { image } = await uploadResponse.json() as { image: string };
    assert.match(image, new RegExp(`^/uploads/products/${restaurant.id}/[a-f0-9-]+\\.jpg$`));
    uploadedImage = resolve(productImageDirectory, restaurant.id, basename(image));
    assert.equal((await upload(manager, new TextEncoder().encode('<html>wrong file</html>'))).status, 400);
    assert.equal((await db.product.findUniqueOrThrow({ where: { id: fries.id } })).image, image);
    const servedPhoto = await fetch(`${base}${image}`);
    assert.match(servedPhoto.headers.get('content-type') ?? '', /^image\/jpeg/);
    assert.deepEqual(Buffer.from(await servedPhoto.arrayBuffer()), photo);

    await request(`/staff/tables/${table.id}/open`, {}, outsider, 404);
    const menu = `/menu/${table.code}`;
    const publicMenu = await request<Menu>(menu);
    assert.deepEqual(publicMenu.table, { number: 8, pinConfigured: false });
    assert.equal(publicMenu.categories[0].products.find(product => product.id === fries.id)?.image, image);
    await request(`${menu}/join`, { pin: '123456' }, '', 409);
    await request(`${menu}/start`, { pin: '12345' }, '', 400);
    const candidates = ['012345', '654321'];
    const results = await Promise.all(candidates.map(pin => request<{ secret?: string }>(`${menu}/start`, { pin }, '', [201, 409])));
    assert.equal(results.filter(result => result.secret).length, 1);
    const winner = results.findIndex(result => result.secret);
    const pin = candidates[winner];
    const phone1 = results[winner].secret!;
    assert.deepEqual(Object.keys(results[winner]), ['secret']);
    assert.deepEqual((await request<Menu>(menu)).table, { number: 8, pinConfigured: true });
    assert.equal((await floor(waiter)).tables[0].visit?.pin, pin);
    const managerState = await request<{ history: object[] }>('/manager', undefined, manager);
    assert.equal(managerState.history.length, 1);
    assert.equal('pin' in managerState.history[0], false);
    assert.equal('pin' in await request<GuestState>('/guest', undefined, phone1), false);
    await request(`${menu}/join`, { pin: candidates[1 - winner] }, '', 401);
    const join = async (pin: string) => (await request<{ secret: string }>(`${menu}/join`, { pin })).secret;
    const phone2 = await join(pin);
    live = new WebSocket(`${base.replace(/^http/, 'ws')}/live`);
    await once(live, 'open');
    const joined = once(live, 'message');
    live.send(JSON.stringify({ kind: 'guest', secret: phone2 }));
    assert.equal(String((await joined)[0]), 'refresh');

    const add = (productId: string, optionId?: string, requestKey = randomUUID()) => ({ action: 'add', request: requestKey, item: { productId, optionId, quantity: 1, note: '' } });
    await request('/guest/cart', add(drink.id), phone1, 409);
    const changed = once(live, 'message');
    const first = add(fries.id);
    await Promise.all([request('/guest/cart', first, phone1), request('/guest/cart', add(fries.id), phone2), request('/guest/cart', add(drink.id, 'lg'), phone2)]);
    await request('/guest/cart', first, phone1);
    assert.equal(String((await changed)[0]), 'refresh');
    const basket = await request<GuestState>('/guest', undefined, phone1);
    assert.equal(basket.total, 4300);
    assert.equal(basket.cart.find(line => line.productId === fries.id)?.quantity, 2);
    const snapshot = basket.cart.map(({ key, quantity, price }) => ({ key, quantity, price }));
    const submission = { snapshot, request: randomUUID() };
    const [sent, replay] = await Promise.all([request<Order>('/guest/order', submission, phone1), request<Order>('/guest/order', submission, phone1)]);
    assert.equal(sent.id, replay.id);
    assert.equal(sent.status, 'PENDING');
    assert.equal((await queue()).length, 0);
    assert.equal((await floor(waiter)).tables[0].visit?.orders[0].id, sent.id);
    await request(`/staff/orders/${sent.id}`, { action: 'ACCEPT' }, outsider, 404);
    await request(`/staff/orders/${sent.id}`, { action: 'ACCEPT' }, kitchen, 403);
    await request(`/staff/orders/${sent.id}`, { action: 'ACCEPT' }, waiter);
    const [acceptedTicket] = await queue();
    assert.equal(acceptedTicket.id, sent.id);
    assert.ok(acceptedTicket.acceptedAt && Date.parse(acceptedTicket.acceptedAt) >= Date.parse(sent.createdAt));
    assert.equal(acceptedTicket.kitchenAlertMinutes, 4);
    const drinkLine = acceptedTicket.lines.find(line => line.name === 'Drink')!;
    assert.equal(drinkLine.station, 'BAR');
    const orderPath = `/staff/orders/${sent.id}`;
    const correction = { action: 'CHANGE_LINE', key: drinkLine.key, request: randomUUID(), reason: 'Dla drugiej osoby',
      previousQuantity: 1, previousNote: '', quantity: 2, note: 'Bez lodu' };
    await request(orderPath, correction, kitchen, 403);
    await request(orderPath, correction, waiter);
    await request(orderPath, correction, waiter);
    await request(orderPath, { ...correction, request: randomUUID(), quantity: 3 }, waiter, 409);
    const corrected = (await queue())[0].lines.find(line => line.key === drinkLine.key)!;
    assert.equal(corrected.quantity, 2);
    assert.equal(corrected.note, 'Bez lodu');
    assert.equal(corrected.changes?.length, 1);
    assert.ok(corrected.changes?.[0].at);
    assert.equal(corrected.changes?.[0].reason, correction.reason);
    await request(orderPath, { action: 'PREPARE', station: 'BAR' }, kitchen);
    await request(orderPath, { action: 'READY_LINE', key: drinkLine.key }, waiter, 403);
    await request(orderPath, { action: 'READY_LINE', key: drinkLine.key }, kitchen);
    const partial = (await queue())[0];
    assert.equal(partial.status, 'PREPARING');
    assert.ok(partial.lines.find(line => line.key === drinkLine.key)?.readyAt);
    assert.equal(partial.lines.find(line => line.name === 'Fries')?.startedAt, undefined);
    await request(`/staff/orders/${sent.id}`, { action: 'CANCEL_LINE', key: sent.lines.find(line => line.productId === drink.id)?.key, reason: 'Gość zmienił zdanie' }, waiter);
    assert.equal((await queue())[0].lines.find(line => line.name === 'Drink')?.canceled, 'Gość zmienił zdanie');
    assert.ok((await queue())[0].lines.find(line => line.name === 'Drink')?.canceledAt);
    await request(`/staff/orders/${sent.id}`, { action: 'PREPARE' }, kitchen);
    await request(`/staff/orders/${sent.id}`, { action: 'READY' }, kitchen);
    await request(`/staff/orders/${sent.id}`, { action: 'SERVE' }, waiter);

    await request('/guest/call', { reason: 'invalid' }, phone1, 400);
    await request('/guest/call', { reason: 'BILL' }, phone1);
    const firstCall = (await request<GuestState>('/guest', undefined, phone1)).call!;
    await request('/guest/call', { reason: 'HELP' }, phone2);
    const visit = (await floor(waiter)).tables[0].visit!;
    assert.equal(visit.calls.length, 1);
    assert.equal(visit.calls[0].createdAt, firstCall.createdAt);
    assert.equal(visit.calls[0].reason, 'BILL');
    await request(`/staff/calls/${visit.calls[0].id}/resolve`, {}, waiter);
    assert.equal((await request<GuestState>('/guest', undefined, phone2)).call, null);

    const station = 'local-demo';
    const checkout = `/fiscal/tables/${table.id}/prepare`;
    await request(checkout, { method: 'CARD' }, waiter, 403);
    const receipt = await request<Receipt>(checkout, { method: 'CARD' }, waiter, undefined, station);
    const destination = await db.diningTable.create({ data: { restaurantId: restaurant.id, number: 9 } });
    const transferPath = `/staff/tables/${table.id}/transfer`;
    await request(transferPath, { visitId: visit.id, targetTableId: destination.id, request: randomUUID() }, waiter, 409);
    assert.equal(receipt.total, 2800);
    assert.equal((await request<Receipt>(checkout, { method: 'CARD' }, waiter, undefined, station)).id, receipt.id);
    await request(`/fiscal/${receipt.id}/claim`, {}, waiter, undefined, station);
    await request(`/fiscal/${receipt.id}/result`, { status: 'UNKNOWN' }, waiter, undefined, station);
    await request(`/fiscal/${receipt.id}/claim`, {}, waiter, 409, station);
    await request(`/fiscal/${receipt.id}/settle`, {}, waiter, 409, station);
    await request('/guest/cart', add(fries.id), phone2, 409);
    await request(`/fiscal/${receipt.id}/resolve`, { status: 'ISSUED', reference: 'DEMO-42' }, manager);
    await request(`/fiscal/${receipt.id}/settle`, {}, waiter, undefined, station);
    await request('/guest', undefined, phone1, 401);
    await request('/guest', undefined, phone2, 401);
    assert.equal((await db.visit.findUniqueOrThrow({ where: { id: visit.id } })).pin, null);
    assert.deepEqual((await request<Menu>(menu)).table, { number: 8, pinConfigured: false });
    assert.equal((await floor(waiter)).tables[0].visit, null);
    await request(`${menu}/join`, { pin }, '', 409);

    const opened = await request<{ id: string; pin: null }>(`/staff/tables/${table.id}/open`, {}, waiter);
    assert.equal(opened.pin, null);
    const manual = await request<Order>(`/staff/tables/${table.id}/manual`, {
      request: randomUUID(), items: [{ productId: fries.id, quantity: 1, note: '' }],
    }, waiter);
    const nextPin = '750341';
    const { secret: nextPhone } = await request<{ secret: string }>(`${menu}/start`, { pin: nextPin });
    const nextVisit = (await floor(waiter)).tables[0].visit;
    assert.equal(nextVisit?.id, opened.id);
    assert.equal(nextVisit?.pin, nextPin);
    assert.deepEqual((await request<GuestState>('/guest', undefined, nextPhone)).orders.map(order => order.id), [manual.id]);
    await request(`${menu}/join`, { pin }, '', 401);
    await join(nextPin);

    const anotherDestination = await db.diningTable.create({ data: { restaurantId: restaurant.id, number: 10 } });
    const foreignTable = await db.diningTable.create({ data: { restaurantId: other.id, number: 1 } });
    const moveVisit = (targetTableId: string) => ({ visitId: opened.id, targetTableId, request: randomUUID() });
    await request(transferPath, moveVisit(destination.id), kitchen, 403);
    await request(transferPath, moveVisit(destination.id), outsider, 404);
    await request(transferPath, moveVisit(foreignTable.id), waiter, 404);
    await request('/guest/call', {}, nextPhone);
    await request('/guest/cart', add(fries.id), nextPhone);

    const destinations = [destination, anotherDestination];
    const moves = destinations.map(target => moveVisit(target.id));
    const competing = await Promise.all(moves.map(body => request<{ tableId?: string }>(transferPath, body, waiter, [201, 409])));
    assert.equal(competing.filter(result => result.tableId).length, 1);
    const accepted = competing.findIndex(result => !!result.tableId);
    const target = destinations[accepted];
    assert.equal(competing[accepted].tableId, target.id);
    assert.deepEqual(await request(transferPath, moves[accepted], waiter), { tableId: target.id });
    const movedFloor = await floor(waiter);
    const moved = movedFloor.tables.find(item => item.id === target.id)!.visit!;
    assert.equal(movedFloor.tables.find(item => item.id === table.id)?.visit, null);
    assert.equal(moved.id, opened.id);
    assert.equal(moved.total, fries.price);
    assert.equal(moved.orders[0].id, manual.id);
    assert.equal(moved.pin, nextPin);
    const forPhone = await request<GuestState>('/guest', undefined, nextPhone);
    assert.deepEqual(forPhone.table, { number: target.number, code: target.code });
    assert.ok(forPhone.call);
    assert.equal(forPhone.cart[0].productId, fries.id);
    const ticket = (await request<{ id: string; table: number }[]>('/staff/kitchen', undefined, kitchen)).find(order => order.id === manual.id);
    assert.equal(ticket?.table, target.number);
    assert.deepEqual((await request<Menu>(menu)).table, { number: 8, pinConfigured: false });
    await request(`${menu}/join`, { pin: nextPin }, '', 409);
    const joinedNew = await request<{ secret: string }>(`/menu/${target.code}/join`, { pin: nextPin });
    assert.equal((await request<GuestState>('/guest', undefined, joinedNew.secret)).orders[0].id, manual.id);
    const history = await request<{ history: { id: string; transfers: { fromNumber: number; toNumber: number; employeeName: string }[] }[] }>('/manager', undefined, manager);
    const audit = history.history.find(entry => entry.id === opened.id)!.transfers;
    assert.equal(audit.length, 1);
    assert.equal(audit[0].fromNumber, 8);
    assert.equal(audit[0].toNumber, target.number);
    assert.equal(audit[0].employeeName, 'Waiter');
    const replacement = await request<{ secret: string }>(`${menu}/start`, { pin: '904162' });
    const staleExpected = { visitId: opened.id };
    await request(`/staff/tables/${table.id}/manual`, { ...staleExpected, request: randomUUID(), items: [{ productId: fries.id, quantity: 1, note: '' }] }, waiter, 409);
    await request(checkout, { ...staleExpected, method: 'CARD' }, waiter, 409, station);
    await request(`/staff/tables/${table.id}/close-empty`, staleExpected, waiter, 409);
    assert.deepEqual((await request<GuestState>('/guest', undefined, replacement.secret)).orders, []);
    await request(`/staff/tables/${target.id}/transfer`, moveVisit(table.id), waiter, 409);
  } finally {
    live?.terminate();
    if (uploadedImage) {
      await rm(uploadedImage, { force: true });
      await rmdir(resolve(productImageDirectory, restaurant.id));
    }
    const restaurants = [restaurant.id, other.id];
    const visits = await db.visit.findMany({ where: { table: { restaurantId: { in: restaurants } } }, select: { id: true } });
    const visitId = { in: visits.map(visit => visit.id) };
    await db.$transaction([
      db.receipt.deleteMany({ where: { visitId } }), db.serviceCall.deleteMany({ where: { visitId } }), db.order.deleteMany({ where: { visitId } }),
      db.guestAccess.deleteMany({ where: { visitId } }), db.cartOperation.deleteMany({ where: { visitId } }), db.visit.deleteMany({ where: { id: visitId } }),
      db.diningTable.deleteMany({ where: { restaurantId: { in: restaurants } } }), db.product.deleteMany({ where: { category: { restaurantId: { in: restaurants } } } }),
      db.category.deleteMany({ where: { restaurantId: { in: restaurants } } }), db.staffAccess.deleteMany({ where: { employee: { restaurantId: { in: restaurants } } } }),
      db.employee.deleteMany({ where: { restaurantId: { in: restaurants } } }), db.restaurant.deleteMany({ where: { id: { in: restaurants } } }),
    ]);
    await db.$disconnect();
  }
});
