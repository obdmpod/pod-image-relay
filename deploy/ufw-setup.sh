#!/usr/bin/env bash
# One-shot UFW configuration for the podcast relay droplet.
# Run as root (or with sudo) once, after initial SSH hardening.
#
# Leaves open:
#   tcp/22  — SSH
#   tcp/80  — Caddy (Let's Encrypt HTTP-01 challenges, + redirect to 443)
#   tcp/443 — wss:// traffic
#
# Blocks everything else inbound. The Node relay binds to 127.0.0.1:8080
# only, so it is not reachable from outside regardless.

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "run as root (or sudo)" >&2
  exit 1
fi

apt-get update
apt-get install -y ufw

ufw --force reset
ufw default deny incoming
ufw default allow outgoing

ufw allow OpenSSH
ufw allow 80/tcp comment 'Caddy HTTP'
ufw allow 443/tcp comment 'Caddy HTTPS / wss'

# Uncomment if you want to further restrict SSH to specific source IPs:
# ufw delete allow OpenSSH
# ufw allow from YOUR.HOME.IP.HERE to any port 22 proto tcp

ufw --force enable
ufw status verbose
