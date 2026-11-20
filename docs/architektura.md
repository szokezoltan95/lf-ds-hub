# Architektúra a vývoj

[Prehľad dokumentácie](index.md) · [Technická prevádzka](prevadzka.md)

## Súčasti portálu

```mermaid
flowchart LR
    Browser["Prehliadač alebo PWA"] --> Proxy["HTTPS proxy"]
    Proxy --> Hub["Drone Soccer Hub"]
    Hub --> DB["PostgreSQL"]
    Hub --> Push["Web Push služby"]
```

V produkcii HTTPS proxy prevádzkuje THRUST-webdb. Hub má vlastné účty a databázu. Pri lokálnom štarte sa prehliadač pripája priamo na port hubu zverejnený na localhoste.

| Súčasť | Zodpovednosť | Zdroj |
| --- | --- | --- |
| React a Vite | Rozhranie portálu, lokálne preklady, rozloženie pre telefón a desktop. Navigácia používa fragment adresy aj pri odkaze z upozornenia. | [frontend](../frontend) |
| FastAPI a Uvicorn | Prihlásenie, pravidlá prístupu, API, validácia údajov, zápisy a obsluha zostaveného rozhrania. | [app.py](../app.py) |
| PostgreSQL | Klubové údaje, relácie, história, súbory, nastavenia a doručovacia fronta. | [Hlavná schéma](../schema.sql), [vybavenie](../equipment_schema.sql), [oprávnenia](../permissions_schema.sql) |
| Service worker | Inštalovateľné rozhranie a príjem Web Push. Do upozornenia načíta podrobnosti podľa aktuálnej relácie a oprávnení. | [sw.js](../frontend/public/sw.js), [manifest](../frontend/public/manifest.webmanifest) |
| Skener | Dekódovanie čiarových a QR kódov na zariadení. API dostáva rozpoznaný text. | [scanner.jsx](../frontend/scanner.jsx), [scanner-worker.js](../frontend/scanner-worker.js) |
| Doručovací pracovník | Databázová fronta Web Push, podpisovanie VAPID, opakovanie dočasných chýb a čistenie neplatných odberov. | [push_service.py](../push_service.py) |

## Údaje a pracovné postupy

- **Identita.** Členský účet má roly, profil a nastavenia. Heslá sú uložené ako hashe, server overuje reláciu pomocou cookie. Pozvánky, obnovovacie odkazy a členské QR kódy majú odlišné účely aj životnosť.
- **Udalosti.** Udalosť má typ, časy, miesto a prípadne autora. Odpoveď na pôvodnú udalosť, skutočná dochádzka, história úprav a odpovede na jednotlivé verzie termínu sa pri zápise posudzujú samostatne. Hlasovanie nad návrhom má vlastné termíny a hlasy. Schválený návrh odkazuje na vytvorenú udalosť.
- **Tréning a nominácie.** Klubová zostava je všeobecná, zostava udalosti a odpovede na nomináciu sú naviazané na konkrétnu udalosť. Plány, poznámky, spätná väzba a hodnotenia majú samostatné prístupové pravidlá.
- **Vybavenie.** Batérie a ostatné zariadenia majú samostatnú evidenciu histórie. Stav vychádza zo záznamov úkonov. Zápožička má vlastníka záznamu, príjemcu a samostatné stavy prevzatia a vrátenia. Dlhodobé pridelenie vedie väzbu na členský účet.
- **Komunikácia.** Prístup k správam vychádza z účasti na konverzácii a práv. Oznamy sa riadia publikom a prílohy overujú prístup pri stiahnutí. Klubové dokumenty sú uložené v databáze spolu s potvrdeniami oboznámenia.
- **Upozornenia.** Účet má preferencie kategórií a samostatné odbery pre zariadenia. Kľúče VAPID, odbery a fronta zostávajú v databáze aj pri novom zostavení kontajnera. Fronta po dočasnej chybe doručenie opakuje a spracúva záznamy s platnosťou 24 hodín. Rozpracované prílohy majú vlastné čistenie.

## API a rozšírenie oprávnení

API je dostupné pod `<prefix>/api`. V produkcii je prefix `/dronesoccer`. Základná kontrola je `GET /api/health` s príslušným prefixom. Automatické verejné rozhranie OpenAPI je vypnuté. Aktuálny zoznam trás je v dekorátoroch [app.py](../app.py).

| Skupina trás pod `/api` | Funkcie |
| --- | --- |
| `/login`, `/logout`, `/me`, `/members` | Relácie, profil, nastavenia, pozvánky, účty a členské QR. |
| `/role-config`, `/role-catalog`, `/role-preview`, `/role-requests` | Katalóg, konfigurácia práv, audit, náhľad a žiadosti o roly. |
| `/trainings`, `/training-proposals`, `/places`, `/attendance`, `/scan` | Kalendár, odpovede, návrhy, miesta, dochádzka a skenovanie. |
| `/lineup`, `/drills`, `/development` | Zostavy, cvičenia a rozvoj. Zostavy udalostí, plán a spätná väzba sú pod `/trainings/{id}`. |
| `/conversations`, `/messages`, `/chat-groups`, `/announcements`, `/documents` | Klubová komunikácia, zverejňovanie, prílohy a dokumenty. |
| `/batteries`, `/battery-charges`, `/equipment` | Evidencia, úkony, servis, pridelenia a zápožičky. |
| `/push` | Konfigurácia Web Push, odbery a podrobnosti oznámení. |

Pri pridávaní funkcie použi stabilný identifikátor `stranka.blok.akcia` v [permissions.py](../permissions.py) a doplň závislosti. Editor načíta katalóg z API, takže nové právo sa zobrazí v príslušnej skupine. Priraď kontrolu k serverovej trase cez `ENDPOINTS`. Ak jedna trasa vykonáva rôzne úkony, vyber konkrétne právo po validácii vstupu a skontroluj aj prístup ku konkrétnemu záznamu. Právo použi v rozhraní na zobrazenie príslušnej akcie. Server odmieta chránenú trasu bez nastavenej kontroly. Pri zmene existujúceho práva over dopad na uložené pridelenia v databáze.

## Vývoj a testovanie

Zostavenie frontendu z koreňového adresára repozitára:

```sh
npm ci --prefix frontend
npm run build --prefix frontend
```

Skript prekopíruje lokálne dáta pre výber emoji a vytvorí `frontend/dist`. [Dockerfile](../Dockerfile) používa Node.js 22 na zostavenie a Python 3.12 v aplikačnom obraze.

[Integračné testy](../tests/test_club_updates.py) vyžadujú samostatnú PostgreSQL databázu. Testy vyprázdňujú tabuľky a používajú simulovaný push transport. Priprav prázdnu databázu s používateľom, ktorý v nej môže vytvárať tabuľky, a spúšťaj testy z koreňa repozitára.

```sh
python -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt httpx
HUB_DATABASE_URL=postgresql://hub:password@localhost/hub_test \
  HUB_DIST=frontend/dist python -m unittest discover -s tests -v
```

Pri manuálnom overení použi samostatné účty s príslušnými rolami. Účasť, dochádzku, schvaľovanie tréningu a prevzatie vybavenia skontroluj z pohľadu každej zúčastnenej osoby.
