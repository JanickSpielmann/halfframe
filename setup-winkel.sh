#!/bin/bash
# Richtet halfframe.spielmann.it auf HP-Winkel ein bzw. aktualisiert die Seite.
# Kann beliebig oft ausgeführt werden: Was schon da ist, wird übersprungen.
#
# Erstmalig:
#   git clone -b release https://github.com/JanickSpielmann/halfframe.git ~/docker/halfframe
#   cd ~/docker/halfframe && ./setup-winkel.sh
#
# Einstellungen lassen sich per Umgebungsvariable überschreiben, z.B.
#   CADDYFILE=~/docker/caddy/Caddyfile CADDY_CONTAINER=caddy ./setup-winkel.sh

set -euo pipefail

DOMAIN="${DOMAIN:-halfframe.spielmann.it}"
SITE_CONTAINER="halfframe"
CADDYFILE="${CADDYFILE:-$HOME/docker/caddy/Caddyfile}"
CADDY_CONTAINER="${CADDY_CONTAINER:-}"
DEPLOY_SCRIPT="${DEPLOY_SCRIPT:-$HOME/docker/winkel-deploy/winkel-deploy.sh}"
REPO_DIR="$(cd "$(dirname "$0")" && pwd)"

ok()   { printf '\033[32m✓\033[0m %s\n' "$*"; }
info() { printf '\033[36m→\033[0m %s\n' "$*"; }
warn() { printf '\033[33m!\033[0m %s\n' "$*"; }
fail() { printf '\033[31m✗\033[0m %s\n' "$*"; exit 1; }

# Alles steht in main(), damit Bash das ganze Skript einliest, bevor das git pull die Datei ersetzt.
main() {

# Auf HP-Winkel braucht Docker sudo (der Benutzer ist nicht in der Gruppe docker)
if docker info >/dev/null 2>&1; then
  DOCKER="docker"
else
  DOCKER="sudo docker"
fi
command -v docker >/dev/null || fail "Docker nicht gefunden."
$DOCKER info >/dev/null 2>&1 || fail "Docker läuft nicht oder sudo wurde abgelehnt."

# 1. Neuste Version holen
if [ -d "$REPO_DIR/.git" ]; then
  info "Hole neuste Version aus GitHub"
  git -C "$REPO_DIR" pull --ff-only && ok "Repo aktuell"
fi

# 2. Netzwerk und Container
if ! $DOCKER network inspect proxy >/dev/null 2>&1; then
  info "Lege Docker Netzwerk 'proxy' an"
  $DOCKER network create proxy >/dev/null
fi
info "Starte Container $SITE_CONTAINER"
# --force-recreate: Falls sich nginx/default.conf geändert hat, übernimmt der Container sie sicher.
(cd "$REPO_DIR" && $DOCKER compose up -d --force-recreate)
ok "Container läuft"

# 3. Lokaler Test, noch ohne Caddy
sleep 2
if $DOCKER exec "$SITE_CONTAINER" wget -q -O /dev/null http://127.0.0.1/ 2>/dev/null; then
  ok "nginx im Container antwortet"
else
  fail "nginx im Container antwortet nicht. Log: $DOCKER logs $SITE_CONTAINER"
fi

# 4. DNS prüfen. Ohne Eintrag scheitert das Zertifikat, und Let's Encrypt begrenzt Fehlversuche.
#    Darum hier anhalten, bevor Caddy den Block bekommt.
info "Prüfe DNS für $DOMAIN"
DNS_IP="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1 {print $1}' || true)"
WAN_IP="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"
if [ -z "$DNS_IP" ]; then
  warn "Kein A Record für $DOMAIN gefunden."
  warn "Bei Metanet anlegen: Typ A, Name 'halfframe', Ziel ${WAN_IP:-46.126.153.195}. Danach dieses Skript nochmals starten."
  warn "Der Container läuft schon, Caddy wurde noch nicht angefasst."
  exit 1
elif [ -n "$WAN_IP" ] && [ "$DNS_IP" != "$WAN_IP" ]; then
  fail "$DOMAIN zeigt auf $DNS_IP, die öffentliche IP ist aber $WAN_IP. Eintrag bei Metanet prüfen."
else
  ok "DNS zeigt auf $DNS_IP"
fi

# 5. Caddy Container finden
if [ -z "$CADDY_CONTAINER" ]; then
  CADDY_CONTAINER="$($DOCKER ps --format '{{.Names}} {{.Image}}' | awk 'tolower($2) ~ /caddy/ {print $1; exit}')"
fi
[ -n "$CADDY_CONTAINER" ] || fail "Kein laufender Caddy Container gefunden. Name mit CADDY_CONTAINER=... angeben."
ok "Caddy Container: $CADDY_CONTAINER"

if ! $DOCKER inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$CADDY_CONTAINER" | grep -qw proxy; then
  warn "Caddy hängt nicht am Netzwerk 'proxy'. Verbinde ihn jetzt."
  $DOCKER network connect proxy "$CADDY_CONTAINER"
fi

# 6. Caddyfile ergänzen (mit Sicherung)
[ -f "$CADDYFILE" ] || fail "Caddyfile nicht gefunden: $CADDYFILE (Pfad mit CADDYFILE=... angeben)"
CHANGED=0
BACKUP=""
if grep -Eq "^[[:space:]]*$(printf '%s' "$DOMAIN" | sed 's/\./\\./g')([[:space:],{]|$)" "$CADDYFILE"; then
  ok "Block für $DOMAIN ist schon in der Caddyfile"
else
  BACKUP="$CADDYFILE.bak-$(date +%Y%m%d-%H%M%S)"
  cp "$CADDYFILE" "$BACKUP"
  info "Sicherung: $BACKUP"
  printf '\n%s {\n    reverse_proxy %s:80\n}\n' "$DOMAIN" "$SITE_CONTAINER" >> "$CADDYFILE"
  ok "Block für $DOMAIN ergänzt"
  CHANGED=1
fi

# 7. Caddy prüfen und neu laden. Bei einem Fehler wird die Sicherung zurückgespielt.
CONF_IN_CONTAINER="/etc/caddy/Caddyfile"
$DOCKER exec "$CADDY_CONTAINER" test -f "$CONF_IN_CONTAINER" \
  || fail "Im Container liegt keine $CONF_IN_CONTAINER. Caddy bitte manuell neu laden."
info "Prüfe Caddy Konfiguration"
if ! $DOCKER exec "$CADDY_CONTAINER" caddy validate --config "$CONF_IN_CONTAINER" --adapter caddyfile >/dev/null 2>&1; then
  if [ "$CHANGED" = 1 ]; then
    cp "$BACKUP" "$CADDYFILE"
    fail "Caddyfile ungültig, alte Version wiederhergestellt. Fehler anzeigen: $DOCKER exec $CADDY_CONTAINER caddy validate --config $CONF_IN_CONTAINER"
  fi
  fail "Caddyfile ungültig. Fehler anzeigen: $DOCKER exec $CADDY_CONTAINER caddy validate --config $CONF_IN_CONTAINER"
fi
$DOCKER exec "$CADDY_CONTAINER" caddy reload --config "$CONF_IN_CONTAINER" --adapter caddyfile >/dev/null
ok "Caddy neu geladen"

# 8. Von aussen testen (das erste Zertifikat kann ein paar Sekunden dauern)
info "Teste https://$DOMAIN"
CODE=""
for i in 1 2 3 4 5 6; do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$DOMAIN/" || true)"
  [ "$CODE" = "200" ] && break
  sleep 5
done
if [ "$CODE" = "200" ]; then
  ok "https://$DOMAIN ist online"
else
  warn "https://$DOMAIN antwortet mit '$CODE'. Logs: $DOCKER logs $CADDY_CONTAINER --tail 50"
  warn "Vom Heimnetz aus kann das am NAT Loopback des Routers liegen: dann am Handy über Mobilfunk testen."
fi

# 9. Pull Job: nur prüfen und die fehlende Zeile anzeigen. Das Skript wird bewusst nicht automatisch geändert.
if [ -f "$DEPLOY_SCRIPT" ]; then
  if grep -q "deploy halfframe" "$DEPLOY_SCRIPT"; then
    ok "Pull Job kennt halfframe schon"
  else
    warn "Pull Job kennt halfframe noch nicht. Diese Zeile am Ende von $DEPLOY_SCRIPT ergänzen:"
    printf '    %s\n' "deploy halfframe '^(nginx/|docker-compose\.yml)' '--force-recreate'"
  fi
else
  warn "$DEPLOY_SCRIPT nicht gefunden. Pfad mit DEPLOY_SCRIPT=... angeben."
fi
}

main "$@"
exit $?
