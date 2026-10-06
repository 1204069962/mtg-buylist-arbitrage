# Buylist-Arbitrage: TrierMTG vs. Cardmarket

Vergleicht die Ankaufsliste von TrierMTG (mtgkartenankauf.de) automatisch mit den aktuellen
Cardmarket-Preisen und listet alle Karten, bei denen der Ankaufspreis spürbar über dem
Cardmarket-Preis liegt.

## Was passiert bei einem Lauf

1. **TrierMTG-Ankaufsliste** laden (ca. 8.800 Karten, je Karte alle angekauften Sets mit Preis EN/DE).
2. **Cardmarket Price Guide** laden (öffentliche Datei von Cardmarket, alle ~128.000 Magic-Singles
   mit Trend-, Low- und Durchschnittspreisen; wird einmal pro Nacht aktualisiert).
3. **Scryfall-Kartendaten** laden (liefert für jeden Druck die Cardmarket-Produkt-ID, damit
   Kartenname + Set eindeutig einem Cardmarket-Produkt zugeordnet werden kann).
4. Für jede Karte/Set-Kombination: regulären Druck bestimmen, Cardmarket-Preis nachschlagen,
   Marge berechnen, nach Schwellenwerten filtern.
5. Ergebnis schreiben nach `output/`:
   - `report.html` – sortier- und filterbare Tabelle mit Links zu Cardmarket (vorgefiltert auf
     Englisch, Zustand mind. EX, nicht signiert/verändert), Scryfall und dem Bild bei TrierMTG.
     Zwei Margen: "gebündelt" (Versand auf mehrere Karten beim selben Verkäufer verteilt) und
     "einzeln" (voller Versand auf diese eine Karte)
   - `deals.csv` – dieselben Daten für Excel (Semikolon-getrennt)
   - `wants.txt` – Deckliste im Format `8 Kartenname` zum Import in eine Cardmarket-Wants-Liste
   - `nicht-zugeordnet.csv` – Karten, die keinem Cardmarket-Produkt zugeordnet werden konnten
   - `verlauf.csv` – ein Eintrag pro Lauf (Anzahl Deals, Gesamtpotenzial)

## Starten

Voraussetzung: Node.js 20 oder neuer (ist installiert).

```bash
node run.js
```

Optionen:

| Option       | Wirkung                                                   |
|--------------|-----------------------------------------------------------|
| `--open`     | Report nach dem Lauf im Browser öffnen                    |
| `--force`    | alle Downloads erzwingen (Cache in `data/` ignorieren)    |
| `--no-fetch` | nur mit den bereits vorhandenen Daten rechnen (schnell)   |

Oder einfach `start.cmd` doppelklicken (läuft und öffnet den Report).

## Einstellungen (`config.json`)

| Schlüssel                     | Bedeutung                                                                                      |
|-------------------------------|------------------------------------------------------------------------------------------------|
| `priceBasis`                  | Welcher Cardmarket-Preis als Einkaufspreis gilt: `trend` (Standard), `low`, `avg1`, `avg7`, `avg30` |
| `minBuyPrice`                 | Karten unter diesem Ankaufspreis ignorieren (Standard 0,50 €)                                  |
| `minMarginAbs`                | Mindestmarge je Karte in Euro nach Versandanteil (Standard 0,50 €)                             |
| `minMarginPct`                | Mindestmarge in Prozent des Einkaufspreises (Standard 15 %)                                    |
| `maxQtyPerCard`               | Maximale Stückzahl je Karte (TrierMTG nimmt bis zu 8)                                          |
| `cardmarketShippingPerSeller` | Angenommene Versandkosten je Cardmarket-Verkäufer (Standard 2,00 €)                            |
| `assumedCardsPerSeller`       | Wie viele Karten man im Schnitt pro Verkäufer bündelt (Standard 4; Versand wird darauf verteilt) |
| `shippingToVendor`            | Versand zum Ankäufer je Sendung (Standard 0, TrierMTG übernimmt ihn ab 50 € Verkaufswert)      |
| `assumedCardsPerVendorBatch`  | Karten je Sendung an den Ankäufer (Versand wird darauf verteilt)                               |
| `cardmarketLanguageId`        | Sprachfilter in den Cardmarket-Links: 1 = Englisch, 3 = Deutsch                                |
| `cardmarketMinCondition`      | Zustandsfilter in den Cardmarket-Links: 2 = Near Mint, 3 = Excellent (TrierMTG-Minimum)        |
| `cacheHours`                  | Wie lange heruntergeladene Daten wiederverwendet werden                                        |
| `vendors`                     | Liste der Ankäufer-Adapter in `src/vendors/` (derzeit nur `triermtg`)                          |

Der Einkaufspreis wird konservativ gerechnet: Liegt das aktuell günstigste Cardmarket-Angebot
(`low`) über dem Trend, wird `low` genommen. Bei Foil-only-Drucken werden die Foil-Preise verwendet.

## Was das Tool NICHT kann (und warum)

- **Einzelne Verkäufer-Angebote auf Cardmarket** (wer hat welche Karte zu welchem Preis, in welchem
  Zustand): Dafür gibt es keine öffentliche Schnittstelle mehr. Cardmarket vergibt seit Jahren keinen
  API-Zugang, und die Produktseiten sind gegen automatisches Auslesen geschützt (Cloudflare, AGB-Verbot).
  Deshalb arbeitet das Tool mit den aggregierten Preisen aus dem Price Guide. Das Zusammenstellen der
  Bestellung pro Verkäufer bleibt ein manueller Schritt, den Cardmarket selbst aber gut unterstützt:
  1. `output/wants.txt` in eine Cardmarket-Wants-Liste importieren (Wants → Liste → Importieren).
  2. In der Wants-Liste Sprache = Englisch und Zustand = mind. EX einstellen.
  3. Cardmarket-"Einkaufsassistent" (Shopping Wizard) nutzen: der sucht die günstigste Kombination aus
     Verkäufern inkl. Versand.
- **Versionen eindeutig erkennen:** TrierMTG kauft nur "reguläre" Versionen (keine Promos, Showcase etc.).
  Das Tool wählt pro Set den regulären Druck; wo das nicht eindeutig ist, steht im Report ein
  Warnzeichen. Dann das Bild bei TrierMTG mit dem Cardmarket-Produkt vergleichen.
- **Garantie:** Preise ändern sich stündlich. Der Price Guide ist einmal täglich aktuell, die
  TrierMTG-Liste ändert sich ebenfalls laufend. Vor dem Kauf kurz gegenprüfen.

## Automatisch laufen lassen

`setup-schedule.ps1` legt eine Windows-Aufgabe an, die das Tool täglich um 08:00 Uhr startet
(und beim Anmelden, falls der Rechner um 08:00 aus war). Einmalig in PowerShell ausführen:

```powershell
powershell -ExecutionPolicy Bypass -File setup-schedule.ps1
```

Entfernen:

```powershell
schtasks /Delete /TN "Cardmarket Buylist-Arbitrage" /F
```

Der Report liegt danach immer aktuell unter `output/report.html`. Das Protokoll des letzten Laufs
steht in `output/letzter-lauf.log`.

## Für andere nutzbar machen (z.B. ohne Claude)

Das Tool braucht nur Node.js, keine Claude-Installation. Drei Wege, von einfach bis komfortabel:

1. **Ordner weitergeben.** Den Ordner `Cardmarket` (ohne `data/` und `output/`) zippen und verschicken.
   Der Empfänger installiert Node.js von nodejs.org (LTS, einmalig), entpackt den Ordner und doppelklickt
   `start.cmd`. Nach etwa einer Minute öffnet sich der Report im Browser. Schwellen stehen in `config.json`.
2. **Nur den Report teilen.** `output/report.html` ist eine einzelne Datei ohne Abhängigkeiten und kann
   per Messenger oder Mail verschickt werden. Sie ist aber nur so aktuell wie der letzte Lauf.
3. **Als Webseite, die sich täglich selbst aktualisiert (empfohlen).** Der Workflow in
   `.github/workflows/daily.yml` lässt GitHub den Vergleich alle 6 Stunden kostenlos ausführen und
   veröffentlicht den Report unter einer festen Adresse (GitHub Pages). Jeder mit dem Link sieht
   immer den aktuellen Stand, ohne etwas zu installieren. Einrichtung:
   - Repository auf GitHub anlegen und diesen Ordner hochladen (git push).
   - Im Repository: Settings -> Pages -> Source auf "GitHub Actions" stellen.
   - Unter Actions den Workflow einmal manuell starten ("Run workflow"). Die Adresse lautet danach
     `https://<benutzername>.github.io/<repository>/`.
   - Hinweis: Bei einem öffentlichen Repository ist auch der Report öffentlich. Ein privates Repository
     mit Pages braucht einen GitHub-Pro-Account.

## Weitere Ankäufer anbinden

Ein Adapter ist eine Datei in `src/vendors/` mit `fetchBuylist(cfg)`, die ein Objekt
`{ vendor: {id, name, url, maxQty}, rows: [{ name, priceEN, priceDE, sets: [{ code, image }] }] }`
zurückgibt. `code` ist der Scryfall-Set-Code. Danach den Adapter in `config.json` unter `vendors` eintragen.
