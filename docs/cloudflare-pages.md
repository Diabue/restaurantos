# Wdrożenie RestaurantOS

## Automatyczne sprawdzanie bazy

GitHub Actions uruchamia `scripts/keepalive.mjs` trzy razy dziennie: 02:17, 10:17 i 18:17 UTC. Workflow można uruchomić ręcznie w Actions → Supabase database health. Wywołuje istniejący endpoint `/api/health`, który wykonuje `SELECT 1` w bazie. Nie wymaga sekretów GitHuba i nie tworzy danych testowych. Błędy kończą workflow niepowodzeniem i są widoczne w Actions.

Supabase Free może wstrzymywać projekty po 7 dniach niskiej aktywności. Regularne odczyty nie gwarantują braku pauzy. Harmonogram GitHuba może być opóźniony. Wstrzymany projekt trzeba przywrócić w panelu Supabase; ten skrypt go sam nie przywraca. [Zasady Supabase](https://supabase.com/docs/guides/platform/free-project-pausing).

Frontend i Android pozostają w repozytorium `Diabue/restaurantos`. Frontend jest publikowany automatycznie z gałęzi `main` na Cloudflare Pages.

- Adres: https://restaurantos.maxstronytest.uk — instrukcja zeskanowania kodu; bez publicznego wyboru stolika.
- Kody QR prowadzą bezpośrednio do `/t/<kod>`. Linki stolików są dostępne dla managera po zalogowaniu.
- Panel obsługi: https://restaurantos.maxstronytest.uk/staff?venue=oliwa
- Build Pages: `npm run build:web`, katalog `dist`, Node 24.
- Zmienna Pages: `VITE_SUPABASE_URL=https://nyubvcwrthpbeeaiaquu.supabase.co`.
- Funkcja API: `restaurantos-api` w Supabase, kod źródłowy `server/edge.ts`.
- Dane: prywatny schemat PostgreSQL `restaurantos`, RLS i brak grantów dla anon/authenticated.
- Zdjęcia: prywatny Supabase Storage `restaurantos-products`; pobieranie przez API.

Funkcja współdzieli kontrolery i walidację z lokalnym NestJS. Bundle jest budowany przez `npm run build:edge` (generator Prisma Deno, adapter PostgreSQL i runtime WASM). Wdrożenie funkcji wymaga ponownego uruchomienia build:edge i publikacji plików z `supabase/functions/restaurantos-api`. Zmiany frontendu publikują się automatycznie z GitHuba. Zmiany API należy osobno wdrożyć w Supabase.

Edge używa wbudowanych sekretów `SUPABASE_DB_URL`, `SUPABASE_URL` i `SUPABASE_SERVICE_ROLE_KEY`. Nie trafiają do repozytorium ani frontendu. `verify_jwt=false` jest zamierzone: menu i logowanie są publiczne, a kontrolery każdej chronionej operacji sprawdzają token pracownika/gościa przekazany nagłówkiem `X-Restaurant-Token`. Tokeny są przechowywane w bazie w postaci skrótów. Próby logowania i PIN-u są limitowane w PostgreSQL.

W tej wersji chmurowej aktualizacje są pobierane co 3,5 sekundy. Lokalny NestJS nadal korzysta z WebSocketów. To wdrożenie demonstracyjne, z symulacją fiskalizacji. Prawdziwa drukarka pozostaje osobną integracją.

Przy pierwszym wdrożeniu utworzono 8 stolików, przykładowe menu i konta manager/kelner/kuchnia w lokalu oliwa. Losowe hasło jest zapisane wyłącznie na komputerze operatora w ignorowanym `.local/cloud-access.txt`. Lokalna historia zamówień nie była przenoszona. Nie uruchamiaj bootstrap.sql ponownie na istniejącej bazie; dalsze zmiany powinny być migracjami.

Na Androidzie ustaw adres serwera `https://restaurantos.maxstronytest.uk`. Istniejący APK obsługuje zmianę adresu; przebudowanie nie jest wymagane. Przeglądarka i tablet używają wspólnej bazy.

Sprawdzono w chmurze dwa telefony, koszyk, powtórzenie wysłania, akceptację kelnera przed kuchnią, przygotowanie/podanie, symulowane rozliczenie, reset PIN-u, izolację ról, zapis układu i przesyłanie/pobieranie zdjęć.
