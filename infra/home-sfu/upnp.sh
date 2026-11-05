#!/bin/sh
# UPnP port mapper (runs in the `upnp` container, host network). Asks the router to forward the SFU ports to this
# host, refreshes every 20 min (1 h lease), and deletes the mappings when the container stops (compose down/stop).
set -u
MAPS="80/TCP 443/TCP 7881/TCP 7882/UDP 3478/UDP"
# coturn relay (only when CINEMA_TURN_SECRET is in .env): 3479 and its relay range (turnserver.conf min-port/max-port),
# one mapping per port, UPnP has no ranges.
if [ -n "${CINEMA_RELAY:-}" ]; then
  MAPS="$MAPS 3479/TCP 3479/UDP"
  for p in $(seq 49160 49200); do MAPS="$MAPS $p/UDP"; done
fi
total=$(echo $MAPS | wc -w)

if [ "${UPNP:-1}" = 0 ]; then
  echo "UPNP=0: nothing to do (forward the ports on the router by hand, README section 2)"
  while :; do touch /tmp/ok; sleep 600; done
fi

lan=${UPNP_LAN_IP:-$(ip route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p')}
[ -n "$lan" ] || { echo "no LAN IPv4 found; set UPNP_LAN_IP in .env"; exit 1; }

# ufw drops the router's unicast replies to the SSDP multicast, so discovery can fail on this host; UPNP_URL
# (the IGD description URL, e.g. http://192.168.1.1:12345/12345gatedesc.xml) skips discovery.
U=${UPNP_URL:+-u $UPNP_URL}

mine=""   # only delete what we mapped: a failed add may mean another device owns that port
cleanup() {
  for m in $mine; do upnpc $U -d "${m%/*}" "${m#*/}" >/dev/null 2>&1; done
  echo "mappings removed"
  exit 0
}
trap cleanup TERM INT

while :; do
  ok=0; mine=""
  for m in $MAPS; do
    port=${m%/*}; proto=${m#*/}
    # Lease of 1 h; some routers only accept permanent (0) leases (error 725), so retry with 0.
    out=$(upnpc $U -e alga-sfu -a "$lan" "$port" "$port" "$proto" 3600 2>&1)
    echo "$out" | grep -q 'is redirected to internal' ||
      out=$(upnpc $U -e alga-sfu -a "$lan" "$port" "$port" "$proto" 0 2>&1)
    if echo "$out" | grep -q 'is redirected to internal'; then
      ok=$((ok + 1)); mine="$mine $m"; echo "ok    $port/$proto -> $lan:$port"
    else
      echo "FAIL  $port/$proto: $(echo "$out" | grep -i -m1 -E 'fail|error|no igd|not found' || echo "$out" | tail -n1)"
    fi
  done
  wan=$(upnpc $U -s 2>/dev/null | sed -n 's/^ExternalIPAddress = //p')
  echo "$(date -u +%FT%TZ) $ok/$total mapped, router WAN IP: ${wan:-unknown}"
  [ "$ok" = "$total" ] && touch /tmp/ok
  sleep 1200 & wait $!
done
