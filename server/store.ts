import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma, PrismaClient, Role } from '@prisma/client';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const db = new PrismaClient();
export type Tx = Prisma.TransactionClient;
export type Staff = NonNullable<Awaited<ReturnType<typeof staffAccess>>>;
export const token = () => randomBytes(32).toString('base64url');
export const digest = (secret: string) => createHash('sha256').update(secret).digest('hex');
export const demo = () => process.env.DEMO_MODE === '1';

export function passwordHash(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

export function checkPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(':');
  return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(hash, 'hex'));
}

export async function staffAccess(tx: Tx, secret: string) {
  if (!secret || secret.length > 100) return null;
  const entry = await tx.staffAccess.findUnique({ where: { digest: digest(secret) }, include: { employee: { include: { restaurant: true } } } });
  return entry?.employee.active && entry.expiresAt > new Date() ? entry.employee : null;
}

export async function guestAccess(tx: Tx, secret: string) {
  if (!secret || secret.length > 100) return null;
  const entry = await tx.guestAccess.findUnique({ where: { digest: digest(secret) }, include: { visit: { include: { table: true } } } });
  return entry?.visit.activeTable ? entry.visit : null;
}

export function bearer(header?: string) {
  return header?.startsWith('Bearer ') ? header.slice(7) : '';
}

export async function requireStaff(tx: Tx, secret: string, ...roles: Role[]) {
  const employee = await staffAccess(tx, secret);
  if (!employee) throw new UnauthorizedException('Zaloguj się ponownie.');
  if (roles.length && !roles.some(role => employee.roles.includes(role))) {
    throw new ForbiddenException('Brak uprawnień do tej operacji.');
  }
  return employee;
}

export async function requireGuest(tx: Tx, secret: string) {
  const visit = await guestAccess(tx, secret);
  if (!visit) throw new UnauthorizedException('Sesja stolika wygasła. Otwórz ponownie menu stolika.');
  return visit;
}

export async function transact<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(work, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || !['P2034', 'P2002'].includes(error.code)) throw error;
      if (attempt >= 4) throw new ConflictException('Dane zostały zmienione. Odśwież widok i spróbuj ponownie.');
      await new Promise(resolve => setTimeout(resolve, 15 * (attempt + 1)));
    }
  }
}

export function read<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new BadRequestException(result.error.issues.map(issue => `${issue.path.join('.') || 'Dane'}: ${issue.message}`).join(', '));
  return result.data;
}

export const id = z.string().uuid();
export const title = z.string().trim().min(1).max(100);
export const note = z.string().trim().max(300);
export const username = z.string().trim().min(2).max(50).regex(/^[a-z0-9._-]+$/);
export const roles = z.array(z.nativeEnum(Role)).min(1).max(3);
export const options = z.array(z.object({ id: z.string().min(1).max(60), name: title, extra: z.number().int().min(0).max(100000) })).max(20)
  .refine(items => new Set(items.map(item => item.id)).size === items.length, 'Opcje muszą mieć różne identyfikatory.');

@Injectable()
export class Attempts {
  private readonly buckets = new Map<string, { count: number; end: number }>();

  take(key: string, limit: number) {
    const now = Date.now();
    if (this.buckets.size > 2048) {
      for (const [name, entry] of this.buckets) if (entry.end < now) this.buckets.delete(name);
      if (this.buckets.size > 10000) throw new HttpException('Spróbuj ponownie za chwilę.', 429);
    }
    const current = this.buckets.get(key);
    if (current && current.end > now) {
      if (current.count >= limit) throw new HttpException('Za dużo prób. Spróbuj ponownie za kilka minut.', 429);
      current.count++;
    } else {
      this.buckets.set(key, { count: 1, end: now + 5 * 60 * 1000 });
    }
  }
}
