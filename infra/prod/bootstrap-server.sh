#!/bin/sh
# One-time preparation of a fresh Ubuntu 24.04 server. Run as root:  sh bootstrap-server.sh
# Installs Docker, turns on the firewall (only SSH, HTTP, HTTPS), automatic security updates, a little swap memory,
# switches SSH to key-only logins, and makes the folders Office uses.
set -eu
[ "$(id -u)" = 0 ] || { echo "Run as root."; exit 1; }
export DEBIAN_FRONTEND=noninteractive

apt-get update -y
apt-get upgrade -y
apt-get install -y ufw unattended-upgrades ca-certificates curl openssl

# Docker (official installer from Docker Inc.)
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
  sh /tmp/get-docker.sh
fi
systemctl enable --now docker

# Firewall: nothing is reachable except SSH and the website.
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

# SSH: keys only (no password guessing).
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl reload ssh || systemctl reload sshd || true

# 2 GB swap as a safety net for the memory-hungry sign-in service.
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

mkdir -p /opt/office/releases /var/backups/office
chmod 700 /var/backups/office
echo "Server ready. Next: copy the project (deploy-from-pc.sh) and create /opt/office/.env (make-env.sh)."
