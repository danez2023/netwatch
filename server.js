const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const ping = require('ping');
const cron = require('node-cron');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const cors = require('cors');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const adapter = new FileSync(path.join(dataDir, 'netwatch.json'));
const db = low(adapter);
db.defaults({ devices: [], status_log: [], alerts: [] }).write();

if (db.get('devices').size().value() === 0) {
  const demos = [
    { id: uuidv4(), name: 'Core Router',     ip: '192.168.1.1',   type: 'router',  group_name: 'Network Core', port: null, protocol: 'icmp', interval: 30, timeout: 5, enabled: true, created_at: Date.now() },
    { id: uuidv4(), name: 'Main Switch',     ip: '192.168.1.2',   type: 'switch',  group_name: 'Network Core', port: null, protocol: 'icmp', interval: 30, timeout: 5, enabled: true, created_at: Date.now() },
    { id: uuidv4(), name: 'Access Point 1',  ip: '192.168.1.10',  type: 'ap',      group_name: 'Wireless',     port: null, protocol: 'icmp', interval: 60, timeout: 5, enabled: true, created_at: Date.now() },
    { id: uuidv4(), name: 'Access Point 2',  ip: '192.168.1.11',  type: 'ap',      group_name: 'Wireless',     port: null, protocol: 'icmp', interval: 60, timeout: 5, enabled: true, created_at: Date.now() },
    { id: uuidv4(), name: 'NVR Server',      ip: '192.168.1.50',  type: 'nvr',     group_name: 'CCTV',         port: 80,   protocol: 'http', interval: 60, timeout: 5, enabled: true, created_at: Date.now() },
    { id: uuidv4(), name: 'CCTV Camera 01',  ip: '192.168.1.100', type: 'camera',  group_name: 'CCTV',         port: null, protocol: 'icmp', interval: 30, timeout: 5, enabled: true, created_at: Date.now() },
    { id: uuidv4(), name: 'CCTV Camera 02',  ip: '192.168.1.101', type: 'camera',  group_name: 'CCTV',         port: null, protocol: 'icmp', interval: 30, timeout: 5, enabled: true, created_at: Date.now() },
    { id: uuidv4(), name: 'CCTV Camera 03',  ip: '192.168.1.102', type: 'camera',  group_name: 'CCTV',         port: null, protocol: 'icmp', interval: 30, timeout: 5, enabled: true, created_at: Date.now() },
    { id: uuidv4(), name: 'CCTV Camera 04',  ip: '192.168.1.103', type: 'camera',  group_name: 'CCTV',         port: null, protocol: 'icmp', interval: 30, timeout: 5, enabled: true, created_at: Date.now() },
    { id: uuidv4(), name: 'File Server',     ip: '192.168.1.20',  type: 'server',  group_name: 'Servers',      port: 445,  protocol: 'tcp',  interval: 60, timeout: 5, enabled: true, created_at: Date.now() },
    { id: uuidv4(), name: 'DNS Server',      ip: '192.168.1.21',  type: 'server',  group_name: 'Servers',      port: 53,   protocol: 'tcp',  interval: 60, timeout: 5, enabled: true, created_at: Date.now() },
    { id: uuidv4(), name: 'Google DNS',      ip: '8.8.8.8',       type: 'network', group_name: 'External',     port: null, protocol: 'icmp', interval: 60, timeout: 5, enabled: true, created_at: Date.now() },
  ];
  db.set('devices', demos).write();
  console.log('✅ Demo devices inserted');
}

let deviceStates = {};

function getDevices() { return db.get('devices').filter({ enabled: true }).value(); }

function logStatus(deviceId, status, responseTime) {
  const entry = { id: Date.now() + Math.random(), device_id: deviceId, status, response_time: responseTime, timestamp: Math.floor(Date.now() / 1000) };
  db.get('status_log').push(entry).write();
  const all = db.get('status_log').filter({ device_id: deviceId }).value();
  if (all.length > 2880) {
    const keep = all.slice(-2880).map(e => e.id);
    db.set('status_log', db.get('status_log').filter(e => e.device_id !== deviceId || keep.includes(e.id)).value()).write();
  }
}

function createAlert(device, message, severity = 'warning') {
  const alert = { id: Date.now(), device_id: device.id, device_name: device.name, message, severity, acknowledged: false, timestamp: Math.floor(Date.now() / 1000) };
  db.get('alerts').push(alert).write();
  broadcast({ type: 'alert', data: alert });
}

async function checkDevice(device) {
  const start = Date.now();
  let online = false, responseTime = null;
  try {
    if (device.protocol === 'http' && device.port) {
      const res = await axios.get(`http://${device.ip}:${device.port}`, { timeout: device.timeout * 1000 });
      online = res.status < 500; responseTime = Date.now() - start;
    } else if (device.protocol === 'tcp' && device.port) {
      const net = require('net');
      online = await new Promise(resolve => {
        const s = new net.Socket();
        s.setTimeout(device.timeout * 1000);
        s.on('connect', () => { s.destroy(); resolve(true); });
        s.on('error', () => resolve(false));
        s.on('timeout', () => { s.destroy(); resolve(false); });
        s.connect(device.port, device.ip);
      });
      responseTime = Date.now() - start;
    } else {
      const res = await ping.promise.probe(device.ip, { timeout: device.timeout, min_reply: 1 });
      online = res.alive;
      responseTime = res.time !== 'unknown' ? parseFloat(res.time) : null;
    }
  } catch(e) { online = false; }

  const prevState = deviceStates[device.id];
  const status = online ? 'up' : 'down';
  deviceStates[device.id] = { ...device, status, responseTime, lastChecked: Date.now(), lastUp: online ? Date.now() : (prevState?.lastUp || null), lastDown: !online ? Date.now() : (prevState?.lastDown || null) };
  logStatus(device.id, status, responseTime);
  if (prevState && prevState.status !== status) {
    createAlert(device, online ? `✅ ${device.name} is back ONLINE (${device.ip})` : `🔴 ${device.name} went OFFLINE (${device.ip})`, online ? 'recovery' : 'critical');
  }
  broadcast({ type: 'device_update', data: deviceStates[device.id] });
  return deviceStates[device.id];
}

async function checkAllDevices() {
  await Promise.allSettled(getDevices().map(d => checkDevice(d)));
}

cron.schedule('*/30 * * * * *', checkAllDevices);
setTimeout(checkAllDevices, 1500);

function broadcast(msg) {
  const data = JSON.stringify(msg);
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(data); });
}

wss.on('connection', ws => {
  ws.send(JSON.stringify({ type: 'init', data: Object.values(deviceStates) }));
});

app.get('/api/devices', (req, res) => {
  res.json(db.get('devices').value().map(d => ({ ...d, ...(deviceStates[d.id] || {}) })));
});

app.post('/api/devices', (req, res) => {
  const { name, ip, type, group_name, port, protocol, interval, timeout } = req.body;
  const device = { id: uuidv4(), name, ip, type: type||'network', group_name: group_name||'General', port: port||null, protocol: protocol||'icmp', interval: interval||60, timeout: timeout||5, enabled: true, created_at: Date.now() };
  db.get('devices').push(device).write();
  checkDevice(device);
  res.json({ success: true, device });
});

app.put('/api/devices/:id', (req, res) => {
  db.get('devices').find({ id: req.params.id }).assign(req.body).write();
  res.json({ success: true });
});

app.delete('/api/devices/:id', (req, res) => {
  db.get('devices').remove({ id: req.params.id }).write();
  delete deviceStates[req.params.id];
  broadcast({ type: 'device_removed', data: { id: req.params.id } });
  res.json({ success: true });
});

app.get('/api/devices/:id/history', (req, res) => {
  const hours = parseInt(req.query.hours) || 24;
  const since = Math.floor(Date.now() / 1000) - (hours * 3600);
  res.json(db.get('status_log').filter(l => l.device_id === req.params.id && l.timestamp > since).sortBy('timestamp').reverse().take(500).value());
});

app.get('/api/devices/:id/stats', (req, res) => {
  const hours = parseInt(req.query.hours) || 24;
  const since = Math.floor(Date.now() / 1000) - (hours * 3600);
  const logs = db.get('status_log').filter(l => l.device_id === req.params.id && l.timestamp > since).value();
  const total = logs.length, up = logs.filter(l => l.status === 'up').length;
  const rtLogs = logs.filter(l => l.response_time);
  const avgRt = rtLogs.length ? rtLogs.reduce((s, l) => s + l.response_time, 0) / rtLogs.length : 0;
  res.json({ total, up, down: total-up, uptime_pct: total ? ((up/total)*100).toFixed(2) : '100.00', avg_response_time: avgRt.toFixed(2) });
});

app.get('/api/alerts', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json(db.get('alerts').sortBy('timestamp').reverse().take(limit).value());
});

app.post('/api/alerts/:id/ack', (req, res) => {
  db.get('alerts').find({ id: parseInt(req.params.id) }).assign({ acknowledged: true }).write();
  res.json({ success: true });
});

app.post('/api/alerts/ack-all', (req, res) => {
  db.get('alerts').each(a => { a.acknowledged = true; }).write();
  res.json({ success: true });
});

app.post('/api/devices/:id/check', async (req, res) => {
  const device = db.get('devices').find({ id: req.params.id }).value();
  if (!device) return res.status(404).json({ error: 'Not found' });
  res.json(await checkDevice(device));
});

app.get('/api/summary', (req, res) => {
  const devs = db.get('devices').filter({ enabled: true }).value();
  const states = devs.map(d => deviceStates[d.id]).filter(Boolean);
  const cameras = devs.filter(d => d.type === 'camera');
  res.json({
    total: devs.length,
    up: states.filter(s => s.status === 'up').length,
    down: states.filter(s => s.status === 'down').length,
    cameras: cameras.length,
    cams_up: cameras.filter(c => deviceStates[c.id]?.status === 'up').length,
    unacked_alerts: db.get('alerts').filter({ acknowledged: false }).size().value()
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🖥️  NetWatch running at http://0.0.0.0:${PORT}`);
  console.log(`📡 WebSocket active\n`);
});
