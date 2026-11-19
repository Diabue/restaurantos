# Demo w chmurze: Supabase + Render + Cloudflare

Konfiguracja w repozytorium jest przygotowaniem do wdrożenia. Samo dodanie plików nie tworzy projektów ani rekordów DNS.

Jedna instancja serwera obsługuje stronę gościa, `/staff`, REST `/api` i WebSocket `/live`. PostgreSQL i prywatny magazyn zdjęć działają w Supabase. Domena testowa to `demo.maxstronytest.uk`.

## Supabase

1. Utwórz lub wybierz osobny projekt testowy, najlepiej w regionie bliskim Frankfurtowi. Nie używaj projektu z obcymi tabelami aplikacji.
2. W Connect skopiuj adres **Session pooler**, port **5432**. Wymaga hasła bazy, a nie klucza API. Hasło w URL musi być zakodowane zgodnie z formatem URL.
3. Ustaw `DATABASE_URL` według `.env.cloud.example`. Osobny schemat `restaurantos` oddziela aplikację od domyślnych schematów Supabase. Właściciel schematu/tabel wykonuje migracje oraz zapytania backendu. Na start ograniczamy pulę do pięciu połączeń.
4. Ustaw `SUPABASE_URL` i serwerowy `SUPABASE_SECRET_KEY` (`sb_secret_...`). Obsługiwany jest też starszy `SUPABASE_SERVICE_ROLE_KEY`. Klucze są wyłącznie na backendzie. Strona i APK nie otrzymują kluczy Supabase.
5. `SEED_ON_START=1` tworzy prywatny bucket `restaurantos-products` przy pierwszym uruchomieniu. Przesłane zdjęcia są przechowywane jako `<restaurant UUID>/<random UUID>.<extension>`. Backend udostępnia je pod dotychczasowymi adresami `/uploads/products/...`.

Nie dodawaj schematu `restaurantos` do exposed schemas w Data API. Migracja dodatkowo włącza RLS na tabelach aplikacji, bez polityk dla klientów Supabase. Dostęp do kont, PIN-ów i zamówień prowadzi przez autoryzację NestJS. Ten układ wymaga połączenia backendu jako właściciel tabel lub rola BYPASSRLS.

## Render

1. Połącz prywatne repozytorium `Diabue/restaurantos` z kontem Render.
2. Utwórz Blueprint z `render.yaml`. Konfiguracja wybiera darmową usługę Docker we Frankfurcie. Nie tworzy dodatkowej bazy Render.
3. Uzupełnij trzy wartości oznaczone `sync: false`: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`.
4. Render generuje osobne `DEMO_PASSWORD`. Konto managera ma login `manager`, lokal `oliwa`. Konta `kelner` i `kuchnia` początkowo używają tego samego wygenerowanego hasła. Można nadać im osobne hasła w panelu managera. Hasło nie jest `demo1234`.
5. Przy starcie `npm start` wykonuje migracje, przygotowuje bucket i uzupełnia dane przykładowe bez nadpisywania istniejących. Następnie uruchamia API. Health check korzysta z `/api/health` i sprawdza połączenie z bazą.
6. Utrzymuj **jedną instancję**. WebSockety i ograniczanie prób są obecnie przechowywane w pamięci procesu. Wiele instancji wymaga wspólnego brokera i limitera.

`DEMO_MODE=1` zachowuje wybór stolików i symulowane paragony do pokazów. Nie używaj tego wdrożenia do prawdziwej fiskalizacji. Nie uruchamiaj `npm run demo` na hostingu, ponieważ ten skrypt tworzy lokalny PostgreSQL.

Bezpłatny Render może usypiać po 15 minutach bez ruchu. Wybudzenie może potrwać około minuty. Pliki na dysku serwera są nietrwałe, dlatego zdjęcia trafiają do Supabase Storage. Ciągła praca wymaga odpowiedniego planu hostingu.

## Cloudflare DNS

Po uruchomieniu usługi odczytaj jej faktyczny adres `*.onrender.com`. Nie zakładaj adresu na podstawie nazwy projektu.

W strefie `maxstronytest.uk` dodaj:

| Typ | Nazwa | Cel | Proxy |
| --- | --- | --- | --- |
| CNAME | demo | faktyczny adres usługi Render, bez `https://` | DNS only na czas weryfikacji certyfikatu |

Nie zmieniaj rekordów domeny głównej ani innych subdomen. Jeśli `demo` ma już rekord, sprawdź jego dotychczasowe przeznaczenie przed zmianą. W Render zweryfikuj domenę i poczekaj na aktywny certyfikat HTTPS. Sprawdź `https://demo.maxstronytest.uk/api/health`, `/`, `/staff?venue=oliwa` i połączenie WebSocket.

## Android i odbiór

Na tablecie ustaw serwer `https://demo.maxstronytest.uk`. Zaloguj się wygenerowanym hasłem. Nie trzeba umieszczać danych bazy w APK.

Sprawdź na dwóch telefonach i tablecie wspólny koszyk, akceptację kelnera, kuchnię, status podania, wezwanie i symulowane zamknięcie stolika. Dodaj zdjęcie, wykonaj restart serwera i upewnij się, że zdjęcie oraz dane nadal istnieją. Sprawdź, że klucz publishable/anon nie może pobrać tabel z kontami i PIN-ami.

Wdrożenie tworzy osobną bazę demonstracyjną. Nie przenosi automatycznie lokalnej historii, kont, zmienionego menu ani wcześniej przesłanych zdjęć. Migrację danych z komputera trzeba wykonać osobno, zachowując identyfikatory i zmieniając testowe hasła przed udostępnieniem.

## Źródła konfiguracji

- [Supabase: połączenie z PostgreSQL](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase: Prisma](https://supabase.com/docs/guides/database/prisma)
- [Supabase: klucze API](https://supabase.com/docs/guides/getting-started/api-keys)
- [Supabase: Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Render: WebSockety](https://render.com/docs/websocket)
- [Render: ograniczenia darmowych usług](https://render.com/docs/free)
- [Render: Cloudflare DNS](https://render.com/docs/configure-cloudflare-dns)
