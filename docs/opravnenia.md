# Oprávnenia a roly

[Prehľad dokumentácie](index.md) · [Správa klubu](sprava-klubu.md)

## Prístup podľa jednotlivých akcií

**Superadmin** je systémový účet s plným prístupom. Bežný účet môže mať viac klubových rolí. Dostane zjednotenie platných práv zo všetkých svojich rolí. Odobratie práva z jednej roly ho preto neodoberie účtu, ktorý ho má z inej.

Editor je pod **Členovia → Roly a prístupy**. Práva sú zoradené podľa stránky, bloku a akcie. Otvorenie stránky sprístupní jej vstup. Na čítanie podrobností alebo vykonanie konkrétneho úkonu vyber príslušné akcie. Niektoré práva vyžadujú ďalší prístup, napríklad čítanie vybavenia pred zapisovaním servisu. Zásahy do konkrétneho záznamu sa riadia aj jeho stavom, vlastníctvom, adresátom alebo členstvom v skupine.

1. Otvor vybranú rolu a rozbaľ stránku a blok.
2. Zaškrtni potrebné akcie a skontroluj ich závislosti. Pri skupinovom výbere skontroluj aj jednotlivé akcie, ktoré obsahuje.
3. Ulož rolu. Ak ju medzitým upravil iný správca, načítaj jej aktuálne nastavenie.
4. V prehľade efektívnych práv skontroluj konkrétneho člena. História oprávnení ukazuje pridané a odobraté práva.

## Čo sa dá rozdeliť

| Oblasť | Samostatné rozhodnutia pri prideľovaní |
| --- | --- |
| Kalendár a účasť | Čítanie kalendára a miest, vytváranie podľa typu udalosti, úprava vlastných alebo všetkých udalostí, história, zrušenie a vymazanie. Vlastná odpoveď, potvrdenie zmeny, súhrny a menné odpovede majú vlastné práva. |
| Návrhy tréningov | Čítanie, vytvorenie, úprava alebo stiahnutie vlastného návrhu, hlasovanie, súhrn, menné hlasy, uzavretie, zamietnutie a schválenie termínu. |
| Dochádzka a skener | Vlastná, tímová a členská dochádzka, jednotlivý a hromadný zápis, zápis QR a oprava po skončení. Skener samostatne rieši identifikáciu člena, výber udalosti, vyhľadanie vybavenia a založenie neplánovaného tréningu. |
| Tréning a rozvoj | Čítanie, úprava a zverejnenie plánu, poznámka pre tím a interná poznámka, vlastná alebo tímová spätná väzba, hodnotenia hráčov a knižnica cvičení. |
| Tímy a zostavy | Čítanie a úprava klubovej aj udalostnej zostavy, zverejnenie nominácie, odpoveď za seba a čítanie odpovedí. |
| Správy | Čítanie, súkromná alebo skupinová správa, reakcie a ich menný prehľad, vytváranie a úprava skupín, prístup do skupiny trénerov a jednotlivé úkony v anketách. |
| Oznamy | Čítanie podľa publika alebo naprieč publikami, tvorba, úprava, publikovanie, výber publika, pripnutie, push, vymazanie a práca s prílohami. |
| Členovia a profil | Zoznam a kontakty, pozvánky a voľba rolí na pozvánke, aktivácia, obnova prístupu, správa rozšírených účtov a odstránenie, žiadosti o roly, vlastný alebo cudzí QR a obnova kódu. |
| Vybavenie | Čítanie evidencie a histórie, pridávanie a premenovanie, každý stavový úkon batérie a typ servisného úkonu, správa pridelení a zápožičiek. |
| Dokumenty | Zoznam, stiahnutie, nahratie a vymazanie, vyžiadanie potvrdenia, potvrdenie za seba a prehľad potvrdení. |

Úplný aktuálny zoznam s identifikátormi a závislosťami vychádza z [katalógu v kóde](../permissions.py) a zobrazuje sa v administrátorskom editore.

### Príklady rozdelenia práv

- Hráč môže navrhnúť tréning, hlasovať a potvrdiť vlastnú účasť. Právo vytvoriť oficiálny tréning, upravovať cudzie udalosti a schvaľovať návrhy dostane iba rola, ktorá má tréningy plánovať.
- Vedúci môže založiť zápožičku dronu. Príjemca s právom **Potvrdiť vlastné prevzatie** môže potvrdiť iba zápožičku založenú pre jeho účet. Zápis vrátenia priraď osobe, ktorá vybavenie preberá, servisné úkony technikovi.
- Tréner, ktorý eviduje dochádzku hráčov, potrebuje práva na jej prehľad a zápis. Ak sa má aj sám evidovať ako účastník, pridaj mu právo na vlastnú odpoveď.

### Kto sa zobrazuje v dochádzke

Pri zaradení medzi účastníkov a v tímovom prehľade sa kontrolujú práva **Kalendár → Účasť → Odpovedať za seba** a **Potvrdiť zmenu za seba**. Stačí jedno z nich v ktorejkoľvek priradenej role. Ak sa vedúci alebo tréner zobrazuje medzi účastníkmi a nemá tam byť, skontroluj obe práva vo všetkých jeho rolách. V detaile konkrétnej udalosti môže osoba zostať zobrazená, ak už má uloženú odpoveď alebo záznam dochádzky.

## Vyskúšať ako rola

Superadmin môže v **Roly a prístupy** dočasne otvoriť portál ako vybraná rola alebo kombinácia rolí. Náhľad platí pre aktuálnu prihlasovaciu reláciu. Dá sa v ňom overiť viditeľnosť stránok a údajov. Zápisové operácie sú v náhľade blokované. Na ukončenie náhľadu použi trvalo dostupné **Späť na Superadmina** v hornej lište.

Po nasadení nového oprávnenia skontroluj jeho pridelenie. Existujúce nastavenia sa pri štarte zachovajú. Nové akcie bez samostatnej migrácie musí superadmin povoliť vybraným rolám v editore.
