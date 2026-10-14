#!/usr/bin/env bash
# One-command deploy of the SA Maps voice server on Ubuntu/Debian.
#
#   sudo ./setup-vps.sh [domain] [allowed-origins]
#
#   sudo ./setup-vps.sh
#       -> https://<a-b-c-d>.sslip.io (your public IPv4; no DNS setup needed)
#   sudo ./setup-vps.sh tts.example.com https://charbelat.github.io,https://appassets.androidplatform.net
#
# Installs Docker Engine + the compose plugin from Docker's apt repository (falls back to the
# distro packages), writes .env from .env.example if missing, opens 80/443 in ufw when ufw is
# active, builds and starts the stack, and waits until https://<domain>/health answers.
# Safe to re-run: existing .env values are kept unless you pass new ones.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then exec sudo bash "$0" "$@"; fi
  echo "Please run as root." >&2
  exit 1
fi

cd "$(dirname "$(readlink -f "$0")")"
DOMAIN_ARG="${1:-}"
ORIGIN_ARG="${2:-}"
export DEBIAN_FRONTEND=noninteractive

log() { printf '\n==> %s\n' "$*"; }
warn() { printf 'WARNING: %s\n' "$*" >&2; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[ -f docker-compose.yml ] && [ -f .env.example ] || die "run this from the tts-server directory"
[ -r /etc/os-release ] || die "cannot detect the OS (/etc/os-release missing)"
# shellcheck disable=SC1091
. /etc/os-release
command -v apt-get >/dev/null 2>&1 || die "this script supports Debian/Ubuntu (apt) only"

# ------------------------------------------------------------------ Docker
docker_repo() { # prints "<debian|ubuntu> <codename>" for download.docker.com, or nothing
  case "${ID:-}" in
    ubuntu | debian) echo "${ID} ${VERSION_CODENAME:-}" ;;
    *)
      case " ${ID_LIKE:-} " in
        *" ubuntu "*) echo "ubuntu ${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}" ;;
        *" debian "*) echo "debian ${VERSION_CODENAME:-}" ;;
      esac
      ;;
  esac
}

add_docker_repo() {
  local repo_os="" codename=""
  read -r repo_os codename <<<"$(docker_repo)" || true
  [ -n "$repo_os" ] && [ -n "$codename" ] || return 1
  apt-get update -y
  apt-get install -y ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/${repo_os}/gpg" -o /etc/apt/keyrings/docker.asc || return 1
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${repo_os} ${codename} stable" \
    >/etc/apt/sources.list.d/docker.list
  apt-get update -y || { rm -f /etc/apt/sources.list.d/docker.list; return 1; }
}

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  log "Docker and compose already installed ($(docker compose version --short 2>/dev/null || echo ok))"
elif command -v docker >/dev/null 2>&1; then
  log "Installing the docker compose plugin"
  apt-get update -y
  apt-get install -y docker-compose-v2 ||
    { add_docker_repo && apt-get install -y docker-compose-plugin; } ||
    die "could not install the docker compose plugin"
else
  log "Installing Docker Engine + compose plugin"
  if add_docker_repo && apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin; then
    :
  else
    warn "Docker's apt repository is unavailable here; using the distro packages"
    rm -f /etc/apt/sources.list.d/docker.list
    apt-get update -y
    apt-get install -y docker.io
    apt-get install -y docker-compose-v2 || apt-get install -y docker-compose-plugin ||
      die "could not install the docker compose plugin"
  fi
fi
systemctl enable --now docker >/dev/null 2>&1 || service docker start >/dev/null 2>&1 || true
docker compose version >/dev/null 2>&1 || die "docker compose is not working"
command -v curl >/dev/null 2>&1 || apt-get install -y curl

# ------------------------------------------------------------------ .env
is_ipv4() { [[ "$1" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; }

detect_ip() {
  local ip url
  for url in https://api.ipify.org https://ipv4.icanhazip.com https://ifconfig.me/ip; do
    ip="$(curl -4 -fsS --max-time 6 "$url" 2>/dev/null | tr -d '[:space:]')" || ip=""
    if is_ipv4 "$ip"; then echo "$ip"; return 0; fi
  done
  ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit }}')"
  if is_ipv4 "$ip"; then echo "$ip"; return 0; fi
  return 1
}

get_env() { grep -E "^$1=" .env 2>/dev/null | tail -n 1 | cut -d= -f2- | tr -d '\r' || true; }
set_env() {
  local key="$1" val="$2" esc
  esc="$(printf '%s' "$val" | sed -e 's/[|&\\]/\\&/g')"
  if grep -qE "^${key}=" .env; then
    sed -i -E "s|^${key}=.*|${key}=${esc}|" .env
  else
    printf '%s=%s\n' "$key" "$val" >>.env
  fi
}

if [ ! -f .env ]; then
  log "Creating .env from .env.example"
  cp .env.example .env
fi
sed -i 's/\r$//' .env # tolerate a .env edited on Windows

PUBLIC_IP="$(detect_ip || true)"
CURRENT_DOMAIN="$(get_env TTS_DOMAIN)"
if [ -n "$DOMAIN_ARG" ]; then
  DOMAIN="$DOMAIN_ARG"
elif [ -z "$CURRENT_DOMAIN" ] || [[ "$CURRENT_DOMAIN" == *.sslip.io ]]; then
  [ -n "$PUBLIC_IP" ] || die "could not detect this server's public IPv4; pass a domain: ./setup-vps.sh tts.example.com"
  DOMAIN="${PUBLIC_IP//./-}.sslip.io"
else
  DOMAIN="$CURRENT_DOMAIN"
fi
DOMAIN="${DOMAIN#http://}"
DOMAIN="${DOMAIN#https://}"
DOMAIN="${DOMAIN%%/*}"
DOMAIN="${DOMAIN,,}"
[[ "$DOMAIN" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] || die "invalid domain: $DOMAIN"
set_env TTS_DOMAIN "$DOMAIN"

if [ -n "$ORIGIN_ARG" ]; then
  ORIGINS="$(printf '%s' "$ORIGIN_ARG" | tr -d ' ' | sed -E 's#/+(,|$)#\1#g')"
  set_env ALLOWED_ORIGINS "$ORIGINS"
fi
log "Domain: $DOMAIN | allowed origins: $(get_env ALLOWED_ORIGINS)"

if [ -n "$PUBLIC_IP" ] && command -v getent >/dev/null 2>&1; then
  if ! getent ahostsv4 "$DOMAIN" 2>/dev/null | awk '{print $1}' | grep -qx "$PUBLIC_IP"; then
    warn "$DOMAIN does not resolve to this server ($PUBLIC_IP) yet; HTTPS will fail until DNS points here"
  fi
fi

# ------------------------------------------------------------------ firewall
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q '^Status: active'; then
  log "Opening ports 80/443 in ufw"
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw allow 443/udp >/dev/null
fi

# ------------------------------------------------------------------ start
log "Building and starting the stack"
docker compose up -d --build --remove-orphans

log "Waiting for the voice model to load (the first start downloads it, a few minutes)"
deadline=$((SECONDS + 900))
until docker compose exec -T tts node -e "fetch('http://127.0.0.1:8787/health').then(r=>r.json()).then(j=>process.exit(j.ready?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; do
  if [ "$SECONDS" -ge "$deadline" ]; then
    docker compose logs --tail 40 tts || true
    die "the voice server did not become ready within 15 minutes"
  fi
  sleep 5
done

URL="https://${DOMAIN}/health"
log "Voice server ready; checking HTTPS at $URL (certificate issuance can take a minute)"
deadline=$((SECONDS + 240))
until curl -fsS --max-time 10 "$URL" >/dev/null 2>&1; do
  if [ "$SECONDS" -ge "$deadline" ]; then
    docker compose logs --tail 30 caddy || true
    warn "$URL is not reachable yet. Check that DNS points at ${PUBLIC_IP:-this server} and that ports 80/443 are open in your provider's firewall, then: docker compose logs -f caddy"
    exit 1
  fi
  sleep 5
done

printf '\n%s\n' "$(curl -fsS --max-time 10 "$URL")"
cat <<EOF

SA Maps voice server is live.
  Health:     $URL
  Server URL: https://${DOMAIN}   (put this in SA Maps > Settings > voice server)
  Try it:     https://${DOMAIN}/speak?speaker=smoke&text=Take%20the%20second%20exit.
EOF
