# Technická prevádzka

[Prehľad dokumentácie](index.md) · [Architektúra a vývoj](architektura.md)

## Konfigurácia

Príkazy Docker Compose spúšťaj v koreňovom adresári repozitára. Priprav `.env` zo súboru [`.env.example`](../.env.example) a ulož ho mimo verzovaných zmien. `compose.yml` definuje služby `hub` a `db`. Podľa prostredia k nemu pridaj `compose.local.yml` alebo `compose.thrust.yml`.

| Premenná | Účel |
| --- | --- |
| `POSTGRES_PASSWORD` | Heslo pre databázu `hub`. PostgreSQL používa túto hodnotu pri inicializácii prázdneho zväzku. Pri zmene na existujúcej databáze treba zosúladiť aj heslo databázovej roly. |
| `HUB_PUBLIC_URL` | Kanonická adresa portálu vrátane prefixu, napríklad `https://thrust.lf.tuke.sk/dronesoccer/`. Určuje trasu aplikácie, odkazy a nastavenia relácie. |
| `HUB_ADMIN_PASSWORD` | Heslo systémového účtu `admin`, 8 až 128 znakov. Pri zmene znovu vytvor kontajner `hub`. Aplikácia pri štarte zruší doterajšie relácie superadmina. |

## Lokálny štart

Pre lokálne nasadenie použi `HUB_PUBLIC_URL=http://localhost:8081/dronesoccer/`.

```sh
cp .env.example .env
# Pred pokračovaním vyplň heslá v .env.
docker compose -f compose.yml -f compose.local.yml up -d --build
docker compose -f compose.yml -f compose.local.yml ps
```

Otvor [lokálny portál](http://localhost:8081/dronesoccer/) a prihlás sa ako `admin`. V časti **Členovia** založ klubový účet alebo pozvánku. Lokálne mapovanie portu je viazané na `127.0.0.1`.

## Nasadenie na serveri THRUST

V produkčnom `.env` nastav `HUB_PUBLIC_URL=https://thrust.lf.tuke.sk/dronesoccer/`. HTTPS frontend THRUST-webdb musí byť spustený a musí existovať externá sieť `thrust_webdb_hub_proxy`. Hub sa do siete pripája pod menom `lf-ds-hub`. Verejné smerovanie prefixu `/dronesoccer/` zabezpečuje Nginx THRUST a port hubu sa nezverejňuje priamo.

```sh
docker compose -f compose.yml -f compose.thrust.yml up -d --build
docker compose -f compose.yml -f compose.thrust.yml ps
```

Použi kanonickú adresu pri prístupe k portálu aj pri tvorbe QR štítkov s odkazom. Pred presunom na inú doménu alebo prefix skontroluj presmerovanie, nainštalované PWA, odbery Web Push a vytlačené QR štítky so starou adresou. Pri nahrávaní súborov musí proxy prepustiť požiadavky potrebnej veľkosti vrátane réžie formulára.

## Aktualizácie a migrácie

1. Zaznamenaj aktuálny commit a vytvor zálohu PostgreSQL.
2. Aktualizuj zdrojový kód a znovu zostav hub s rovnakými Compose súbormi ako pri nasadení.
3. Over stav služieb, dostupnosť `/dronesoccer/api/health` a prihlásenie klubovým účtom. Po aktualizácii oprávnení over aj dôležité pracovné postupy s konkrétnou rolou.

SQL schémy sa aplikujú automaticky pri štarte aplikácie. Pri prechode zo starého menu na práva podľa akcií sa pôvodné práva jednorazovo prevedú. Nové nastavenia rolí sa pri ďalších štartoch zachovajú. Pri staršom nasadení nastav `HUB_ADMIN_PASSWORD` už pred prvým štartom novej verzie. Historický správca s e-mailom sa prevedie na klubový účet trénera, jeho heslo a história zostanú. Položka `HUB_ADMIN_EMAIL` už nie je potrebná.

Pri návrate na staršiu verziu over kompatibilitu jej kódu so stavom databázy. Ak aktualizácia zmenila schému nekompatibilne, obnov zodpovedajúcu zálohu do samostatnej databázy a over ju pred návratom do prevádzky.

## Zálohovanie a skúška obnovy

Databáza je uložená v Compose zväzku `hub-data`. Nasledujúci príklad používa produkčnú konfiguráciu. Pri lokálnom nasadení nahraď `compose.thrust.yml` súborom `compose.local.yml`.

```sh
docker compose -f compose.yml -f compose.thrust.yml exec -T db pg_dump -U hub -d hub -Fc > hub-backup.dump
```

Záloha obsahuje členské údaje, správy, prílohy a dokumenty, heslové hashe, relácie a Web Push kľúče. Ukladaj ju s obmedzeným prístupom a over, že príkaz skončil úspešne. Konfiguráciu nasadenia a tajomstvá zabezpeč samostatne.

Príklad skúšky obnovy do novej databázy `hub_restore_check` v izolovanom lokálnom prostredí s rovnakou hlavnou verziou PostgreSQL:

```sh
docker compose -f compose.yml -f compose.local.yml up -d db
docker compose -f compose.yml -f compose.local.yml exec -T db createdb -U hub hub_restore_check
docker compose -f compose.yml -f compose.local.yml exec -T db pg_restore -U hub --exit-on-error -d hub_restore_check < hub-backup.dump
docker compose -f compose.yml -f compose.local.yml exec -T db psql -U hub -d hub_restore_check -c 'SELECT count(*) FROM members;'
```

Pre úplnú skúšku over aj tabuľky udalostí, vybavenia a oprávnení. Pri spustení skúšobnej aplikácie s produkčnými dátami izoluj odchádzajúce doručovanie push, aby sa obnovená fronta neodoslala používateľom.

## Diagnostika

| Príznak | Kde začať |
| --- | --- |
| Služba nenabieha | Skontroluj `docker compose -f compose.yml -f compose.thrust.yml ps` a `docker compose -f compose.yml -f compose.thrust.yml logs --tail=100 hub db`. |
| Nginx vracia chybu alebo sa nenačíta frontend | Over, že hub je zdravý, že existuje externá sieť, ako aj súlad verejnej adresy a prefixu smerovaného cez nginx. Frontend sa zostavuje ako súčasť obrazu hubu. |
| Kamera sa neotvorí alebo nevidí štítok | Over HTTPS, povolenie kamery a vybrané zariadenie. Dočasne použi ručný vstup alebo USB skener. |
| Neprichádza Web Push | Over prihlásenie, povolenie a kategórie na zariadení, odber v profile a odchádzajúce HTTPS z hubu k Web Push službám. VAPID kľúče vznikajú automaticky a zostávajú v databáze. |
| Používateľ nevidí funkciu | Over jeho efektívne práva a prípadné ďalšie podmienky záznamu. Postup je v [príručke oprávnení](opravnenia.md). |
| Príloha sa nenahrá | Skontroluj limit aplikácie pre daný formát a limit veľkosti tela požiadavky v reverznej proxy. |
