# LF DS Hub

Členský portál Drone Soccer LF TUKE. Členovia potvrdzujú účasť na tréningoch, čítajú tímové oznamy a píšu trénerovi. Správca eviduje členov, dochádzku a klubové batérie.

## Lokálny štart

1. Skopíruj `.env.example` do `.env`. Vyplň heslo databázy a `HUB_ADMIN_PASSWORD` (8 až 128 znakov). Použi silné, jedinečné heslá.
2. Spusti `docker compose -f compose.yml -f compose.local.yml up -d --build`.
3. Otvor http://localhost:8081/dronesoccer/ a prihlás sa ako `admin` s heslom z `HUB_ADMIN_PASSWORD`. Otváraj presne adresu nastavenú v `HUB_PUBLIC_URL`.
4. V časti **Členovia** vytvor trénerský účet s menom, e-mailom a heslom.
5. Pre člena vytvor pozvánku a pošli členovi vygenerovaný odkaz. Rovnakým spôsobom môžeš vytvoriť odkaz na obnovu hesla. Odkaz funguje raz a najviac sedem dní.

Systémový účet `admin` nemá e-mail. Hodnotu `HUB_ADMIN_PASSWORD` ponechaj v
`.env`. Po zmene hesla znovu vytvor kontajner hubu. Existujúce relácie systémového
účtu sa pri zmene hesla ukončia.

Tréneri sa prihlasujú e-mailom. Spravujú členské účty, tréningy, dochádzku,
oznamy, správy a batérie. Trénerské účty, zmeny rolí a trvalé odstránenie
člena spravuje superadmin.

Pri aktualizácii nastav `HUB_ADMIN_PASSWORD` ešte pred zostavením. Položku
`HUB_ADMIN_EMAIL` môžeš odstrániť. Pôvodný správca s e-mailom sa automaticky
zmení na trénera, zachová si heslo aj históriu a musí sa znovu prihlásiť.

## Server THRUST

V produkčnom `.env` nastav `HUB_PUBLIC_URL=https://thrust.lf.tuke.sk/dronesoccer/`. Najprv spusti HTTPS frontend THRUST-webdb podľa jeho README. Vytvorí sieť `thrust_webdb_hub_proxy`. Potom spusti hub bez lokálneho mapovania portu:

```sh
docker compose -f compose.yml -f compose.thrust.yml up -d --build
```

Hub a THRUST majú samostatné aplikačné kontajnery, účty, databázy a zväzky. Verejné HTTPS smerovanie zabezpečuje Nginx THRUST. Pri presune na vlastnú doménu zmeň `HUB_PUBLIC_URL` a pravidlá proxy. Vytlačené QR štítky smerujú na adresu platnú pri ich vytvorení.

Zálohu databázy vytvor:

```sh
docker compose exec -T db pg_dump -U hub -d hub -Fc > hub-backup.dump
```

Záloha obsahuje členské údaje. Over obnovu do oddelenej databázy pred použitím v prevádzke.

## Mobilné rozhranie

Navigácia je na telefóne vo vysúvacom menu. Na širokej obrazovke je bočný panel
trvalo otvorený. Domovská stránka zobrazuje najbližšie udalosti, odpovede na
účasť, nové správy a pripnutý oznam. Kalendár má zoznam aj mesačný pohľad.

Tréner vytvára udalosti s typom, začiatkom, voliteľným koncom, uloženým miestom
a týždenným opakovaním. Detail udalosti obsahuje informácie, odpovede a hromadný
zápis dochádzky. Členovia majú vyhľadávanie, filtre a profily. Správy sú
usporiadané podľa konverzácií. Vlastný profil obsahuje úpravu mena, zmenu hesla
a osobnú dochádzku. Heslo systémového účtu sa nastavuje v prostredí servera.

Klubové PDF dokumenty sú dostupné po prihlásení. Tréner ich môže nahrať
(najviac 5 MB) a odstrániť. Obsah sa ukladá do PostgreSQL a je súčasťou zálohy
databázy. Pri aktualizácii z pôvodnej verzie obnov aj frontend THRUST-webdb,
aby Nginx prijímal nahrávanie dokumentov do 5 MB:

```sh
docker compose -f docker-compose.yml -f docker-compose.https.yml up -d --no-deps --force-recreate frontend
```

Príkaz spusti v adresári aktualizovaného THRUST-webdb. Zmeny databázovej schémy
hubu sa aplikujú automaticky pri jeho štarte.

## Klubová komunikácia

Kontakty a zoznam členov zobrazujú trénerov aj členov. Systémový účet
superadmina je z klubovej komunikácie a zoznamov používateľov vynechaný.
Bežní používatelia môžu začať súkromnú konverzáciu s ktorýmkoľvek iným
aktívnym používateľom cez **Nová správa**.

Skupina **Celý tím** zahŕňa všetkých aktívnych členov a trénerov s aktivovaným
účtom. **Tréneri** zahŕňa len trénerov. Ich členstvo sa automaticky prispôsobuje
rolám. Tréneri môžu vytvárať vlastné skupiny. Tréner patriaci do vlastnej
skupiny môže upraviť jej názov a účastníkov. Účastníci vlastnej skupiny vidia
celú jej históriu. Odobratý používateľ stratí prístup k skupine okamžite.

Manifest PWA odkazuje na modré ikony `icon-blue-192.png` a
`icon-blue-512.png`. Ich zdrojom je `frontend/public/app-icon.svg`, ktorý
používa rovnaký symbol dronu a fakultnú modrú ako hlavička aplikácie.

## Inštalácia PWA

Aplikácia sa inštaluje pod názvom **DroneSoccer LF**. V menu a profile je
tlačidlo na inštaláciu. Keď prehliadač sprístupní inštalačný dialóg,
na domovskej stránke sa zobrazí aj ponuka. Kliknutie otvorí dialóg prehliadača,
ktorý používateľ potvrdí. Po zrušení sa ponuka na domovskej stránke skryje
do ďalšieho načítania stránky.

Aplikácia rozlišuje iOS/iPadOS, Android a desktopové systémy. Pri nedostupnom
dialógu zobrazí návod podľa zariadenia. Na iPhone sa používa Zdieľať a Pridať
na plochu. V samostatnom okne nainštalovanej aplikácie je ponuka skrytá.
