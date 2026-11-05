#!/usr/bin/env bash
# Home-server SFU installer. No sudo, does not touch ufw (published Docker ports are let in by Docker's own DNAT).
# Run from the stack directory (~/alga-sfu, holding this kit and .env) as a user in the `docker` group:
#   cd ~/alga-sfu && ./install.sh
# Idempotent: re-run after editing .env or copying a new kit version. Secrets are read from .env, never printed.
set -euo pipefail
cd "$(dirname "$0")"
DIR=$PWD
die()  { echo "ERRO: $*" >&2; exit 1; }
warn() { echo "AVISO: $*" >&2; }
ok()   { echo "ok: $*"; }

[ "$(id -u)" != 0 ] || die "rode sem sudo, como o seu usuário (precisa estar no grupo docker)"

# --- 1. Machine -------------------------------------------------------------------------------------------------
. /etc/os-release 2>/dev/null || true
case "${ID:-}:${VERSION_ID:-}" in ubuntu:22.04|ubuntu:24.04) ok "$PRETTY_NAME" ;; *) warn "testado em Ubuntu 22.04/24.04, este é ${PRETTY_NAME:-desconhecido}" ;; esac
case "$(uname -m)" in x86_64|aarch64) ;; *) die "arquitetura $(uname -m) sem imagem do LiveKit (só amd64/arm64)" ;; esac
cpus=$(nproc); ram_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo); disk_gb=$(df -Pk "$DIR" | awk 'NR==2 {print int($4/1048576)}')
ok "CPU ${cpus} núcleos, RAM ${ram_mb} MB, disco livre ${disk_gb} GB"
[ "$cpus" -ge 2 ] || warn "menos de 2 núcleos: o SFU aguenta só poucas pessoas"
[ "$ram_mb" -ge 1800 ] || warn "menos de 2 GB de RAM"
[ "$disk_gb" -ge 2 ] || die "menos de 2 GB livres em $DIR"

# --- 2. Docker --------------------------------------------------------------------------------------------------
command -v docker >/dev/null || die "Docker não instalado. Uma vez, com sudo: sudo bash root-setup.sh (README §5)"
docker info >/dev/null 2>&1 || die "sem acesso ao Docker sem sudo: o usuário precisa estar no grupo docker (sudo usermod -aG docker \$USER, depois saia e entre de novo)"
docker compose version >/dev/null 2>&1 || die "plugin docker compose ausente (sudo bash root-setup.sh)"
ok "$(docker --version | cut -d, -f1), $(docker compose version --short 2>/dev/null | sed 's/^/compose /')"

# --- 3. .env (secrets: checked, never echoed) -------------------------------------------------------------------
ENV=$DIR/.env
[ -f "$ENV" ] || die "falta $ENV (README §4)"
chmod 600 "$ENV"
sed -i 's/\r$//' "$ENV"                     # created from Windows/PowerShell: strip CRLF, or the secret gets a \r
get() { grep -m1 "^$1=" "$ENV" | cut -d= -f2- || true; }
for k in LIVEKIT_API_KEY LIVEKIT_API_SECRET ALGA_API_URL DUCKDNS_SUBDOMAIN DUCKDNS_TOKEN; do
  [ -n "$(get "$k")" ] || die "$k vazio ou ausente em .env (README §4)"
done
key=$(get LIVEKIT_API_KEY); api=$(get ALGA_API_URL); sub=$(get DUCKDNS_SUBDOMAIN)
[ "$key" != devkey ] || die "LIVEKIT_API_KEY=devkey é o par público de dev; use o par do Railway"
[ "$(get LIVEKIT_API_SECRET | wc -c)" -gt 32 ] || die "LIVEKIT_API_SECRET com menos de 32 caracteres"
[[ $key =~ ^[A-Za-z0-9_-]+$ ]] || die "LIVEKIT_API_KEY com caracteres inesperados"
[[ $api =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] || die "ALGA_API_URL deve ser https://host, sem barra final (é $api)"
sub=${sub%.duckdns.org}
[[ $sub =~ ^[a-z0-9-]+$ ]] || die "DUCKDNS_SUBDOMAIN deve ser só o nome (ex.: alga, para alga.duckdns.org)"
DOMAIN=$sub.duckdns.org
# Containers run as this user (files they write stay yours, no root-owned leftovers in ~).
for kv in "ALGA_UID=$(id -u)" "ALGA_GID=$(id -g)"; do
  grep -q "^${kv%%=*}=" "$ENV" && sed -i "s/^${kv%%=*}=.*/$kv/" "$ENV" || echo "$kv" >> "$ENV"
done
# Cinema relay (coturn) is optional: only with CINEMA_TURN_SECRET (README §11). Without it the SFU is untouched.
PROFILE=(); TURN=0
if [ -n "$(get CINEMA_TURN_SECRET)" ]; then
  [ "$(get CINEMA_TURN_SECRET | wc -c)" -gt 32 ] || die "CINEMA_TURN_SECRET com menos de 32 caracteres"
  PROFILE=(--profile cinema); TURN=1
else
  warn "sem CINEMA_TURN_SECRET no .env: o relay da Sala de Cinema (coturn) não sobe (README §11)"
fi
ok ".env completo (modo 600), domínio $DOMAIN, API $api, chave $key"

# --- 4. Ports free (unless it is this stack holding them) -------------------------------------------------------
if [ -z "$(docker compose ps -q 2>/dev/null)" ]; then
  busy=$(ss -Htlnu 2>/dev/null | awk '{print $1, $5}' | grep -E '^(tcp [^ ]*:(80|443|7881)|udp [^ ]*:(7882|3478))$' || true)
  [ "$TURN" = 0 ] || busy="$busy $(ss -Htlnu 2>/dev/null | awk '{print $1, $5}' | grep -E '^(tcp|udp) [^ ]*:3479$' || true)"
  busy=${busy# }
  [ -z "$busy" ] || die "portas já em uso por outro serviço: $(echo $busy)"
  ok "portas 80, 443, 7881/tcp e 7882, 3478/udp livres"
fi

# --- 5. Render configs ------------------------------------------------------------------------------------------
render() { sed -e "s|<DOMAIN>|$DOMAIN|g" -e "s|<API_KEY>|$key|g" -e "s|<API_URL>|$api|g" "$1" > "$2.tmp" && mv "$2.tmp" "$2"; }
render livekit.home.yaml livekit.yaml
render caddy.home.yaml caddy.yaml
grep -n '<[A-Z_]*>' livekit.yaml caddy.yaml && die "placeholder sobrando (linhas acima)"
chmod 644 livekit.yaml caddy.yaml turnserver.conf duckdns.sh upnp.sh
chmod 755 install.sh doctor.sh ipwatch.sh
mkdir -p caddy_data
ok "livekit.yaml e caddy.yaml gerados"

# --- 6. Start ---------------------------------------------------------------------------------------------------
docker compose pull --quiet livekit caddy duckdns "${PROFILE[@]}"
docker compose build --quiet upnp
docker compose "${PROFILE[@]}" up -d --remove-orphans
for _ in $(seq 30); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q livekit)" 2>/dev/null)" = healthy ] && break
  sleep 2
done
docker compose ps

# --- 7. Cron: recreate LiveKit when the public IP changes -------------------------------------------------------
if command -v crontab >/dev/null; then
  line="*/5 * * * * $DIR/ipwatch.sh >/dev/null 2>&1"
  { crontab -l 2>/dev/null | grep -vF "$DIR/ipwatch.sh" || true; echo "$line"; } | crontab -
  ok "cron do ipwatch.sh instalado (a cada 5 min)"
else
  warn "sem crontab: se o IP público mudar, rode 'docker compose up -d --force-recreate livekit'"
fi

# --- 8. Optional root-only tuning (reported, never done here) ---------------------------------------------------
[ "$(cat /proc/sys/net/core/rmem_max)" -ge 5000000 ] ||
  warn "net.core.rmem_max=$(cat /proc/sys/net/core/rmem_max) (padrão do kernel). Opcional, recomendado para tela 1080p+: sudo bash root-setup.sh (README §5)"
echo
echo "Pronto. Confira com: ./doctor.sh"
echo "Depois, no Railway: LIVEKIT_URL=https://$DOMAIN e LIVEKIT_PUBLIC_URL=wss://$DOMAIN (README §6)"
