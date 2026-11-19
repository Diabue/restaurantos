import { BadRequestException, Body, ConflictException, Controller, Get, Headers, Inject, NotFoundException, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { Live } from './live';
import { withTotal } from './orders';
import { productData, ProductImageGuard, productImageMaxBytes, productImagePath, storeProductImage } from './product-images';
import { bearer, db, id, note, options, passwordHash, read, requireStaff, roles, title, transact, username } from './store';

const imageAddress = (value: string) => !value || /^https:\/\/[^\s]+$/i.test(value) || /^\/images\/[a-z0-9._-]+$/i.test(value);
const image = z.string().trim().max(1000).refine(imageAddress, 'Podaj adres HTTPS lub ścieżkę /images/.');
const product = z.object({ id: id.optional(), categoryId: id, name: title, description: note,
  station: z.enum(['KITCHEN', 'BAR']).optional(),
  image: z.string().trim().max(1000).refine(value => imageAddress(value) || productImagePath.test(value), 'Wybierz zdjęcie lub podaj poprawny adres HTTPS.'),
  price: z.number().int().min(1).max(1000000), available: z.boolean(), options, fiscalCode: title, vatCode: z.string().trim().regex(/^[A-G]$/),
});
const employee = z.object({ id: id.optional(), username, name: title, password: z.string().min(8).max(128).optional(), roles,
  canFiscalize: z.boolean(), active: z.boolean(),
});
const safeEmployee = { id: true, username: true, name: true, roles: true, active: true, canFiscalize: true } as const;

@Controller('api/manager')
export class ManagerController {
  constructor(@Inject(Live) private readonly live: Live) {}

  @Get()
  async state(@Headers('authorization') auth: string) {
    const { restaurant, restaurantId } = await requireStaff(db, bearer(auth), 'MANAGER');
    const [categories, tables, employees, history] = await Promise.all([
      db.category.findMany({ where: { restaurantId }, orderBy: { position: 'asc' }, include: { products: { orderBy: { createdOrder: 'asc' } } } }),
      db.diningTable.findMany({ where: { restaurantId }, orderBy: { number: 'asc' } }),
      db.employee.findMany({ where: { restaurantId }, orderBy: { name: 'asc' }, select: safeEmployee }),
      db.visit.findMany({ where: { table: { restaurantId } }, orderBy: { openedAt: 'desc' }, take: 75, omit: { pin: true },
        include: { table: { select: { number: true } }, orders: { orderBy: { createdAt: 'asc' } }, receipts: true, calls: true } }),
    ]);
    return { restaurant, categories, tables, employees, history: history.map(withTotal) };
  }

  @Post('restaurant')
  async restaurant(@Headers('authorization') auth: string, @Body() input: unknown) {
    const data = read(z.object({ name: title, tagline: note, image, logo: image, kitchenAlertMinutes: z.number().int().min(1).max(240).optional() }), input);
    const result = await transact(async tx => {
      const { restaurantId } = await requireStaff(tx, bearer(auth), 'MANAGER');
      return tx.restaurant.update({ where: { id: restaurantId }, data });
    });
    this.live.publish(result.id, undefined, true);
    return result;
  }

  @Post('category')
  async category(@Headers('authorization') auth: string, @Body() input: unknown) {
    const { id: categoryId, ...data } = read(z.object({ id: id.optional(), name: title, position: z.number().int().min(0).max(1000) }), input);
    const result = await transact(async tx => {
      const { restaurantId } = await requireStaff(tx, bearer(auth), 'MANAGER');
      if (!categoryId) return tx.category.create({ data: { ...data, restaurantId } });
      if (!(await tx.category.findFirst({ where: { id: categoryId, restaurantId } }))) throw new NotFoundException('Kategoria nie istnieje.');
      return tx.category.update({ where: { id: categoryId }, data });
    });
    this.live.publish(result.restaurantId, undefined, true);
    return result;
  }

  @Post('product')
  @UseGuards(ProductImageGuard)
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: productImageMaxBytes + 1, files: 1, fields: 1, fieldSize: 32 * 1024 } }))
  async product(@Headers('authorization') auth: string, @Body() input: unknown, @UploadedFile() photo?: { buffer: Buffer }) {
    const { id: productId, ...data } = read(product, productData(input));
    let uploaded: Awaited<ReturnType<typeof storeProductImage>> | undefined;
    if (photo) {
      const { restaurantId } = await requireStaff(db, bearer(auth), 'MANAGER');
      uploaded = await storeProductImage(restaurantId, photo.buffer);
    }
    const result = await transact(async tx => {
      const { restaurantId } = await requireStaff(tx, bearer(auth), 'MANAGER');
      if (!(await tx.category.findFirst({ where: { id: data.categoryId, restaurantId } }))) throw new NotFoundException('Kategoria nie istnieje.');
      if (productId && !(await tx.product.findFirst({ where: { id: productId, category: { restaurantId } } }))) throw new NotFoundException('Produkt nie istnieje.');
      const image = uploaded?.url ?? data.image;
      const owner = productImagePath.exec(image)?.[1];
      if (owner && owner !== restaurantId) throw new BadRequestException('Zdjęcie należy do innego lokalu.');
      const changes = { ...data, image };
      const item = productId ? await tx.product.update({ where: { id: productId }, data: changes }) : await tx.product.create({ data: changes });
      return { item, restaurantId };
    }).catch(async error => {
      await uploaded?.discard().catch(() => {});
      throw error;
    });
    this.live.publish(result.restaurantId, undefined, true);
    return result.item;
  }

  @Post('layout')
  async layout(@Headers('authorization') auth: string, @Body() input: unknown) {
    const { moves } = read(z.object({
      moves: z.array(z.object({ id, x: z.number().min(7).max(93), y: z.number().min(12).max(88) })).min(1).max(999)
        .refine(entries => new Set(entries.map(entry => entry.id)).size === entries.length, 'Każdy stolik może wystąpić tylko raz.'),
    }), input);
    const restaurantId = await transact(async tx => {
      const { restaurantId } = await requireStaff(tx, bearer(auth), 'MANAGER');
      for (const { id, x, y } of moves) {
        const { count } = await tx.diningTable.updateMany({ where: { id, restaurantId }, data: { x, y } });
        if (!count) throw new NotFoundException('Nie znaleziono jednego ze stolików. Odśwież plan sali.');
      }
      return restaurantId;
    });
    this.live.publish(restaurantId);
    return { ok: true };
  }

  @Post('table')
  async table(@Headers('authorization') auth: string, @Body() input: unknown) {
    const { id: tableId, ...data } = read(z.object({ id: id.optional(), number: z.number().int().min(1).max(999),
      seats: z.number().int().min(1).max(30), x: z.number().min(7).max(93).optional(), y: z.number().min(12).max(88).optional(),
    }), input);
    const result = await transact(async tx => {
      const { restaurantId } = await requireStaff(tx, bearer(auth), 'MANAGER');
      const duplicate = await tx.diningTable.findUnique({ where: { restaurantId_number: { restaurantId, number: data.number } } });
      if (duplicate && duplicate.id !== tableId) throw new ConflictException('Ten numer stolika jest już zajęty.');
      if (!tableId) return tx.diningTable.create({ data: { ...data, restaurantId } });
      if (!(await tx.diningTable.findFirst({ where: { id: tableId, restaurantId } }))) throw new NotFoundException('Stolik nie istnieje.');
      return tx.diningTable.update({ where: { id: tableId }, data });
    });
    this.live.publish(result.restaurantId, undefined, true);
    return result;
  }

  @Post('employee')
  async employee(@Headers('authorization') auth: string, @Body() input: unknown) {
    const { id: employeeId, password, ...data } = read(employee, input);
    if (!employeeId && !password) throw new ConflictException('Nowe konto wymaga hasła.');
    if (data.canFiscalize && !data.roles.includes('WAITER')) throw new ConflictException('Wystawianie paragonów wymaga trybu Kelner.');
    const hash = password ? passwordHash(password) : undefined;
    const result = await transact(async tx => {
      const { restaurantId } = await requireStaff(tx, bearer(auth), 'MANAGER');
      const duplicate = await tx.employee.findUnique({ where: { restaurantId_username: { restaurantId, username: data.username } } });
      if (duplicate && duplicate.id !== employeeId) throw new ConflictException('Ten login jest już zajęty.');
      if (!employeeId) return { restaurantId, employee: await tx.employee.create({ data: { ...data, password: hash!, restaurantId }, select: safeEmployee }) };
      const previous = await tx.employee.findFirst({ where: { id: employeeId, restaurantId } });
      if (!previous) throw new NotFoundException('Pracownik nie istnieje.');
      if (previous.active && previous.roles.includes('MANAGER') && (!data.active || !data.roles.includes('MANAGER'))) {
        const others = await tx.employee.count({ where: { restaurantId, id: { not: employeeId }, active: true, roles: { has: 'MANAGER' } } });
        if (!others) throw new ConflictException('Lokal musi mieć co najmniej jednego aktywnego managera.');
      }
      const updated = await tx.employee.update({ where: { id: employeeId }, data: { ...data, password: hash }, select: safeEmployee });
      if (!data.active || hash) await tx.staffAccess.deleteMany({ where: { employeeId } });
      return { restaurantId, employee: updated };
    });
    this.live.publish(result.restaurantId);
    return result.employee;
  }
}
