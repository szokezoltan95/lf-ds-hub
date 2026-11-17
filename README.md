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

Aplikácia sa inštaluje pod názvom **DroneSoccer LF**. Karta s inštaláciou je
nad privítaním na domovskej stránke. Po prihlásení sa zobrazí aj popup.
Krížik skryje kartu dočasne. Voľba **Už nezobrazovať** vypne kartu aj popup.
Samostatne možno vypnúť iba popup po prihlásení.

Voľby sa ukladajú k používateľskému účtu v databáze. Po vypnutí oboch ponúk
zostane inštalácia dostupná v **Profil a nastavenia**. Na rovnakom mieste
možno kartu a popup nezávisle znovu zapnúť.

Keď prehliadač sprístupní inštalačný dialóg, kliknutie otvorí tento dialóg
na potvrdenie. Pri nedostupnom dialógu aplikácia zobrazí návod.

Aplikácia rozlišuje iOS/iPadOS, Android a desktopové systémy. Pri nedostupnom
dialógu zobrazí návod podľa zariadenia. Na iPhone sa používa Zdieľať a Pridať
na plochu. V samostatnom okne nainštalovanej aplikácie je ponuka skrytá.

## Oznamy a upozornenia

Tréneri a superadmin môžu oznamy vytvárať, upravovať, pripínať a natrvalo mazať.
Adresáti sú celý tím, iba tréneri alebo konkrétni aktívni členovia a tréneri.
Člen vidí len jemu určené oznamy; tréneri a superadmin majú prístup na ich správu.
Prílohy PDF, PNG a JPEG sa ukladajú do databázy, najviac 5 súborov a spolu 5 MB
na oznam. Každé stiahnutie kontroluje oprávnenie, verejné odkazy na súbory nie sú dostupné.
Pri úprave sa vynulujú potvrdenia prečítania. Nový oznam má možnosť push zapnutú,
pri úprave je predvolene vypnutá. Vymazanie oznamu neposiela upozornenie.

V **Profil a nastavenia → Upozornenia** sú tri nezávislé prepínače pre správy,
kalendár a manuálne oznamy. Výber platí pre účet na všetkých zariadeniach a
nemení dostupnosť obsahu ani zvonček v aplikácii. Každé zariadenie treba osobitne
prihlásiť tlačidlom **Zapnúť push na tomto zariadení** a potvrdiť systémový dialóg.
Po odhlásení sa odber na danom zariadení zruší; po ďalšom prihlásení ho možno znova
zapnúť. Na iPhone/iPade je potrebná aplikácia na ploche a iOS/iPadOS 16.4 alebo novší.
Tri kategórie sa nastavujú v hube; samostatné natívne Android kanály Web Push API nevytvára.

Push dostávajú prihlásené zariadenia adresátov podľa ich výberu. Správy informujú
ostatných účastníkov konverzácie. Kalendár informuje o vytvorení, zmene a zrušení
udalosti. Systémový superadmin klubový push neprijíma. Kliknutie otvorí príslušný
obsah. Zobrazenie znovu kontroluje platnú reláciu, aktuálne oprávnenia a výber
upozornení. Pri vypršanej relácii treba používateľa znova prihlásiť.

VAPID kľúče sa vytvoria automaticky a zostávajú v databáze aj pri novom builde.
Nie sú potrebné nové premenné v `.env`, vlastný Firebase projekt ani nový kontajner.
Server potrebuje odchádzajúce HTTPS pripojenie na push služby prehliadačov
(Google, Mozilla, Apple alebo Microsoft). Doručovanie používa databázovú frontu,
pri dočasnej chybe opakuje pokus najviac trikrát a odstraňuje zaniknuté odbery.
Fronta má platnosť 24 hodín. Rozpracované prílohy sa automaticky čistia po 24 hodinách.
Doručenie závisí aj od prehliadača, pripojenia a nastavení zariadenia.

## Vymazanie udalosti

**Zrušiť udalosť** ju ponechá v kalendári a vytvorí oznam aj kalendárový push.
**Vymazať bez upozornenia** natrvalo odstráni jednu udalosť, jej prihlášky, dochádzku,
prepojené automatické oznamy aj čakajúce push. Iné výskyty týždennej série ostávajú.
Vymazať môže autor alebo superadmin, aj keď je udalosť už zrušená. Staršie udalosti
nemajú uloženého autora, preto ich môže vymazať ktorýkoľvek tréner. Migrácia
pripojí pôvodné automatické oznamy iba pri jednoznačnej zhode názvu, termínu a miesta.
Nejednoznačné staré oznamy možno odstrániť samostatne v sekcii Oznamy.
Upozornenie, ktoré už bolo doručené na telefón, sa nedá spoľahlivo spätne odvolať.

## Overenie zmien

Integračné testy používajú samostatnú prázdnu PostgreSQL databázu a simulovaný
transport push, vrátane skutočného šifrovania a podpisovania. Nikdy nepoužívaj
produkčnú databázu: testy vyprázdňujú svoje tabuľky.

```sh
python -m pip install -r requirements.txt httpx
HUB_DATABASE_URL=postgresql://hub:password@localhost/hub_test HUB_DIST=frontend/dist python -m unittest discover -s tests -v
```

## Tímový prehľad dochádzky

Tréneri a superadmin majú v menu **Dochádzka**. Riadky obsahujú všetkých členov
(vrátane neaktívnych), stĺpce udalosti z kalendára v časovom poradí. Tréneri
ani systémový účet sa do členských riadkov nezaraďujú. Predvolený interval je
od začiatku aktuálneho mesiaca do dneška. Filtre **Od/Do** zahŕňajú celé dni
podľa času na Slovensku, typy možno kombinovať. **Celé obdobie** odstráni
časové obmedzenie a vyberie všetky typy. Zrušené udalosti sú predvolene skryté.

Bunky rozlišujú prítomnosť, neprítomnosť, nezapísanú dochádzku, plánované a
zrušené udalosti. RSVP nie je dôkazom prítomnosti. Súhrn **Prítomný / zapísané**
počíta iba skutočné záznamy na začatých, nezrušených udalostiach vo vybraných
stĺpcoch. Vyhľadávanie filtruje mená členov. Na mobile je tabuľka posúvateľná,
mená aj hlavičky zostávajú prichytené. Údaje sa obnovujú každých 15 sekúnd pri
zobrazenej stránke. Prehľad dochádzku nemení; zápis je v detaile udalosti v kalendári.

## Skenovanie a členský QR

Ikonka skenera je priamo v hornej lište na mobile aj desktope. Dostupná je aj
položka **Skenovať** v menu a skratky vo vybavení, prehľade dochádzky a detaile
začatej udalosti. Kamera číta QR aj bežné textové čiarové kódy (napríklad Code 128
alebo Code 39). Pri zamietnutej kamere možno vložiť kód ručne alebo USB skenerom.
Pre kameru je potrebné HTTPS a povolenie prehliadača. Zábery sa dekódujú priamo
na zariadení, neposielajú sa na server. Kamera sa zastaví po načítaní kódu,
pri odchode zo skenera aj po skrytí stránky. Viaceré kamery možno prepínať.

Kód začínajúci na **LF-B** sa vyhodnocuje ako batéria. Platný formát zostáva
`LF-B` a 2–6 číslic. Podporované sú aj pôvodné QR štítky s odkazom
`/dronesoccer/#battery=LF-B01`. Existujúca batéria otvorí formulár na zápis
úkonu. Tréner môže neznámu batériu pridať a hneď zapísať úkon. Člen môže
zapisovať iba použitie existujúcej batérie; ostatné úkony sú určené trénerom.
Poškodené a vyradené batérie nie je možné použiť. Záznam treba potvrdiť, samotné
zachytenie kódu ho nevytvára. Opakovanie rovnakého požiadavku po výpadku spojenia
nevytvorí druhý záznam.

Člen otvorí **Môj členský QR kód** ikonou v hornej lište alebo vo svojom profile.
Je to digitálny bodkovaný QR s oblými orientačnými značkami, tmavomodrý na bielom
pozadí s voľným okrajom a vysokou úrovňou korekcie chýb. Obsahuje náhodný
identifikátor `LF-M:…`, bez mena či e-mailu, a neslúži na prihlásenie. Pri kopírovaní
možno kód vložiť do ručného vstupu skenera. Tréner ho môže zobraziť a obnoviť
v detaile člena; obnova okamžite zneplatní starý QR. Neaktívne členské QR neplatia.
Na zobrazenie QR aj zápis je potrebné internetové pripojenie.

Tréner v skeneri vyberie deň a udalosť. Jedna prebiehajúca udalosť sa predvolí
sama, súbeh udalostí vyžaduje ručný výber. Za prebiehajúcu sa považuje udalosť
medzi začiatkom a koncom, pri nezadanom konci najviac tri hodiny od začiatku.
Udalosti sa vyhľadávajú podľa dňa začiatku; pri udalosti cez polnoc vyber predchádzajúci
deň. Ručne možno vybrať aj inú začatú, nezrušenú udalosť daného dňa. Sken členského
QR uloží prítomnosť automaticky, ak je udalosť vybraná. Bez výberu sa iba zobrazí
meno a zápis čaká na výber a potvrdenie. Opakovaný sken nemení počet záznamov,
nezmaže RSVP ani poznámku. Predchádzajúca neprítomnosť sa opraví na prítomnosť.
Skenovanie dochádzky neodosiela push. Členom server nedovolí čítať cudzie
členské QR ani zapisovať dochádzku.
