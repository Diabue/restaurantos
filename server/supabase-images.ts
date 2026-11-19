import { createClient } from '@supabase/supabase-js';
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';

export type ImageStorageConfig = { url: string; key: string; bucket: string };

export function imageStorageConfig(env: NodeJS.ProcessEnv = process.env): ImageStorageConfig | undefined {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = env.SUPABASE_STORAGE_BUCKET || 'restaurantos-products';
  if (!url && !key) return undefined;
  if (!url || !key || !/^https:\/\/[a-z0-9.-]+(?::\d+)?\/?$/i.test(url) || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(bucket)) {
    throw new Error('Ustaw poprawne SUPABASE_URL, SUPABASE_SECRET_KEY i SUPABASE_STORAGE_BUCKET.');
  }
  return { url, key, bucket };
}

export function createImageStorage(config: ImageStorageConfig, transport: typeof fetch = fetch) {
  const client = createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => transport(input, { ...init, signal: AbortSignal.timeout(15000) }) },
  });
  const bucket = client.storage.from(config.bucket);
  return {
    async upload(path: string, bytes: Buffer, contentType: string) {
      const { error } = await bucket.upload(path, bytes, { contentType, upsert: false, cacheControl: '31536000' });
      if (error) throw new ServiceUnavailableException('Nie udało się zapisać zdjęcia. Spróbuj ponownie.');
      return {
        discard: async () => {
          const { error } = await bucket.remove([path]);
          if (error) throw new ServiceUnavailableException('Nie udało się usunąć nieprzypisanego zdjęcia.');
        },
      };
    },
    async download(path: string) {
      const { data, error } = await bucket.download(path);
      if (error) {
        if (String(error.statusCode) === '404' || String(error.statusCode) === '400' && /not found/i.test(error.message)) throw new NotFoundException('Nie znaleziono zdjęcia.');
        throw new ServiceUnavailableException('Zdjęcie jest chwilowo niedostępne.');
      }
      return data;
    },
    async ensureBucket() {
      const { data, error } = await client.storage.getBucket(config.bucket);
      if (error && !['404', '400'].includes(String(error.status))) throw new Error('Nie udało się sprawdzić magazynu zdjęć Supabase.');
      if (data) {
        if (data.public) throw new Error('Magazyn zdjęć powinien być prywatny. Wybierz prywatny bucket.');
        return;
      }
      const created = await client.storage.createBucket(config.bucket, {
        public: false, fileSizeLimit: 5 * 1024 * 1024, allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
      });
      if (created.error) throw new Error('Nie udało się utworzyć magazynu zdjęć Supabase.');
    },
  };
}

let storage: ReturnType<typeof createImageStorage> | undefined;
export function cloudImageStorage() {
  const config = imageStorageConfig();
  if (!config) return undefined;
  return storage ??= createImageStorage(config);
}
