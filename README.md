# RestaurantOS

Polskie menu QR, wspólny koszyk stolika i aplikacja Android z trybami Kelner, Kuchnia i Manager. Wersja demonstracyjna używa prawdziwej bazy PostgreSQL i symuluje wystawianie paragonu.

Frontend można publikować automatycznie z tego repozytorium na [Cloudflare Pages](docs/cloudflare-pages.md). Android pozostaje w tym samym repozytorium. Backend wymaga osobnego uruchomienia; [instrukcja backendu i Supabase](docs/deployment.md) opisuje również opcjonalny wariant Render.

## Zrzuty ekranu

### Kelner

**Mapa sali**

![Mapa sali](docs/screenshots/kelner-mapa.png)

**Otwarcie stolika**

![Otwarcie stolika](docs/screenshots/kelner-otwarcie.png)

**Szczegóły stolika**

![Szczegóły stolika](docs/screenshots/kelner-stolik.png)

**Zamówienie od kelnera**

![Zamówienie od kelnera](docs/screenshots/kelner-zamowienie.png)

### Kuchnia

**Kolejka zamówień**

![Kolejka zamówień](docs/screenshots/kuchnia-kolejka.png)

### Manager

**Zarządzanie menu**

![Zarządzanie menu](docs/screenshots/manager-menu.png)

**Edycja planu sali**

![Edycja planu sali](docs/screenshots/manager-plan.png)

**Kod QR stolika**

![Kod QR stolika](docs/screenshots/manager-qr.png)

**Konta i uprawnienia**

![Konta i uprawnienia](docs/screenshots/manager-personel.png)

**Edycja konta pracownika**

![Edycja konta pracownika](docs/screenshots/manager-konto.png)

**Historia wizyt i rozliczeń**

![Historia wizyt i rozliczeń](docs/screenshots/manager-historia.png)

**Edycja danych lokalu**

![Edycja danych lokalu](docs/screenshots/manager-lokal.png)

## Demo na Windows

W katalogu projektu uruchom:

```powershell
npm.cmd ci
npm.cmd run demo
```

Pierwsze uruchomienie pobierze lokalny PostgreSQL do `.local`, wykona migracje i załaduje przykładową restaurację. Dane demo są zachowywane między uruchomieniami. Demo domyślnie nasłuchuje na adresie lokalnym komputera.

- Menu gościa otwiera się bezpośrednio z kodu QR przypisanego do stolika (`/t/<kod>`). Strona główna [http://localhost:3001/](http://localhost:3001/) zawiera wyłącznie instrukcję zeskanowania kodu. Linki i kody QR są dostępne w panelu Manager → Stoliki. Przy pierwszym dodaniu dania na wolnym stoliku gość ustawia własny sześciocyfrowy PIN. Pozostałe osoby przy stole wpisują ten sam PIN. Przeglądarka zapamiętuje dostęp do bieżącej wizyty, a PIN jest widoczny w szczegółach stolika w trybie Kelner. Po rozliczeniu stolik jest znów dostępny dla nowych gości.
- Obsługa w przeglądarce: [http://localhost:3001/staff?venue=oliwa](http://localhost:3001/staff?venue=oliwa). Lokal **oliwa**, login **manager**, hasło **demo1234**. Konto ma dostęp do wszystkich trzech trybów. Konta **kelner** i **kuchnia** mają to samo hasło i dostęp tylko do swojego trybu.
- Gość wysyła koszyk lub wybiera powód wezwania. Na mapie kelnera widać czas oczekiwania i porcje do podania. Po naciśnięciu **Akceptuj** pozycje trafiają na przypisane stanowiska. Dźwięk można sprawdzić przyciskiem **Włącz dźwięk** na ekranie kelnera lub kuchni.
- W trybie **Kuchnia** wybierz **Kuchnia** albo **Bar**. Możesz oznaczyć pojedynczą pozycję jako gotową. Zmiany ilości, uwag i anulowania pojawiają się na bonie razem z powodem. Stanowisko wybiera się w edycji dania, a próg alarmu w **Manager → Lokal → Edytuj dane** (domyślnie 15 minut).
- W szczegółach stolika kelner może przyjąć zamówienie ustne lub wybrać **Przenieś gości**. Przy przenosinach goście zachowują PIN i rachunek. Po podaniu całego zamówienia kelner oznacza je jako podane, wybiera **Rozlicz stolik** i przechodzi przez symulację wydruku.
- W trybie **Manager → Stoliki** wejdź w edycję planu, przeciągnij stoliki i zapisz układ. Możesz też dodać stolik i nadać mu numer. Przy tworzeniu lub edycji dania wybierz zdjęcie JPEG, PNG lub WebP do 5 MiB. Plik trafia do lokalnego katalogu `.local/uploads/products`, a baza przechowuje jego adres.

## Emulator Androida

Uruchom emulator:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\emulator.ps1
```

Skrypt tworzy wirtualny Pixel Tablet z Androidem 35, instaluje debug APK i otwiera RestaurantOS. Opcja `-Build` przebudowuje APK. Od wersji 0.2.0 domyślnym serwerem jest `https://restaurantos.maxstronytest.uk`. Lokal **oliwa**, login **manager**, hasło wygenerowane dla chmury (inne niż lokalne demo1234). Przy aktualizacji stary adres testowy jest jednorazowo zastępowany domeną. Do testów lokalnych można później ręcznie ustawić `http://10.0.2.2:3001` i uruchomić demo na komputerze.

Na innym komputerze zainstaluj JDK 17 lub 21 oraz pakiety Android SDK: Command-line Tools, Platform-Tools, Emulator, Android SDK Platform 35, Build-Tools 35.0.0 i obraz Google APIs x86_64 dla Androida 35. Włącz akcelerację wirtualizacji Windows i ustaw `ANDROID_HOME` na katalog SDK, jeśli jest niestandardowy. Skrypt rozpoznaje też SDK w `.local/android-sdk`. APK debug znajduje się w `android/app/build/outputs/apk/debug/app-debug.apk`.

Aplikacja ma kontener Kotlin/WebView i współdzieli widoki React z testowym adresem `/staff`. Pełny kiosk wymaga zarządzanego urządzenia Android Enterprise i dopuszczenia pakietu `pl.restaurantos.tablet` do Lock Task przez administratora. Konfiguracja zarządzana obsługuje `server_url`, `venue` oraz `mode` (`WAITER`, `KITCHEN`, `MANAGER`). Debug na emulatorze służy do sprawdzania interfejsu i obiegu zamówień. Kiosk odbiera się na zarządzanym tablecie.

## Uruchomienie z własną bazą

Skopiuj `.env.example` do `.env`, ustaw dane swojego PostgreSQL i wykonaj `npm.cmd run db:setup`. Lokalny PostgreSQL można uruchomić przez `docker compose up -d`. Utwórz lokal przez `npm.cmd run seed` z ustawionymi `BOOTSTRAP_SLUG`, `BOOTSTRAP_NAME`, `BOOTSTRAP_USER` i `BOOTSTRAP_PASSWORD`. Zbuduj aplikację webową przez `npm.cmd run build` i uruchom API przez `npm.cmd run api`. W środowisku lokalu używaj HTTPS oraz `DEMO_MODE=0`.

Wydruk demonstracyjny jest symulowany. Odbiór fiskalizacji wymaga wyboru jednego modelu, podłączenia sterownika producenta do stanowiska barowego i weryfikacji papierowego wydruku, wyniku po przerwaniu łączności oraz przebiegu płatności. API przechowuje zlecenie przed wydrukiem i blokuje ponowienie po niepewnym wyniku. Po odrzuceniu karty na zewnętrznym terminalu rachunek pozostaje otwarty do rozliczenia.

## Weryfikacja

```powershell
npm.cmd run build
npm.cmd run test:demo
```

Test używa oddzielnej bazy i portu 3002. Sprawdza ustawienie i reset PIN-u, wspólny koszyk z dwóch telefonów, kolejkę po akceptacji, zamknięcie sesji, zapis planu sali oraz przesłanie i wyświetlenie zdjęcia.

Zdjęcia w przykładowym menu pochodzą z [Unsplash](https://unsplash.com/).
