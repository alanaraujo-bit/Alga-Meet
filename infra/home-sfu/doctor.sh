#!/usr/bin/env bash
# Health report for the home SFU. No sudo, changes nothing, prints no secrets:  cd ~/alga-sfu && ./doctor.sh
# Everything is tested from inside the house; the outside test (phone on 4G/5G) is README §7.
set -uo pipefail
cd "$(dirname "$0")"
pass() { printf '  \033[32mOK\033[0m    %s\n' "$*"; }
warn() { printf '  \033[33mAVISO\033[0m %s\n' "$*"; }
fail() { printf '  \033[31mFALHA\033[0m %s\n' "$*"; }
get() { grep -m1 "^$1=" .env 2>/dev/null | cut -d= -f2- || true; }
private() { [[ $1 =~ ^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.) ]]; }
sub=$(get DUCKDNS_SUBDOMAIN); DOMAIN=${sub%.duckdns.org}.duckdns.org

echo "== Rede"
lan=$(ip route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p')
gw=$(ip route show default 2>/dev/null | awk '{print $3; exit}')
echo "  IP na rede local: ${lan:-?}  roteador: ${gw:-?}"
pub4=$(curl -4 -fsS --max-time 8 https://api.ipify.org 2>/dev/null || true)
[ -n "$pub4" ] && echo "  IPv4 público (visto de fora): $pub4" || fail "sem IPv4 de saída para a internet"
wan=$(docker compose exec -T upnp upnpc -s 2>/dev/null | sed -n 's/^ExternalIPAddress = //p' | tr -d '\r')
if [ -z "$wan" ]; then warn "roteador não respondeu por UPnP: compare o IP WAN na página do roteador com $pub4"
elif private "$wan"; then fail "IP WAN do roteador $wan é privado/CGNAT: ninguém de fora alcança esta casa (README §1)"
elif [ "$wan" != "$pub4" ]; then fail "IP WAN do roteador $wan != IP público $pub4: NAT duplo ou CGNAT (README §1)"
else pass "sem CGNAT: IP WAN do roteador = IP público ($wan)"; fi
hop=$(command -v tracepath >/dev/null && timeout 15 tracepath -4 -n -m 3 1.1.1.1 2>/dev/null | awk '$1 ~ /^2:/ {print $2; exit}')
[ -n "${hop:-}" ] && { private "$hop" && echo "  (o 1º salto depois do roteador, $hop, é endereço privado: normal na rede do provedor; o que vale é a linha acima)" || echo "  1º salto depois do roteador: $hop"; }
pub6=$(curl -6 -fsS --max-time 8 https://api6.ipify.org 2>/dev/null || true)
echo "  IPv6 público: ${pub6:-nenhum}  (AAAA no DuckDNS: DUCKDNS_IPV6=$(get DUCKDNS_IPV6))"

echo "== DNS ($DOMAIN)"
a=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1 {print $1}')
if [ "$a" = "$pub4" ]; then pass "A $a = IP público"; else fail "A ${a:-ausente} != IP público ${pub4:-?} (veja: docker compose logs duckdns)"; fi
aaaa=$(getent ahostsv6 "$DOMAIN" 2>/dev/null | awk '$1 !~ /^::ffff:/ {print $1; exit}')
[ -n "$aaaa" ] && echo "  AAAA $aaaa (precisa de liberação de entrada IPv6 no roteador)"

echo "== Contêineres"
docker compose ps --format '  {{.Service}}: {{.State}} {{.Health}}' 2>/dev/null || fail "docker compose indisponível"
turn_on=$([ -n "$(get CINEMA_TURN_SECRET)" ] && echo 1 || echo 0)   # coturn is optional (README §11)
for s in livekit caddy duckdns upnp; do
  st=$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q "$s" 2>/dev/null)" 2>/dev/null)
  [ "$st" = healthy ] || fail "$s: ${st:-parado} (docker compose logs --tail 30 $s)"
done
id=$(docker compose ps -q livekit 2>/dev/null)
if [ -n "$id" ]; then
  adv=$(docker logs --since "$(docker inspect -f '{{.State.StartedAt}}' "$id")" "$id" 2>&1 | grep -m1 -o '"nodeIP": "[^"]*"' | cut -d'"' -f4)
  [ "$adv" = "$pub4" ] && pass "LiveKit anuncia o IP público ($adv)" || fail "LiveKit anuncia '${adv:-?}', IP público é $pub4 (./ipwatch.sh corrige)"
fi

echo "== Portas neste servidor"
ss -Htlnu 2>/dev/null | awk '{print $1, $5}' | grep -E '^(tcp [^ ]*:(80|443|7881|3479)|udp [^ ]*:(7882|3478|3479))$' | sort -u | sed 's/^/  escutando: /'
if [ -f /etc/ufw/ufw.conf ] && grep -q '^ENABLED=yes' /etc/ufw/ufw.conf; then
  echo "  ufw ativo: normal. As portas publicadas pelo Docker entram pelas regras DNAT do próprio Docker, antes do ufw."
else echo "  ufw inativo"; fi

echo "== Roteador (UPnP)"
need=5; [ "$turn_on" = 1 ] && need=48   # 5 SFU ports + coturn 3479 tcp/udp + 41 relay ports
maps=$(docker compose exec -T upnp upnpc -l 2>/dev/null | tr -d '\r' | grep "'alga-sfu'" || true)
if [ "$(get UPNP)" = 0 ]; then echo "  UPNP=0: portas encaminhadas à mão (README §2)"
elif [ "$(echo "$maps" | grep -c .)" -ge "$need" ]; then pass "$need encaminhamentos UPnP ativos"; echo "$maps" | sed 's/^/   /'
else fail "encaminhamentos UPnP incompletos (docker compose logs upnp):"; echo "$maps" | sed 's/^/   /'; fi

echo "== TLS (certificados Let's Encrypt)"
for h in "$DOMAIN" "turn.$DOMAIN"; do
  c=$(echo | timeout 8 openssl s_client -connect 127.0.0.1:443 -servername "$h" 2>/dev/null | openssl x509 -noout -issuer -enddate 2>/dev/null)
  if echo "$c" | grep -qi "let's encrypt"; then pass "$h: válido até $(echo "$c" | sed -n 's/^notAfter=//p')"
  else fail "$h: sem certificado ainda (porta 80 aberta de fora? docker compose logs caddy | grep -i acme)"; fi
done

echo "== LiveKit e TURN"
r=$(curl -fsS --max-time 8 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/" 2>&1)
[ "$r" = OK ] && pass "https://$DOMAIN/ -> OK (local, via Caddy)" || fail "https://$DOMAIN/ local: $r"
stun() { python3 - "$1" "$2" <<'PY' 2>/dev/null
import os, socket, struct, sys
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.settimeout(3)
tid = os.urandom(12)
s.sendto(struct.pack('!HHI', 1, 0, 0x2112A442) + tid, (sys.argv[1], int(sys.argv[2])))
d, _ = s.recvfrom(2048)
print('ok' if d[:2] == b'\x01\x01' and d[8:20] == tid else 'bad')
PY
}
[ "$(stun 127.0.0.1 3478)" = ok ] && pass "TURN/UDP 3478 responde (local)" || fail "TURN/UDP 3478 não responde localmente"
# Hairpin = the router sends traffic for its own public IP back inside. TURN relays from this box to <public IP>:7882,
# so without hairpin TURN cannot work (direct UDP 7882 / TCP 7881 still do; they cover almost every network).
if [ -n "$pub4" ]; then
  h1=$(curl -fsS --max-time 8 --resolve "$DOMAIN:443:$pub4" "https://$DOMAIN/" 2>/dev/null)
  h2=$(stun "$pub4" 3478)
  if [ "$h1" = OK ] && [ "$h2" = ok ]; then pass "NAT loopback (hairpin) funciona: portas abertas no IP público e TURN viável"
  else warn "sem NAT loopback (443: ${h1:-falhou}, 3478/udp: ${h2:-falhou}): TURN não vai funcionar; voz/tela seguem por 7882/udp e 7881/tcp. Teste de fora: README §7"; fi
fi

# coturn (Sala de Cinema, optional): STUN binding request works without credentials; the relay needs a TURN REST one.
if [ "$turn_on" = 1 ]; then
  tid=$(docker ps -q --filter label=com.docker.compose.project=alga-sfu --filter label=com.docker.compose.service=coturn)
  st=$([ -n "$tid" ] && docker inspect -f '{{.State.Health.Status}}' "$tid" 2>/dev/null)
  [ "$st" = healthy ] && pass "coturn: contêiner saudável" || fail "coturn: ${st:-parado} (docker compose --profile cinema logs --tail 30 coturn)"
  [ "$(stun 127.0.0.1 3479)" = ok ] && pass "coturn 3479/udp responde (local)" || fail "coturn 3479/udp não responde localmente"
  ext=$([ -n "$tid" ] && docker exec "$tid" cat /tmp/ext-ip 2>/dev/null | tr -d '\r')
  [ -n "$ext" ] && [ "$ext" = "$pub4" ] && pass "coturn anuncia o IP público ($ext)" || fail "coturn anuncia '${ext:-?}', IP público é ${pub4:-?} (./ipwatch.sh corrige)"
else echo "  relay da Sala de Cinema (coturn): desligado (sem CINEMA_TURN_SECRET no .env, README §11)"; fi

echo "== Sistema"
rm=$(cat /proc/sys/net/core/rmem_max); wm=$(cat /proc/sys/net/core/wmem_max)
[ "$rm" -ge 5000000 ] && [ "$wm" -ge 5000000 ] && pass "buffers UDP $rm/$wm" || warn "buffers UDP $rm/$wm (padrão): opcional sudo bash root-setup.sh"
grep -qs 'Unattended-Upgrade "1"' /etc/apt/apt.conf.d/20auto-upgrades && pass "atualizações automáticas de segurança ligadas" || warn "atualizações automáticas desligadas (sudo bash root-setup.sh)"
[ -f /var/run/reboot-required ] && warn "o sistema pede reinício (sudo reboot)"
df -Pk . | awk 'NR==2 {printf "  disco livre: %d GB\n", $4/1048576}'
crontab -l 2>/dev/null | grep -q ipwatch.sh && pass "cron do ipwatch.sh ativo" || warn "cron do ipwatch.sh ausente (rode ./install.sh)"
errs=$(docker compose logs --no-log-prefix --since 1h livekit caddy 2>/dev/null | grep -E '\b(ERROR|error)\b' | tail -n 3)
[ -z "$errs" ] || { echo "  últimos erros (1 h):"; echo "$errs" | cut -c1-200 | sed 's/^/   /'; }
