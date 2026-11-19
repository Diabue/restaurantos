import { cloudImageStorage } from '../server/supabase-images';

const storage = cloudImageStorage();
if (!storage) throw new Error('Ustaw dane Supabase Storage.');
await storage.ensureBucket();
console.log('Prywatny magazyn zdjęć Supabase jest gotowy.');
