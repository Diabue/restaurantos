import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const pkg = resolve('.local/pg');
if (!existsSync(resolve(pkg, 'node_modules/embedded-postgres/package.json'))) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npm, ['install', '--prefix', pkg, 'embedded-postgres@18.6.0-beta.19'], {
    stdio: 'inherit', shell: process.platform === 'win32',
  });
  if (result.status !== 0) process.exit(1);
}
const require = createRequire(pathToFileURL(resolve(pkg, 'package.json')));
const { default: EmbeddedPostgres } = await import(pathToFileURL(require.resolve('embedded-postgres')).href);
const testing = process.argv.includes('--test');
const databaseDir = resolve(testing ? '.local/demo-test-db' : '.local/demo-db');
const port = Number(process.env.DEMO_DB_PORT || (testing ? 55433 : 55432));
const pg = new EmbeddedPostgres({ databaseDir, user: 'restaurant', password: 'restaurant-demo', port, persistent: true, onLog: () => {} });
const env = { ...process.env, DATABASE_URL: `postgresql://restaurant:restaurant-demo@127.0.0.1:${port}/postgres?schema=public`, DEMO_MODE: '1', HOST: process.env.DEMO_HOST || '127.0.0.1', PORT: process.env.PORT || (testing ? '3002' : '3001') };
let server;
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  if (server && server.exitCode === null) server.kill();
  await pg.stop().catch(error => console.error(error));
}
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());

function run(file, ...args) {
  const child = spawnSync(process.execPath, [file, ...args], { env, stdio: 'inherit' });
  if (child.status !== 0) throw new Error(`Polecenie zakończyło się błędem: ${file}`);
}

try {
  if (!existsSync(resolve(databaseDir, 'PG_VERSION'))) await pg.initialise();
  await pg.start();
  run(require.resolve('prisma/build/index.js', { paths: [process.cwd()] }), 'migrate', 'deploy');
  const tsx = resolve('node_modules/tsx/dist/cli.mjs');
  run(tsx, 'server/seed.ts');
  if (testing) {
    server = spawn(process.execPath, [tsx, 'server/main.ts'], { env, stdio: 'inherit' });
    for (let attempt = 0; attempt < 60; attempt++) {
      const ready = await fetch(`http://127.0.0.1:${env.PORT || 3001}/api/menu/demo`).then(response => response.ok, () => false);
      if (ready) break;
      if (attempt === 59 || server.exitCode !== null) throw new Error('API nie wystartowało.');
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    run(tsx, '--test', 'tests/flow.test.ts');
  } else {
    run(resolve('node_modules/vite/bin/vite.js'), 'build');
    console.log(`Wybór stolika http://localhost:${env.PORT || 3001}/ · Obsługa http://localhost:${env.PORT || 3001}/staff?venue=oliwa`);
    server = spawn(process.execPath, [tsx, 'server/main.ts'], { env, stdio: 'inherit' });
    const status = await new Promise(resolve => server.once('exit', resolve));
    if (status) process.exitCode = status;
  }
} finally {
  await stop();
}
