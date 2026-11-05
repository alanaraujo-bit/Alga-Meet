#!/usr/bin/env bash
# Cron job (install.sh adds it, every 5 min, no sudo). LiveKit learns the public IP only at startup; when the home
# IP changes it keeps advertising the old one and every call fails. This recreates the container when they differ.
set -euo pipefail
cd "$(dirname "$0")"

ip4=$(curl -4 -fsS --max-time 10 https://api.ipify.org || curl -4 -fsS --max-time 10 https://ifconfig.me) || exit 0
[[ $ip4 =~ ^[0-9]+(\.[0-9]+){3}$ ]] || exit 0   # offline or odd answer: try again next run

# coturn learns the IP at startup too (its entrypoint writes it to /tmp/ext-ip).
if [ -n "$(docker compose ps -q coturn 2>/dev/null || true)" ] && [ "$(docker compose exec -T coturn cat /tmp/ext-ip 2>/dev/null | tr -d '\r')" != "$ip4" ]; then
  logger -t alga-sfu "coturn advertises another IP than $ip4: recreating coturn" 2>/dev/null || true
  docker compose up -d --force-recreate coturn
fi

id=$(docker compose ps -q livekit 2>/dev/null || true)
[ -n "$id" ] || exit 0   # stopped on purpose (or not installed): leave it alone
started=$(docker inspect -f '{{.State.StartedAt}}' "$id")
# Startup line: starting LiveKit server {..., "nodeIP": "x.x.x.x", ...}
advertised=$(docker logs --since "$started" "$id" 2>&1 | grep -m1 -o '"nodeIP": "[^"]*"' | cut -d'"' -f4 || true)
[ "$advertised" = "$ip4" ] && exit 0
# Just (re)started and STUN not answered yet: next run decides.
[ -z "$advertised" ] && [ $(( $(date +%s) - $(date -d "$started" +%s) )) -lt 120 ] && exit 0

# Pinned mode (use_external_ip: false + NODE_IP in .env): keep NODE_IP equal to the current public IP.
if grep -q '^NODE_IP=.' .env; then sed -i "s/^NODE_IP=.*/NODE_IP=$ip4/" .env; fi
logger -t alga-sfu "LiveKit advertised '${advertised:-none}', public IP is $ip4: recreating livekit" 2>/dev/null || true
docker compose up -d --force-recreate livekit
