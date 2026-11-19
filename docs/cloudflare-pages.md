# Cloudflare Pages

Frontend i aplikacja Android pozostają w repozytorium `Diabue/restaurantos`.
Cloudflare buduje wyłącznie frontend. Katalog `android` nie jest publikowany jako strona.

| Ustawienie | Wartość |
| --- | --- |
| Repozytorium | Diabue/restaurantos |
| Gałąź | main |
| Katalog główny | / |
| Build | npm run build:web |
| Katalog wynikowy | dist |
| Node | 24 |
| Domena | restaurantos.maxstronytest.uk |

Sam frontend nie wymaga płatnego planu Workers. Pliki aplikacji znajdują się w `web`, zasoby w `public`, wspólne typy w `shared`.

Backend NestJS z PostgreSQL i WebSocketami jest osobną częścią aplikacji. Pages nie uruchamia `server/main.ts` ani lokalnego PostgreSQL. Wdrożenie frontendu nie oznacza działających zamówień, logowania czy integracji z bazą. Bez podłączonego API menu zależne od danych pokaże błąd ładowania.

Na hostingu nie należy umieszczać sekretów bazy w zmiennych `VITE_`. Integracja Supabase i backendu pozostaje zadaniem oddzielnym od publikacji statycznego frontendu.
