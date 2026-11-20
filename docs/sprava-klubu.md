# Správa klubu

[Prehľad dokumentácie](index.md) · [Oprávnenia a roly](opravnenia.md)

Jednotlivé úkony predpokladajú pridelené oprávnenie. Správca môže rozdeliť plánovanie, zápis dochádzky, komunikáciu, sklad a servis medzi rôzne osoby.

## Udalosti a návrhy tréningov

- **Vytvorenie udalosti.** V kalendári vybrať **Naplánovať** a zvoliť tréning, stretnutie alebo zápas. Vo formulári uviesť začiatok, voliteľný koniec, miesto a pokyny. Formulár podporuje týždenné opakovanie. Jednotlivé výskyty možno upraviť v ich detaile. Práva na vytvorenie sú samostatné pre každý typ.
- **Zmena udalosti.** Úprava začiatku, konca alebo miesta vytvorí novú verziu termínu. Pôvodné odpovede ostanú uložené a nová verzia zbiera vlastné potvrdenia. Úpravy názvu, typu alebo pokynov sa ukladajú do histórie bez novej požiadavky na potvrdenie. Menné odpovede a súhrn sa riadia samostatnými právami.
- **Zrušenie a vymazanie.** Zrušená udalosť zostane v kalendári s označením a vznikne automatický oznam aj kalendárové upozornenie. Vymazanie bez upozornenia odstráni daný výskyt aj jeho prepojené odpovede, dochádzku a automatické oznamy. Ostatné výskyty série ostanú. Už doručený systémový push sa spätne neodvoláva.
- **Návrh tréningu.** Autor uvedie možné termíny a hlasujúci odpovedajú pri každom z nich. Podľa práv vidí správca súhrn alebo menné hlasy. Oprávnená osoba hlasovanie uzavrie, návrh zamietne alebo schváli jeden budúci termín. Schválenie vytvorí oficiálny tréning a prepojí ho s návrhom. Hlasy sa neprepisujú na prihlášky ani na dochádzku.

## Zápis dochádzky

V detaile začatej nezrušenej udalosti možno označiť prítomnosť či neprítomnosť jednotlivcov alebo vybraných členov hromadne. Dochádzka bez záznamu má stav **Nezapísané**. Pri manuálnom zápise po skončení udalosti je potrebné právo **Opraviť uzavretú dochádzku**. Ak udalosť nemá zadaný koniec, za koniec sa považuje začiatok plus tri hodiny.

Pri zápise kamerou otvoriť **Skenovať dochádzku** a vybrať dátum a udalosť. Jediná prebiehajúca udalosť sa predvolí automaticky. Pri udalosti cez polnoc sa vyberá deň jej začiatku. Po naskenovaní členského QR kódu sa prítomnosť na vybranej udalosti zapíše automaticky. Opakované skenovanie nepridá ďalší záznam. Ak udalosť ešte nie je vybraná, zobrazí sa rozpoznaný člen a výber udalosti. S príslušným oprávnením možno založiť súkromný neplánovaný tréning priamo zo skenera.

**Dochádzka** zobrazuje tímový prehľad. Členovia sú v riadkoch a udalosti v stĺpcoch. Filtrovať možno podľa obdobia, typu a stavu zrušenia udalosti. Súhrn **Prítomný / zapísané** počíta len zaznamenanú dochádzku na začatých a nezrušených udalostiach v zobrazenom výbere. Pri neočakávanom zaradení člena je potrebné overiť [práva na vlastnú účasť](opravnenia.md#kto-sa-zobrazuje-v-dochádzke).

## Tímy, tréningový plán a rozvoj

| Oblasť | Úkony |
| --- | --- |
| Klubová zostava | Evidencia základného obsadenia tímov, pozícií a náhradníkov v časti **Tímy a zostavy**. |
| Zostava udalosti | Príprava zostavy pre konkrétnu udalosť, zverejnenie nominácie a prehľad menných odpovedí podľa oprávnení. |
| Plán tréningu | Zostavenie plánu z cvičení, doplnenie poznámky pre tím a internej poznámky. Zverejnenie plánu aj interná poznámka majú vlastné prístupové pravidlá. |
| Knižnica cvičení | Evidencia názvu, cieľa, dĺžky, náročnosti a vybavenia. Cvičenia možno použiť pri zostavení plánu. |
| Rozvoj hráčov | Úprava hodnotenia zručností a interných poznámok podľa oprávnení. Spätnú väzbu k tréningu môže pridať účastník so zapísanou prítomnosťou a právom na zápis. |

## Evidencia vybavenia

**Pridať zariadenie** umožňuje vybrať typ ručne alebo ho odvodiť zo štítku. Typ musí zodpovedať predpone [kódu vybavenia](pouzivatelska-prirucka.md#vybavenie-a-skener) s dvomi až šiestimi číslicami. Neznámy kód zo skenera môže založiť používateľ s právom na pridávanie. Časová os sumarizuje úkony podľa dňa a umožňuje otvorenie detailu.

| Oblasť | Záznamy |
| --- | --- |
| Batérie | Nabitie, použitie v drone, vybitie, hromadné nabitie, dlhodobé uskladnenie a výdaj, poškodenie, vyradenie a poznámky. Dostupnosť úkonu sa riadi aj stavom batérie. |
| Bežný servis | Kontrola, použitie, porucha, oprava, údržba, vyradenie a poznámka. |
| Drony | Okrem bežného servisu umožňujú evidovať výmenu vrtúľ a motorov. |
| Ovládače | Okrem bežného servisu umožňujú zaznamenať kontrolu batérie ovládača. |

**Dlhodobé pridelenie** priradí zariadenie k vybranému aktívnemu členovi. Zobrazí sa pri zariadení aj v evidencii člena, ak má používateľ príslušný prístup. Ukončenie pridelenia sa zapíše ako samostatná akcia.

**Zápožička** má vlastný priebeh. Oprávnená osoba založí zápožičku dronu, ovládača alebo nabíjačky pre konkrétneho člena a voliteľne zadá termín vrátenia. Prevzatie potvrdzuje vybraný člen. Oprávnený používateľ následne zaeviduje vrátenie, prípadne zruší zápožičku čakajúcu na prevzatie. Zariadenie môže mať najviac jednu otvorenú zápožičku a počas nej ho nemožno dlhodobo prideliť.

## Členovia a komunikácia

- **Účty.** V časti **Členovia** možno vytvoriť pozvánku alebo odkaz na obnovu hesla a doručiť ho príslušnému používateľovi. Odkazy sú jednorazové a platia najviac sedem dní. Pri odchode člena je možné účet deaktivovať. Zmena rolí a trvalé odstránenie účtov vyžadujú príslušné oprávnenia.
- **Členský QR.** V detaile člena možno zobraziť alebo obnoviť jeho QR kód. Obnova zneplatní pôvodný kód. Zápis dochádzky cez QR vyžaduje aktívny účet.
- **Skupiny.** Skupina **Celý tím** zahŕňa aktívne účty a prístup do skupiny **Tréneri** sa povoľuje samostatne. Pri vytváraní vlastnej skupiny možno vybrať účastníkov. Pridaný účastník získa prístup k histórii skupiny, pri odobratí sa prístup zruší.
- **Oznamy.** K rozpracovanému oznamu možno pripojiť súbory. Pri publikovaní možno vybrať publikum, napríklad celý tím, trénerov alebo konkrétnych používateľov. Najviac päť príloh vo formáte PDF, PNG alebo JPEG môže mať spolu do 5 MB. Pripnutie, odoslanie upozornenia a vymazanie sú samostatné akcie. Po úprave zverejneného oznamu sa potvrdenia o prečítaní zaznamenávajú znova.
- **Dokumenty.** Možno nahrať klubový súbor PDF do 5 MB. Príslušné oprávnenia umožňujú vyžiadať potvrdenie oboznámenia a zobraziť prehľad potvrdení.
