#!/usr/bin/env bash
# deploy/setup.sh — one-time setup on a fresh Ubuntu/Debian VPS (Hetzner/DO/Vultr/AWS lightsail).
# Usage: bash deploy/setup.sh
set -euo pipefail

echo "== FabInvests VPS setup =="

# 1. Node 22 LTS
if ! command -v node >/dev/null || [ "$(node -v | cut -dv -f2 | cut -d. -f1)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node -v

# 2. PM2 (process manager) — keeps both processes alive, restarts on crash/boot
sudo npm i -g pm2

# 3. Project
cd "$(dirname "$0")/.."
npm run build 2>/dev/null || true          # engine has no build
(cd web && npm ci && npm run build)        # dashboard build

# 4. First init (idempotent; keeps learning if state exists)
node scripts/v2/init.mjs || true

# 5. Start both under PM2 + survive reboots
pm2 delete fabinvests-engine fabinvests-web 2>/dev/null || true
pm2 start deploy/ecosystem.config.cjs
pm2 save
pm2 startup systemd -u "$USER" --hp "$HOME"   # run the printed command if sudo is required

echo "== Done =="
echo "Engine: pm2 logs fabinvests-engine"
echo "Web:    http://$(curl -s ifconfig.me):3002"
echo "Recommended: keep port 3002 firewalled and use an SSH tunnel or Tailscale instead:"
echo "  ssh -L 3002:localhost:3002 user@your-vps   then open http://localhost:3002"
