#!/bin/bash
# ── FencePro CRM — DigitalOcean Droplet Setup Script ──
# Run this on a fresh Ubuntu 24.04 droplet as root
# Usage: bash setup.sh

set -e

echo "════════════════════════════════════════"
echo "  FencePro CRM — Server Setup"
echo "════════════════════════════════════════"

# ── 1. System updates ──
echo "[1/8] Updating system..."
apt update && apt upgrade -y

# ── 2. Install Node.js 22 ──
echo "[2/8] Installing Node.js 22..."
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
npm install -g pnpm

# ── 3. Install Nginx ──
echo "[3/8] Installing Nginx..."
apt install -y nginx
systemctl enable nginx

# ── 4. Install Certbot (SSL) ──
echo "[4/8] Installing Certbot..."
apt install -y certbot python3-certbot-nginx

# ── 5. Create app directory ──
echo "[5/8] Creating app directory..."
mkdir -p /var/www/fencepro
chown -R www-data:www-data /var/www/fencepro

# ── 6. Install PM2 (process manager) ──
echo "[6/8] Installing PM2..."
npm install -g pm2

# ── 7. Configure firewall ──
echo "[7/8] Configuring firewall..."
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

# ── 8. Create deploy user ──
echo "[8/8] Creating deploy user..."
if ! id "deploy" &>/dev/null; then
    adduser --disabled-password --gecos "" deploy
    usermod -aG sudo deploy
    mkdir -p /home/deploy/.ssh
    cp /root/.ssh/authorized_keys /home/deploy/.ssh/ 2>/dev/null || true
    chown -R deploy:deploy /home/deploy/.ssh
fi

echo ""
echo "════════════════════════════════════════"
echo "  Setup complete!"
echo "════════════════════════════════════════"
echo ""
echo "Next steps:"
echo "  1. Set up your database connection"
echo "  2. Upload your code to /var/www/fencepro"
echo "  3. Run the deploy script"
echo ""
