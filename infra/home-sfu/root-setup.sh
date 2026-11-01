#!/usr/bin/env bash
# OPTIONAL, once, by the server owner:  sudo bash root-setup.sh
# Everything here needs root, so install.sh never does it. Idempotent. Does NOT touch ufw (not needed: the stack's
# published ports are let in by Docker's DNAT rules).
#   1. UDP buffers (LiveKit recommendation; measured on this server: rmem_max/wmem_max = 212992, the kernel default)
#   2. automatic security updates (unattended-upgrades)
#   3. Docker Engine + compose plugin from Docker's official apt repo, only if Docker is missing
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "rode com sudo: sudo bash $0" >&2; exit 1; }

# 1. Larger UDP socket buffers: a 1080p60/1440p60 keyframe arrives as a burst of hundreds of packets per viewer; with
#    a 208 KiB cap the kernel drops part of the burst before LiveKit reads it -> loss -> keyframe request -> freeze.
printf 'net.core.rmem_max=5000000\nnet.core.wmem_max=5000000\n' > /etc/sysctl.d/90-alga-sfu.conf
sysctl -q -p /etc/sysctl.d/90-alga-sfu.conf
echo "ok: UDP buffers $(cat /proc/sys/net/core/rmem_max)/$(cat /proc/sys/net/core/wmem_max)"

# 2. Security updates every day (Ubuntu's default origins: -security and ESM; reboots stay manual).
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq unattended-upgrades >/dev/null
printf 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n' > /etc/apt/apt.conf.d/20auto-upgrades
systemctl enable --now unattended-upgrades >/dev/null 2>&1 || true
echo "ok: unattended-upgrades on"

# 3. Docker (https://docs.docker.com/engine/install/ubuntu/), skipped when already installed.
if ! docker compose version >/dev/null 2>&1; then
  apt-get install -y -qq ca-certificates curl >/dev/null
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${UBUNTU_CODENAME:-$VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
fi
echo "ok: $(docker --version)"
if [ -n "${SUDO_USER:-}" ] && ! id -nG "$SUDO_USER" | grep -qw docker; then
  usermod -aG docker "$SUDO_USER"
  echo "ok: $SUDO_USER no grupo docker (saia e entre de novo no SSH)"
fi
[ -f /var/run/reboot-required ] && echo "AVISO: o sistema pede reinício (sudo reboot) para aplicar atualizações"
exit 0
