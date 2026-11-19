import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { db } from './store';

@Controller('api/health')
export class HealthController {
  @Get()
  async health() {
    try {
      await db.$queryRaw`SELECT 1`;
      return { ok: true };
    } catch {
      throw new ServiceUnavailableException('Baza danych jest chwilowo niedostępna.');
    }
  }
}
