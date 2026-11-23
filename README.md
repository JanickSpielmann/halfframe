# halfframe.spielmann.it

Eine Seite, auf der man einen Ordner mit Scans von Half Frame Filmen wählt und jedes Bild in zwei Bilder teilt. Alles läuft im Browser der besuchenden Person. Der Server liefert nur die Dateien aus und sieht keine Bilder.

## Aufbau

| Pfad | Zweck |
|---|---|
| `site/index.html` | Aufbau der Seite |
| `site/app.js` | Ordner lesen, Schnittlinie, automatische Suche des Streifens, Export (Ordner oder ZIP) |
| `site/style.css` | Aussehen |
| `site/favicon.svg` | Symbol |
| `nginx/default.conf` | Konfiguration des Webservers (kein Cache für Seiten, `noindex`) |
| `docker-compose.yml` | nginx Container `halfframe`, hängt am Netzwerk `proxy` (Caddy) |
| `setup-winkel.sh` | Richtet alles auf HP-Winkel ein, kann beliebig oft laufen |

## Verhalten der Seite

* Ein Scan mit zwei Bildern nebeneinander wird senkrecht geteilt (A links, B rechts). Hochkant gescannte Streifen werden waagrecht geteilt. Die Richtung ist umschaltbar.
* Die Schnittlinie lässt sich pro Bild ziehen. Dazu kommen Mittelstreifen, Aussenrand, Drehung und Tauschen von A und B.
* «Streifen automatisch suchen» sucht in der Bildmitte die Spalte, die sich am stärksten abhebt. Das ist ein Hilfsmittel und kann danebenliegen.
* Ausgabe: `<name>_a.jpg` und `<name>_b.jpg` (oder PNG). Unterordner bleiben erhalten.
* Chrome, Edge, Brave: Die Ergebnisse werden in den Unterordner `geschnitten` des gewählten Ordners geschrieben (der Browser fragt einmal nach der Schreiberlaubnis). Andere Browser: ZIP Dateien, je rund 400 MB.
* Formate: JPG, PNG, WebP. TIFF können Browser nicht lesen, solche Dateien werden übersprungen.
* Metadaten (EXIF) werden nicht in die neuen Bilder übernommen. JPG wird neu kodiert, also einmal verlustbehaftet gespeichert (Qualität einstellbar, PNG ist verlustfrei).

## Update einspielen

1. Ändern, auf `main` committen, `git push`.
2. Live schalten: `git publish` (Alias auf dem Laptop) oder `git push origin HEAD:release`.
3. Nach höchstens einer Minute holt HP-Winkel den Stand (Pull Job `winkel-deploy.timer`). Kontrolle: `~/docker/winkel-deploy/deploy.log` auf HP-Winkel.

Vorher mit `git log origin/release..main` ansehen, was alles live ginge.

Ändert sich nur `site/`, startet kein Container neu. Ändern sich `nginx/` oder `docker-compose.yml`, baut der Pull Job den Container neu.

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
