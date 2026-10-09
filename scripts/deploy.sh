#!/usr/bin/env bash
# Builds Quill and publishes it through the Caddy of a relay deployment (nostr-relay-khatru), the same way the ephemeral chat is published:
#
#   ./scripts/deploy.sh <path-to-relay-repo> <domain>
#   ./scripts/deploy.sh ~/proyectos/nostr-relay-khatru quill.hivescope.xyz
#
# It copies dist/ to <relay-repo>/sites/quill/, writes <relay-repo>/sites/quill.caddy, VALIDATES the whole Caddy configuration and only then reloads it
# (a graceful reload: the relay and the chat keep serving). If validation fails nothing is reloaded and the previous files are restored.
set -euo pipefail
cd "$(dirname "$0")/.."

RELAY_REPO="${1:?usage: deploy.sh <path-to-relay-repo> <domain>}"
DOMAIN="${2:?usage: deploy.sh <path-to-relay-repo> <domain>}"
[[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]] || { echo "invalid domain" >&2; exit 1; }
[[ -d "$RELAY_REPO/sites" ]] || { echo "$RELAY_REPO/sites does not exist: is that the relay repo?" >&2; exit 1; }

npm run build
BACKUP="$(mktemp -d)"
trap 'rm -rf "$BACKUP"' EXIT
[[ -d "$RELAY_REPO/sites/quill" ]] && cp -a "$RELAY_REPO/sites/quill" "$BACKUP/quill"
[[ -f "$RELAY_REPO/sites/quill.caddy" ]] && cp -a "$RELAY_REPO/sites/quill.caddy" "$BACKUP/quill.caddy"

mkdir -p "$RELAY_REPO/sites/quill"
rsync -a --delete dist/ "$RELAY_REPO/sites/quill/"
sed -e "s#__DOMAIN__#$DOMAIN#" deploy/quill.caddy.template > "$RELAY_REPO/sites/quill.caddy"

restore() {
  echo "validation failed: restoring the previous files, nothing was reloaded" >&2
  rm -rf "$RELAY_REPO/sites/quill" "$RELAY_REPO/sites/quill.caddy"
  [[ -d "$BACKUP/quill" ]] && cp -a "$BACKUP/quill" "$RELAY_REPO/sites/quill"
  [[ -f "$BACKUP/quill.caddy" ]] && cp -a "$BACKUP/quill.caddy" "$RELAY_REPO/sites/quill.caddy"
  exit 1
}

cd "$RELAY_REPO"
docker compose exec -T caddy caddy validate --config /etc/caddy/Caddyfile || restore
docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile
echo "published: https://$DOMAIN"
