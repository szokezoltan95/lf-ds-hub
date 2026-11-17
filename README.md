# LF DS Hub

Členský portál Drone Soccer LF TUKE. Členovia potvrdzujú účasť na tréningoch, čítajú tímové oznamy a píšu trénerovi. Správca eviduje členov, dochádzku a klubové batérie.

## Lokálny štart

1. Skopíruj `.env.example` do `.env`. Vyplň heslo databázy, e-mail správcu a jeho úvodné heslo (aspoň 12 znakov). Použi silné, jedinečné heslá.
2. Spusti `docker compose -f compose.yml -f compose.local.yml up -d --build`.
3. Otvor http://localhost:8081/dronesoccer/ a prihlás sa ako správca. Otváraj presne adresu nastavenú v `HUB_PUBLIC_URL`.
4. V časti **Členovia** vytvor pozvánku a pošli členovi vygenerovaný odkaz. Rovnakým spôsobom môžeš vytvoriť odkaz na obnovu hesla. Odkaz funguje raz a najviac sedem dní.

Úvodné heslo vytvorí účet len pri prvom spustení s prázdnou databázou. Po jeho vytvorení odstráň hodnotu `HUB_ADMIN_PASSWORD` z `.env` a obnov kontajner hubu.

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
