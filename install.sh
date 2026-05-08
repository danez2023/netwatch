#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  NetWatch — Network & CCTV Monitoring System
#  Ubuntu Server Installation Script
# ═══════════════════════════════════════════════════════════════
set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
error()   { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

echo ""
echo "  ███╗   ██╗███████╗████████╗██╗    ██╗ █████╗ ████████╗ ██████╗██╗  ██╗"
echo "  ████╗  ██║██╔════╝╚══██╔══╝██║    ██║██╔══██╗╚══██╔══╝██╔════╝██║  ██║"
echo "  ██╔██╗ ██║█████╗     ██║   ██║ █╗ ██║███████║   ██║   ██║     ███████║"
echo "  ██║╚██╗██║██╔══╝     ██║   ██║███╗██║██╔══██║   ██║   ██║     ██╔══██║"
echo "  ██║ ╚████║███████╗   ██║   ╚███╔███╔╝██║  ██║   ██║   ╚██████╗██║  ██║"
echo "  ╚═╝  ╚═══╝╚══════╝   ╚═╝    ╚══╝╚══╝ ╚═╝  ╚═╝   ╚═╝    ╚═════╝╚═╝  ╚═╝"
echo ""
echo "       Network & CCTV Uptime Monitoring System — Ubuntu Installer"
echo ""

# Check root
if [ "$EUID" -ne 0 ]; then error "Please run as root: sudo ./install.sh"; fi

INSTALL_DIR="/opt/netwatch"
SERVICE_USER="netwatch"
PORT="${PORT:-3000}"

# ── 1. Node.js ──────────────────────────────────────────────────────
info "Checking Node.js..."
if ! command -v node &> /dev/null || [[ $(node -v | cut -d'v' -f2 | cut -d'.' -f1) -lt 18 ]]; then
  info "Installing Node.js 20 LTS..."
  apt-get update -qq
  apt-get install -y -qq curl
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
  apt-get install -y -qq nodejs
  success "Node.js $(node -v) installed"
else
  success "Node.js $(node -v) already installed"
fi

# ── 2. System deps ──────────────────────────────────────────────────
info "Installing system dependencies..."
apt-get install -y -qq iputils-ping net-tools
success "System dependencies ready"

# ── 3. Service user ─────────────────────────────────────────────────
info "Creating service user..."
if ! id "$SERVICE_USER" &>/dev/null; then
  useradd -r -s /bin/false -d "$INSTALL_DIR" "$SERVICE_USER"
  success "User '$SERVICE_USER' created"
else
  success "User '$SERVICE_USER' already exists"
fi

# ── 4. Install app ──────────────────────────────────────────────────
info "Installing NetWatch to $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"
cp -r . "$INSTALL_DIR/"
mkdir -p "$INSTALL_DIR/data" "$INSTALL_DIR/logs"
cd "$INSTALL_DIR"
npm install --production --silent
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
success "Application installed"

# ── 5. Ping capability (NET_RAW) ────────────────────────────────────
info "Setting ping permissions..."
setcap cap_net_raw+ep "$(which node)" 2>/dev/null || warn "Could not set NET_RAW cap; ping may require root"
success "Ping permissions configured"

# ── 6. Systemd service ──────────────────────────────────────────────
info "Creating systemd service..."
cat > /etc/systemd/system/netwatch.service << EOF
[Unit]
Description=NetWatch — Network & CCTV Monitoring
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/node $INSTALL_DIR/server.js
Restart=always
RestartSec=5
StandardOutput=append:$INSTALL_DIR/logs/app.log
StandardError=append:$INSTALL_DIR/logs/error.log
Environment=PORT=$PORT
Environment=NODE_ENV=production
AmbientCapabilities=CAP_NET_RAW

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable netwatch
systemctl restart netwatch
sleep 2

if systemctl is-active --quiet netwatch; then
  success "NetWatch service is running"
else
  error "Service failed to start. Check: journalctl -u netwatch -n 50"
fi

# ── 7. Firewall ─────────────────────────────────────────────────────
if command -v ufw &> /dev/null; then
  info "Configuring UFW firewall..."
  ufw allow "$PORT/tcp" >/dev/null 2>&1 || true
  success "Port $PORT opened in UFW"
fi

# ── Done ────────────────────────────────────────────────────────────
LOCAL_IP=$(hostname -I | awk '{print $1}')
echo ""
echo "  ╔══════════════════════════════════════════════════════╗"
echo "  ║                                                      ║"
echo "  ║   ✅  NetWatch installed successfully!               ║"
echo "  ║                                                      ║"
echo "  ║   🌐  Dashboard: http://${LOCAL_IP}:${PORT}          ║"
echo "  ║   🌐  Local:     http://localhost:${PORT}            ║"
echo "  ║                                                      ║"
echo "  ║   Manage service:                                    ║"
echo "  ║   systemctl {start|stop|restart|status} netwatch     ║"
echo "  ║   journalctl -u netwatch -f   (live logs)            ║"
echo "  ║                                                      ║"
echo "  ╚══════════════════════════════════════════════════════╝"
echo ""
