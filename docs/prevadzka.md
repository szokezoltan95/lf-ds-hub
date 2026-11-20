# Technická prevádzka

[Prehľad dokumentácie](index.md) · [Architektúra a vývoj](architektura.md)

## Konfigurácia

Príkazy Docker Compose sa spúšťajú v koreňovom adresári repozitára. Súbor `.env` sa vytvára podľa šablóny [`.env.example`](../.env.example) a uchováva sa mimo verzovaných zmien. Súbor `compose.yml` definuje služby `hub` a `db`. Podľa prostredia sa používa spolu so súborom `compose.local.yml` alebo `compose.thrust.yml`.

| Premenná | Účel |
| --- | --- |
| `POSTGRES_PASSWORD` | Heslo pre databázu `hub`. PostgreSQL používa túto hodnotu pri inicializácii prázdneho zväzku. Pri zmene na existujúcej databáze treba zosúladiť aj heslo databázovej roly. |
| `HUB_PUBLIC_URL` | Kanonická adresa portálu vrátane prefixu, napríklad `https://thrust.lf.tuke.sk/dronesoccer/`. Určuje trasu aplikácie, odkazy a nastavenia relácie. |
| `HUB_ADMIN_PASSWORD` | Heslo systémového účtu `admin`, 8 až 128 znakov. Po zmene hesla je potrebné znovu vytvoriť kontajner `hub`. Aplikácia pri štarte zruší doterajšie relácie superadmina. |

## Lokálny štart

Pri lokálnom nasadení sa používa `HUB_PUBLIC_URL=http://localhost:8081/dronesoccer/`.

```sh
cp .env.example .env
# Pred spustením je potrebné nastaviť heslá v .env.
docker compose -f compose.yml -f compose.local.yml up -d --build
docker compose -f compose.yml -f compose.local.yml ps
```

Po spustení možno otvoriť [lokálny portál](http://localhost:8081/dronesoccer/) a prihlásiť sa účtom `admin`. V časti **Členovia** možno založiť klubový účet alebo vytvoriť pozvánku. Lokálne mapovanie portu je viazané na `127.0.0.1`.

## Nasadenie na serveri THRUST

V produkčnom súbore `.env` sa nastavuje `HUB_PUBLIC_URL=https://thrust.lf.tuke.sk/dronesoccer/`. HTTPS frontend THRUST-webdb musí byť spustený a musí existovať externá sieť `thrust_webdb_hub_proxy`. Hub sa do siete pripája pod menom `lf-ds-hub`. Verejné smerovanie prefixu `/dronesoccer/` zabezpečuje Nginx THRUST a port hubu sa nezverejňuje priamo.

```sh
docker compose -f compose.yml -f compose.thrust.yml up -d --build
docker compose -f compose.yml -f compose.thrust.yml ps
```

Kanonická adresa sa používa pri prístupe k portálu aj pri tvorbe QR štítkov s odkazom. Pred zmenou domény alebo prefixu je potrebné overiť presmerovanie, nainštalované PWA, odbery Web Push a vytlačené QR štítky so starou adresou. Limit požiadavky v proxy musí pri nahrávaní pokryť veľkosť súboru aj réžiu formulára.

## Aktualizácie a migrácie

1. Zaznamenať aktuálny commit a vytvoriť zálohu PostgreSQL.
2. Aktualizovať zdrojový kód a znovu zostaviť hub s rovnakými súbormi Compose ako pri nasadení.
3. Overiť stav služieb, dostupnosť `/dronesoccer/api/health` a prihlásenie klubovým účtom. Po zmene oprávnení overiť aj dôležité pracovné postupy s konkrétnou rolou.

SQL schémy sa aplikujú automaticky pri štarte aplikácie. Pri prechode zo starého menu na práva podľa akcií sa pôvodné práva jednorazovo prevedú. Nové nastavenia rolí sa pri ďalších štartoch zachovajú. Pri aktualizácii staršieho nasadenia je potrebné nastaviť `HUB_ADMIN_PASSWORD` pred prvým štartom novej verzie. Pôvodný účet správcu s e-mailom sa prevedie na klubový účet trénera so zachovaním hesla a histórie. Nastavenie `HUB_ADMIN_EMAIL` je zastarané.

Pred návratom na staršiu verziu je potrebné overiť kompatibilitu jej kódu s aktuálnym stavom databázy. Pri nekompatibilnej zmene schémy je potrebné obnoviť zodpovedajúcu zálohu do samostatnej databázy a overiť ju pred návratom do prevádzky.

## Zálohovanie a skúška obnovy

Databáza je uložená vo zväzku Compose `hub-data`. V príklade sa používa produkčná konfigurácia. Pri lokálnom nasadení sa namiesto `compose.thrust.yml` používa súbor `compose.local.yml`.

```sh
docker compose -f compose.yml -f compose.thrust.yml exec -T db pg_dump -U hub -d hub -Fc > hub-backup.dump
```

Záloha obsahuje členské údaje, správy, prílohy, dokumenty, heslové hashe, relácie a kľúče Web Push. Zálohu je potrebné uložiť s obmedzeným prístupom a overiť úspešné dokončenie príkazu. Konfiguráciu nasadenia a tajomstvá je potrebné zabezpečiť samostatne.

Skúšku obnovy možno vykonať do novej databázy `hub_restore_check` v izolovanom lokálnom prostredí s rovnakou hlavnou verziou PostgreSQL.

```sh
docker compose -f compose.yml -f compose.local.yml up -d db
docker compose -f compose.yml -f compose.local.yml exec -T db createdb -U hub hub_restore_check
docker compose -f compose.yml -f compose.local.yml exec -T db pg_restore -U hub --exit-on-error -d hub_restore_check < hub-backup.dump
docker compose -f compose.yml -f compose.local.yml exec -T db psql -U hub -d hub_restore_check -c 'SELECT count(*) FROM members;'
```

Úplná skúška zahŕňa aj kontrolu tabuliek udalostí, vybavenia a oprávnení. Pri spustení skúšobnej aplikácie s produkčnými údajmi je potrebné izolovať odchádzajúce doručovanie push, aby sa obnovená fronta neodoslala používateľom.

## Diagnostika

| Príznak | Kde začať |
| --- | --- |
| Služba nenabieha | Skontrolovať stav a záznamy služieb príkazmi `docker compose -f compose.yml -f compose.thrust.yml ps` a `docker compose -f compose.yml -f compose.thrust.yml logs --tail=100 hub db`. |
| Nginx vracia chybu alebo sa nenačíta frontend | Overiť stav hubu, existenciu externej siete a súlad verejnej adresy s prefixom smerovaným cez Nginx. Frontend sa zostavuje ako súčasť obrazu hubu. |
| Kamera sa neotvorí alebo nevidí štítok | Overiť HTTPS, povolenie kamery a vybrané zariadenie. Dočasne možno použiť ručný vstup alebo USB skener. |
| Neprichádza Web Push | Overiť prihlásenie, povolenia a kategórie na zariadení, odber v profile a odchádzajúce HTTPS spojenie z hubu k službám Web Push. Kľúče VAPID vznikajú automaticky a zostávajú v databáze. |
| Používateľ nevidí funkciu | Overiť efektívne práva používateľa a prípadné ďalšie podmienky záznamu. Postup je uvedený v [príručke oprávnení](opravnenia.md). |
| Príloha sa nenahrá | Skontrolovať limit aplikácie pre daný formát a limit veľkosti tela požiadavky v reverznej proxy. |
