'use strict';

/* Änderungsprotokoll: bei jeder Änderung oben einen Eintrag ergänzen (neueste zuerst).
   Der erste Eintrag bestimmt die Version unten auf der Seite.
   Zählung: Die erste Zahl steigt bei einer neuen Gestaltung, sonst zählt die letzte Zahl hoch. */
const CHANGELOG = [
  { version: '2.2.0', date: '23.11.2026', text: 'Neue Ansicht «Einzelbilder»: Oben über dem Kontaktbogen lässt sich umschalten. Statt des Scans mit Linie zeigt jede Karte dann die beiden fertigen Bilder nebeneinander, so wie sie ins ZIP kommen, mit Drehung und Reihenfolge. Ein Klick öffnet die Lupe. Die gewählte Ansicht bleibt gespeichert.' },
  { version: '2.1.0', date: '23.11.2026', text: 'Bessere Erkennung des Stegs: Die Seite sucht Spalten, in denen mindestens 95 % der Pixel schwarz sind (bei Negativen hell), erweitert diesen Bereich bis an die Bildkanten und schneidet genau ihn weg. Jeder Scan bekommt so seine eigene Stegbreite, auch schräg gescannte Streifen werden ganz entfernt. Grenzt ein dunkles Motiv an den Steg, nimmt die Seite die typische Breite der anderen Scans und markiert den Scan zum Prüfen. Die Lupe zeigt, wie breit der Steg ist und wie er gefunden wurde.' },
  { version: '2.0.1', date: '23.11.2026', text: 'Unten auf der Seite stehen jetzt Version und Datum. Ein Klick darauf öffnet dieses Änderungsprotokoll.' },
  { version: '2.0.0', date: '23.11.2026', text: 'Neue Gestaltung: Die Scans liegen als Filmstücke auf einem Kontaktbogen, die Linie wird beim Laden gesucht und unsichere Scans sind gelb markiert. Neu gibt es eine Lupe mit Tastatursteuerung. Gespeichert wird immer als eine ZIP Datei, grosse Mengen in Teilen. Dunkel oder hell je nach Gerät.' },
  { version: '1.0.0', date: '23.11.2026', text: 'Erste Version: Ordner wählen, Schnittlinie pro Bild einstellen, speichern in einen Unterordner oder als ZIP.' },
];
