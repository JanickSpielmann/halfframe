# halfframe.spielmann.it

Eine Seite, auf der man einen Ordner mit Scans von Half Frame Filmen wählt und jedes Bild in zwei Bilder teilt. Alles läuft im Browser der besuchenden Person. Der Server liefert nur die Dateien aus und sieht keine Bilder.

## Aufbau

| Pfad | Zweck |
|---|---|
| `site/index.html` | Aufbau der Seite: Start mit Ablagefläche, Kontaktbogen, Lupe |
| `site/app.js` | Scans lesen, Trennlinie suchen und setzen, ZIP erzeugen |
| `site/style.css` | Aussehen (dunkel: Dunkelkammer, hell: Leuchttisch, folgt der Einstellung des Geräts) |
| `site/changelog.js` | Änderungsprotokoll, bestimmt die Version unten auf der Seite |
| `site/favicon.svg` | Symbol |
| `nginx/default.conf` | Konfiguration des Webservers (kein Cache für Seiten, `noindex`) |
| `docker-compose.yml` | nginx Container `halfframe`, hängt am Netzwerk `proxy` (Caddy) |
| `setup-winkel.sh` | Richtet alles auf HP-Winkel ein, kann beliebig oft laufen |

## Verhalten der Seite

* Ordner wählen, Ordner hineinziehen oder einzelne Scans wählen. Unterordner werden mitgelesen.
* Jeder Scan erscheint als Filmstück auf einem Kontaktbogen. Der Steg wird beim Laden gesucht: zuerst Spalten mit mindestens 95 % fast schwarzen Pixeln (bei Negativen hellen), erweitert bis die Hälfte der Pixel nicht mehr passt. Weggeschnitten wird genau dieser Bereich plus 0.15 % je Seite. Nur in der Bildmitte (30 bis 70 %) und bei plausibler Breite (0.6 bis 8 %). Grenzt ein dunkles Motiv an, gilt die Kante näher zur Mitte und die typische Breite der Rolle. Ohne Steg sucht die Seite die Stelle mit dem stärksten Helligkeitsunterschied, die Breite kommt dann aus den Einstellungen. Die Parameter stehen oben im Abschnitt «Steg suchen» in `site/app.js`. Unsichere Scans sind gelb markiert («Bitte prüfen»), ein Klick auf «x prüfen» zeigt nur diese.
* Linie setzen: im Bild klicken oder ziehen, Pfeiltasten verschieben fein (Shift grösser), die Leertaste setzt die Linie in die Mitte. Die Lupe zeigt den Scan gross mit beiden Ergebnissen, Enter bestätigt und geht zum nächsten Scan.
* Einstellungen für alle Scans: Steg in der Mitte, Rand aussen, Drehen, Format (JPG oder PNG), Reihenfolge tauschen. Sie bleiben im Browser gespeichert.
* Ausgabe immer als **eine ZIP Datei** im Download Ordner, Name `<Ordner> einzeln.zip`. Darin `<name>_1.jpg` und `<name>_2.jpg`, Unterordner bleiben erhalten. Über rund 450 MB wird auf mehrere ZIP verteilt (`Teil 1`, `Teil 2`).
* Was der Browser lesen kann, geht: JPG, PNG, WebP. TIFF und HEIC nur, wenn der Browser sie öffnet (Safari ja, Chrome nein), sonst wird der Scan als «Nicht lesbar» markiert.
* Metadaten (EXIF) werden nicht übernommen. JPG wird neu kodiert (Qualität einstellbar), PNG ist verlustfrei.

## Versionsnummer

Unten rechts steht die Version als Link. Ein Klick öffnet das Änderungsprotokoll (auch direkt über `/#aenderungen`). Bei jeder Änderung an der Seite in `site/changelog.js` oben einen Eintrag mit Version, Datum und einem Satz ergänzen (neueste zuerst). Der erste Eintrag bestimmt die angezeigte Version, sonst muss nichts angepasst werden.

Zählung: Die erste Zahl steigt bei einer neuen Gestaltung (heute 2.x.x), sonst zählt die letzte Zahl hoch (2.0.1, 2.0.2, ...).

## Update einspielen

In diesem Repository wird direkt auf `release` gearbeitet, `main` wird gleich mitgeführt. Jeder Push auf `release` ist nach höchstens einer Minute live (Pull Job `winkel-deploy.timer` auf HP-Winkel, Kontrolle in `~/docker/winkel-deploy/deploy.log`).

Einmalig im Klon (nur für dieses Repository, nicht global, weil `git publish` anderswo `main` auf `release` schiebt):

    git config alias.publish '!git push origin HEAD:release && git push origin HEAD:main'

Alltag:

    git pull
    git add -A
    git commit -m "Was geändert wurde"
    git publish

Vorher in `site/changelog.js` einen Eintrag ergänzen. Ändert sich nur `site/`, startet kein Container neu. Ändern sich `nginx/` oder `docker-compose.yml`, baut der Pull Job den Container neu.

## Einrichtung auf HP-Winkel (einmalig)

1. **DNS bei Metanet:** A Record `halfframe` auf die öffentliche IP (46.126.153.195). Zuerst, sonst scheitert das Zertifikat.
2. Auf HP-Winkel:

        git clone -b release https://github.com/JanickSpielmann/halfframe.git ~/docker/halfframe
        cd ~/docker/halfframe && ./setup-winkel.sh

   Das Skript startet den Container, ergänzt den Block in `~/docker/caddy/Caddyfile` (mit Sicherung, bei einem Fehler wird sie zurückgespielt), lädt Caddy neu und testet die Seite.
3. **Pull Job:** In `~/docker/winkel-deploy/winkel-deploy.sh` am Ende ergänzen:

        deploy halfframe '^(nginx/|docker-compose\.yml)' '--force-recreate'

4. Test von aussen mit mobilen Daten.

Das Repository ist öffentlich, der Klon braucht deshalb keinen Deploy Key.
