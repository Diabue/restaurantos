import { BadRequestException, Injectable, PayloadTooLargeException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Request } from 'express';
import { bearer, db, requireStaff } from './store';
import { cloudImageStorage } from './supabase-images';

export const productImageDirectory = resolve(process.env.PRODUCT_IMAGE_DIR || '.local/uploads/products');
export const productImageMaxBytes = 5 * 1024 * 1024;

const uuid = '[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}';
export const productImagePath = new RegExp('^/uploads/products/(' + uuid + ')/' + uuid + '\\.(?:jpg|png|webp)$');

const pngHeader = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const pngEnd = Buffer.from('0000000049454e44ae426082', 'hex');

function imageExtension(bytes: Buffer) {
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff &&
      bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9) return 'jpg';
  if (bytes.length >= 45 && bytes.subarray(0, pngHeader.length).equals(pngHeader) &&
      bytes.subarray(-pngEnd.length).equals(pngEnd) && bytes.readUInt32BE(16) && bytes.readUInt32BE(20)) return 'png';
  if (bytes.length > 20 && bytes.toString('ascii', 0, 4) === 'RIFF' &&
      bytes.readUInt32LE(4) + 8 === bytes.length && bytes.toString('ascii', 8, 12) === 'WEBP' &&
      ['VP8 ', 'VP8L', 'VP8X'].includes(bytes.toString('ascii', 12, 16))) return 'webp';
  throw new BadRequestException('Wybierz poprawne zdjęcie w formacie JPG, PNG lub WebP.');
}

export async function storeProductImage(restaurantId: string, bytes: Buffer) {
  if (bytes.length > productImageMaxBytes) throw new PayloadTooLargeException('Zdjęcie może mieć maksymalnie 5 MB.');
  const extension = imageExtension(bytes);
  const name = randomUUID() + '.' + extension;
  const remote = cloudImageStorage();
  if (remote) {
    const file = await remote.upload(restaurantId + '/' + name, bytes, extension === 'jpg' ? 'image/jpeg' : `image/${extension}`);
    return { url: '/uploads/products/' + restaurantId + '/' + name, discard: file.discard };
  }
  const folder = resolve(productImageDirectory, restaurantId);
  const path = resolve(folder, name);
  await mkdir(folder, { recursive: true });
  try {
    await writeFile(path, bytes, { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') await rm(path, { force: true }).catch(() => {});
    throw error;
  }
  return {
    url: '/uploads/products/' + restaurantId + '/' + name,
    discard: () => rm(path, { force: true }),
  };
}

export function productData(input: unknown) {
  if (!input || typeof input !== 'object' || !('product' in input)) return input;
  if (typeof input.product !== 'string') throw new BadRequestException('Niepoprawne dane dania.');
  try {
    return JSON.parse(input.product) as unknown;
  } catch {
    throw new BadRequestException('Niepoprawne dane dania.');
  }
}

@Injectable()
export class ProductImageGuard implements CanActivate {
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.is('multipart/form-data')) await requireStaff(db, bearer(request.headers.authorization), 'MANAGER');
    return true;
  }
}
