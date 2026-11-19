import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createImageStorage, imageStorageConfig } from '../server/supabase-images';

const config = { url: 'https://example.supabase.co', key: 'sb_secret_test-server-key', bucket: 'restaurantos-products' };
const key = 'restaurant-id/random-photo.jpg';

test('cloud storage keeps bytes outside the server and supports rollback', async () => {
  const files = new Map<string, Uint8Array>();
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('apikey'), config.key);
    assert.equal(headers.get('x-upsert'), init?.method === 'POST' ? 'false' : null);
    const object = url.pathname.replace('/storage/v1/object/', '');
    if (init?.method === 'POST') {
      assert.equal(headers.get('content-type'), 'image/jpeg');
      assert.equal(headers.get('cache-control'), 'max-age=31536000');
      files.set(object, new Uint8Array(init.body as Buffer));
      return Response.json({ Key: object });
    }
    if (init?.method === 'DELETE') {
      const { prefixes } = JSON.parse(String(init.body));
      for (const path of prefixes) files.delete(config.bucket + '/' + path);
      return Response.json([]);
    }
    const bytes = files.get(object);
    return bytes ? new Response(Buffer.from(bytes), { headers: { 'Content-Type': 'image/jpeg' } }) :
      Response.json({ statusCode: '404', error: 'not_found', message: 'Object not found' }, { status: 404 });
  };
  const storage = createImageStorage(config, transport);
  const bytes = Buffer.from('test photo bytes');
  const file = await storage.upload(key, bytes, 'image/jpeg');
  assert.deepEqual(Buffer.from(await (await storage.download(key)).arrayBuffer()), bytes);
  await file.discard();
  await assert.rejects(storage.download(key), /Nie znaleziono zdjęcia/);
});

test('storage failures never return a successful upload or expose provider details', async () => {
  const storage = createImageStorage(config, async () => Response.json({ message: 'provider detail and credential' }, { status: 503 }));
  await assert.rejects(storage.upload(key, Buffer.from('image'), 'image/jpeg'), /Nie udało się zapisać zdjęcia/);
  await assert.rejects(storage.download(key), /Zdjęcie jest chwilowo niedostępne/);
});

test('partial cloud configuration fails instead of silently writing to temporary disk', () => {
  assert.equal(imageStorageConfig({}), undefined);
  assert.throws(() => imageStorageConfig({ SUPABASE_URL: config.url }));
  assert.throws(() => imageStorageConfig({ SUPABASE_SECRET_KEY: config.key }));
  assert.throws(() => imageStorageConfig({ SUPABASE_URL: 'http://example.com', SUPABASE_SECRET_KEY: config.key }));
  assert.deepEqual(imageStorageConfig({ SUPABASE_URL: config.url, SUPABASE_SECRET_KEY: config.key }), config);
});

test('setup creates a private bucket and refuses an existing public bucket', async () => {
  let exists = false;
  const storage = createImageStorage(config, async (_input, init) => {
    if (init?.method === 'POST') {
      const settings = JSON.parse(String(init.body));
      assert.equal(settings.public, false);
      assert.equal(settings.file_size_limit, 5 * 1024 * 1024);
      assert.deepEqual(settings.allowed_mime_types, ['image/jpeg', 'image/png', 'image/webp']);
      exists = true;
      return Response.json({ name: config.bucket });
    }
    return exists ? Response.json({ name: config.bucket, public: false }) :
      Response.json({ message: 'Bucket not found' }, { status: 404 });
  });
  await storage.ensureBucket();
  await storage.ensureBucket();
  const publicStorage = createImageStorage(config, async () => Response.json({ name: config.bucket, public: true }));
  await assert.rejects(publicStorage.ensureBucket(), /prywatny/);
});
