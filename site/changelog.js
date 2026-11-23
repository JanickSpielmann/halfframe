'use strict';

/* Änderungsprotokoll: bei jeder Änderung oben einen Eintrag ergänzen (neueste zuerst).
   Der erste Eintrag bestimmt die Version unten auf der Seite.
   Zählung: Die erste Zahl steigt bei einer neuen Gestaltung, sonst zählt die letzte Zahl hoch. */
const CHANGELOG = [
  { version: '2.4.1', date: '23.11.2026', text: 'Ein Klick auf «ZIP herunterladen» öffnet ein Fenster mit den Einstellungen zum Speichern: Format, Qualität und Dateinamen. Erst dort startet der Download.' },
  { version: '2.4.0', date: '23.11.2026', text: 'Beim Speichern lassen sich die Bilder umbenennen: Name, Datum und ein Wort vor der Nummer, zum Beispiel «Film 1 2026-11-23 Foto 001». Die Nummer läuft durch alle Scans.' },
  { version: '2.3.3', date: '23.11.2026', text: 'Die Leertaste zentriert die Linie jetzt immer, auch wenn du zuletzt auf einen Dreh Knopf geklickt hast.' },
  { version: '2.3.2', date: '23.11.2026', text: 'Die Zahlen 1 und 2 sind jetzt Abzeichen und überall gleich gross, ebenso die Dreh Knöpfe. Die Grösse hängt nicht mehr vom Scan ab.' },
  { version: '2.3.1', date: '23.11.2026', text: 'Die Dreh Knöpfe sitzen jetzt direkt auf den Bildern, oben rechts. Ist ein Bild gedreht, zeigt der Knopf die Gradzahl. Die Lupe passt besser auf kleinere Bildschirme, die Vorschauen unten sind wieder ganz sichtbar.' },
  { version: '2.3.0', date: '23.11.2026', text: 'Jedes Einzelbild lässt sich drehen, je 90° nach rechts: in der Ansicht «Einzelbilder» mit den Knöpfen unter dem Scan, in der Lupe mit «Drehen» unter dem Bild oder den Tasten 1 und 2. Die Drehung in den Einstellungen gilt weiterhin für alle Bilder und kommt dazu.' },
  { version: '2.2.2', date: '23.11.2026', text: 'Die Option «Weglassen» ist entfernt. Es kommen immer alle lesbaren Scans ins ZIP.' },
  { version: '2.2.1', date: '23.11.2026', text: 'Die Leertaste setzt die Linie in die Mitte, in der Lupe und auf einer ausgewählten Karte.' },
  { version: '2.2.0', date: '23.11.2026', text: 'Neue Ansicht «Einzelbilder»: Oben über dem Kontaktbogen lässt sich umschalten. Statt des Scans mit Linie zeigt jede Karte dann die beiden fertigen Bilder nebeneinander, so wie sie ins ZIP kommen, mit Drehung und Reihenfolge. Ein Klick öffnet die Lupe. Die gewählte Ansicht bleibt gespeichert.' },
  { version: '2.1.0', date: '23.11.2026', text: 'Bessere Erkennung des Stegs: Die Seite sucht Spalten, in denen mindestens 95 % der Pixel schwarz sind (bei Negativen hell), erweitert diesen Bereich bis an die Bildkanten und schneidet genau ihn weg. Jeder Scan bekommt so seine eigene Stegbreite, auch schräg gescannte Streifen werden ganz entfernt. Grenzt ein dunkles Motiv an den Steg, nimmt die Seite die typische Breite der anderen Scans und markiert den Scan zum Prüfen. Die Lupe zeigt, wie breit der Steg ist und wie er gefunden wurde.' },
  { version: '2.0.1', date: '23.11.2026', text: 'Unten auf der Seite stehen jetzt Version und Datum. Ein Klick darauf öffnet dieses Änderungsprotokoll.' },
  { version: '2.0.0', date: '23.11.2026', text: 'Neue Gestaltung: Die Scans liegen als Filmstücke auf einem Kontaktbogen, die Linie wird beim Laden gesucht und unsichere Scans sind gelb markiert. Neu gibt es eine Lupe mit Tastatursteuerung. Gespeichert wird immer als eine ZIP Datei, grosse Mengen in Teilen. Dunkel oder hell je nach Gerät.' },
  { version: '1.0.0', date: '23.11.2026', text: 'Erste Version: Ordner wählen, Schnittlinie pro Bild einstellen, speichern in einen Unterordner oder als ZIP.' },
];
