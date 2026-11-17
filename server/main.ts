import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import express from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { FiscalController } from './fiscal';
import { GuestController } from './guest';
import { Live } from './live';
import { ManagerController } from './manager';
import { productImageDirectory } from './product-images';
import { StaffController } from './staff';
import { Attempts, db } from './store';

@Module({ controllers: [GuestController, StaffController, ManagerController, FiscalController], providers: [Live, Attempts] })
class AppModule {}

const app = await NestFactory.create(AppModule, { cors: false });
app.enableShutdownHooks();
const server = app.getHttpAdapter().getInstance() as express.Express;
server.disable('x-powered-by');
app.use((request: express.Request, response: express.Response, next: express.NextFunction) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'same-origin');
  response.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data: blob:; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  if (request.path.startsWith('/api/')) response.setHeader('Cache-Control', 'no-store');
  next();
});
app.use('/uploads/products', express.static(productImageDirectory, { index: false, redirect: false, immutable: true, maxAge: '1y' }));
if (existsSync(resolve('dist/index.html'))) {
  app.use(express.static(resolve('dist'), { index: false }));
  server.get(['/', '/staff', '/t/:code'], (_request, response) => response.sendFile(resolve('dist/index.html')));
}
await db.$connect();
app.get(Live).attach(app.getHttpServer());
await app.listen(Number(process.env.PORT || 3001), process.env.HOST || '0.0.0.0');
