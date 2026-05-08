# 📡 NetWatch — Network & CCTV Monitoring System

A self-hosted, real-time network monitoring dashboard for Ubuntu servers. Monitors uptime, downtime, and response times for routers, switches, access points, servers, and CCTV cameras.

---

## ✨ Features

- **Real-time monitoring** via WebSocket — no page refresh needed
- **Multi-protocol checks** — ICMP (ping), TCP port, HTTP/HTTPS
- **CCTV Camera view** — dedicated panel for camera/NVR status
- **Alert system** — automatic alerts on device status changes
- **Uptime reports** — 24h uptime percentage per device
- **Interactive charts** — pie chart, response time bars, status timelines
- **Device management** — add/remove devices from the UI
- **SQLite storage** — no external database required
- **Systemd service** — auto-starts on boot

---

## 🖥️ Requirements

- Ubuntu 20.04 / 22.04 / 24.04 LTS (64-bit)
- Node.js 18+ (installer handles this)
- 512MB RAM minimum
- Network access to monitored devices

---

## 🚀 Quick Install (Ubuntu Server)

```bash
# 1. Clone or upload the netwatch folder to your server
scp -r ./netwatch user@your-server:/tmp/

# 2. SSH into your server
ssh user@your-server

# 3. Run the installer as root
cd /tmp/netwatch
sudo chmod +x install.sh
sudo ./install.sh

# 4. Open the dashboard
# http://YOUR-SERVER-IP:3000
```

The installer will:
- Install Node.js 20 LTS automatically
- Create a dedicated `netwatch` system user
- Install the app to `/opt/netwatch`
- Register and start a systemd service
- Open port 3000 in UFW firewall

---

## ⚙️ Configuration

### Change the port
```bash
sudo systemctl edit netwatch
# Add:
[Service]
Environment=PORT=8080

sudo systemctl restart netwatch
```

### View logs
```bash
# Live logs
journalctl -u netwatch -f

# App log file
tail -f /opt/netwatch/logs/app.log
```

### Service management
```bash
sudo systemctl start netwatch
sudo systemctl stop netwatch
sudo systemctl restart netwatch
sudo systemctl status netwatch
```

---

## 📟 Adding Devices

### Via Web UI
1. Click **+ Add Device** in the top-right corner
2. Fill in: Name, IP, Type, Protocol, Group
3. Click **Add Device** — monitoring starts immediately

### Protocol Options
| Protocol | Use case | Port required |
|----------|----------|---------------|
| ICMP     | Standard ping — routers, switches, cameras | No |
| TCP      | Port check — servers, NVRs | Yes |
| HTTP     | Web interface check — NVRs with web UI | Yes (e.g. 80) |

### Device Types
- **Router** — core network routers
- **Switch** — managed/unmanaged switches  
- **Access Point** — WiFi APs
- **Camera** — IP cameras (shown in CCTV view)
- **NVR** — Network Video Recorders (shown in CCTV view)
- **Server** — file servers, DNS, etc.
- **Network** — generic network device

---

## 🏗️ Architecture

```
netwatch/
├── server.js          # Node.js Express + WebSocket server
├── public/
│   └── index.html     # Full SPA dashboard
├── data/
│   └── netwatch.db    # SQLite database (auto-created)
├── logs/
│   ├── app.log        # stdout
│   └── error.log      # stderr
├── install.sh         # Ubuntu installer
└── package.json
```

### API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/devices` | List all devices with status |
| POST | `/api/devices` | Add a new device |
| PUT | `/api/devices/:id` | Update device config |
| DELETE | `/api/devices/:id` | Remove device |
| GET | `/api/devices/:id/history` | Status history |
| GET | `/api/devices/:id/stats` | Uptime stats |
| POST | `/api/devices/:id/check` | Force immediate check |
| GET | `/api/alerts` | Recent alerts |
| POST | `/api/alerts/:id/ack` | Acknowledge alert |
| GET | `/api/summary` | Overall summary stats |
| WS | `ws://host:port` | Real-time updates |

---

## 🔧 Advanced: Nginx Reverse Proxy

To serve NetWatch on port 80 or with a domain:

```bash
sudo apt install nginx
sudo nano /etc/nginx/sites-available/netwatch
```

```nginx
server {
    listen 80;
    server_name monitor.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/netwatch /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

## 📊 Database

NetWatch uses SQLite stored at `/opt/netwatch/data/netwatch.db`.

**Tables:**
- `devices` — device config
- `status_log` — polling history (capped at 2880 records/device ≈ 48h at 30s intervals)
- `alerts` — alert history

**Backup:**
```bash
cp /opt/netwatch/data/netwatch.db /backup/netwatch-$(date +%Y%m%d).db
```

---

## 🔄 Update

```bash
cd /tmp
scp -r ./netwatch user@server:/tmp/
ssh user@server
cd /tmp/netwatch
sudo cp server.js public/index.html /opt/netwatch/
sudo cp -n package.json /opt/netwatch/
cd /opt/netwatch && sudo npm install --production
sudo systemctl restart netwatch
```

---

## 📝 License

MIT — Free for personal and commercial use.
