#!/bin/sh
# DuckDNS updater (runs in the `duckdns` container, host network). Every 5 min: A record = the public IPv4 DuckDNS
# sees; with DUCKDNS_IPV6=1 also AAAA = this host's stable global IPv6. The token never reaches the log.
set -u
api="https://www.duckdns.org/update?domains=${DUCKDNS_SUBDOMAIN}&token=${DUCKDNS_TOKEN}&verbose=true"

# First global, non-ULA IPv6 that is not temporary/deprecated/tentative/dadfailed (flags 0x01|0x20|0x40|0x08), so a
# router pinhole for this address keeps working when privacy addresses rotate.
stable_ipv6() {
  while read -r a _ _ scope flags _; do
    [ "$scope" = 00 ] || continue
    case $a in f[cd]*) continue ;; esac
    [ $((0x$flags & 0x69)) -eq 0 ] || continue
    echo "$a" | sed 's/.\{4\}/&:/g; s/:$//'
    return 0
  done < /proc/net/if_inet6
  return 1
}

while :; do
  # verbose answer: OK / <ipv4> / <ipv6> / UPDATED|NOCHANGE. IPv4 is auto-detected only when ipv6= is absent.
  r=$(curl -4 -fsS --max-time 20 "$api" 2>&1) || r="KO (request failed)"
  ip4=$(echo "$r" | sed -n 2p)
  if [ "${DUCKDNS_IPV6:-0}" = 1 ] && [ "${r%%[!A-Z]*}" = OK ] && ip6=$(stable_ipv6); then
    r=$(curl -4 -fsS --max-time 20 "$api&ip=$ip4&ipv6=$ip6" 2>&1) || r="KO (request failed)"
  fi
  echo "$(date -u +%FT%TZ) $(echo "$r" | tr '\n' ' ')"
  [ "${r%%[!A-Z]*}" = OK ] && touch /tmp/ok
  sleep 300
done
