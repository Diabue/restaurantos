import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import express from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { FiscalController } from './fiscal';
import { GuestController } from './guest';
import { HealthController } from './health';
import { Live } from './live';
import { ManagerController } from './manager';
import { productImageDirectory, productImagePath } from './product-images';
import { cloudImageStorage } from './supabase-images';
import { StaffController } from './staff';
import { Attempts, db } from './store';

@Module({ controllers: [GuestController, StaffController, ManagerController, FiscalController, HealthController], providers: [Live, Attempts] })
class AppModule {}

const app = await NestFactory.create(AppModule, { cors: false });
app.enableShutdownHooks();
const server = app.getHttpAdapter().getInstance() as express.Express;
server.disable('x-powered-by');
// Only enable behind a controlled reverse proxy that overwrites client IP headers.
if (process.env.TRUST_PROXY_HOPS) {
  const hops = Number(process.env.TRUST_PROXY_HOPS);
  if (!Number.isInteger(hops) || hops < 1 || hops > 5) throw new Error('TRUST_PROXY_HOPS musi wynosić od 1 do 5.');
  server.set('trust proxy', hops);
}
app.use((request: express.Request, response: express.Response, next: express.NextFunction) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'same-origin');
  response.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data: blob:; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  if (request.path.startsWith('/api/')) response.setHeader('Cache-Control', 'no-store');
  next();
});
const cloudImages = cloudImageStorage();
if (cloudImages) {
  server.get('/uploads/products/:restaurant/:filename', async (request, response) => {
    const path = `/uploads/products/${request.params.restaurant}/${request.params.filename}`;
    if (!productImagePath.test(path)) { response.sendStatus(404); return; }
    try {
      const photo = await cloudImages.download(`${request.params.restaurant}/${request.params.filename}`);
      response.setHeader('Content-Type', photo.type);
      response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      response.send(Buffer.from(await photo.arrayBuffer()));
    } catch (error) {
      const status = error && typeof error === 'object' && 'getStatus' in error && typeof error.getStatus === 'function' ? error.getStatus() : 503;
      response.status(status).json({ message: status === 404 ? 'Nie znaleziono zdjęcia.' : 'Zdjęcie jest chwilowo niedostępne.' });
    }
  });
} else {
  app.use('/uploads/products', express.static(productImageDirectory, { index: false, redirect: false, immutable: true, maxAge: '1y' }));
}
if (existsSync(resolve('dist/index.html'))) {
  app.use(express.static(resolve('dist'), { index: false }));
  server.get(['/', '/staff', '/t/:code'], (_request, response) => response.sendFile(resolve('dist/index.html')));
}
await db.$connect();
app.get(Live).attach(app.getHttpServer());
await app.listen(Number(process.env.PORT || 3001), process.env.HOST || '0.0.0.0');
