import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

function run(file, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [file, ...args], { stdio: 'inherit', env: process.env });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolveRun() : reject(new Error('Nie udało się przygotować serwera.')));
  });
}

try {
  if (!process.env.DATABASE_URL) throw new Error('Ustaw DATABASE_URL w ustawieniach serwera.');
  if (!process.env.SUPABASE_URL || !(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)) {
    throw new Error('Ustaw Supabase Storage, aby zdjęcia przetrwały restart serwera.');
  }
  if (process.env.DEMO_MODE === '1' && (!process.env.DEMO_PASSWORD || process.env.DEMO_PASSWORD.length < 16 || process.env.DEMO_PASSWORD === 'demo1234')) {
    throw new Error('Ustaw DEMO_PASSWORD z minimum 16 znaków dla demonstracji w internecie.');
  }
  await run(resolve('node_modules/prisma/build/index.js'), ['migrate', 'deploy']);
  const tsx = resolve('node_modules/tsx/dist/cli.mjs');
  if (process.env.SEED_ON_START === '1') {
    await run(tsx, ['scripts/setup-storage.ts']);
    await run(tsx, ['server/seed.ts']);
  }
  // Forward host shutdown signals to the API for graceful termination.
  const api = spawn(process.execPath, [tsx, 'server/main.ts'], { stdio: 'inherit', env: process.env });
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => api.kill(signal));
  api.once('error', () => { process.exitCode = 1; });
  api.once('exit', code => { process.exitCode = code ?? 0; });
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Nie udało się uruchomić serwera.');
  process.exitCode = 1;
}
