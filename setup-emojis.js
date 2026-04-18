'use strict';

const https = require('https');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, 'emoji-config.json');

// ── Minimal PNG encoder ─────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const t = Buffer.from(type);
  const crcInput = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput));
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  return Buffer.concat([len, t, data, crc]);
}

function makePNG(pixels, size) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;

  const rowLen = 1 + size * 4;
  const raw = Buffer.alloc(size * rowLen);
  for (let y = 0; y < size; y++) {
    raw[y * rowLen] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a = 255] = pixels[y * size + x];
      const off = y * rowLen + 1 + x * 4;
      raw[off] = r; raw[off + 1] = g; raw[off + 2] = b; raw[off + 3] = a;
    }
  }

  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function solidColor(size, r, g, b) {
  return Array(size * size).fill([r, g, b, 255]);
}

function drawIcon(size, bg, fg, shape) {
  const pixels = solidColor(size, ...bg);
  const set = (x, y) => {
    if (x >= 0 && x < size && y >= 0 && y < size)
      pixels[y * size + x] = [...fg, 255];
  };
  const rect = (x1, y1, x2, y2, fill = false) => {
    for (let y = y1; y <= y2; y++)
      for (let x = x1; x <= x2; x++)
        if (fill || x === x1 || x === x2 || y === y1 || y === y2)
          set(x, y);
  };
  const line = (x1, y1, x2, y2) => {
    const dx = Math.abs(x2 - x1), dy = Math.abs(y2 - y1);
    const sx = x1 < x2 ? 1 : -1, sy = y1 < y2 ? 1 : -1;
    let err = dx - dy, x = x1, y = y1;
    while (true) {
      set(x, y);
      if (x === x2 && y === y2) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx)  { err += dx; y += sy; }
    }
  };
  const hline = (x1, x2, y) => { for (let x = x1; x <= x2; x++) set(x, y); };

  const s = size;
  const m = Math.floor(s * 0.15);
  const M = s - 1 - m;

  if (shape === 'square')  rect(m, m, M, M, true);
  if (shape === 'outline') rect(m, m, M, M, false);
  if (shape === 'folder') {
    rect(m, Math.floor(s * 0.35), M, M, true);
    rect(m, Math.floor(s * 0.25), Math.floor(s * 0.55), Math.floor(s * 0.35), true);
  }
  if (shape === 'lines') {
    hline(m, M, Math.floor(s * 0.30));
    hline(m, M, Math.floor(s * 0.45));
    hline(m, Math.floor(s * 0.65), Math.floor(s * 0.60));
    hline(m, M, Math.floor(s * 0.75));
  }
  if (shape === 'T') {
    const thick = Math.max(2, Math.floor(s * 0.12));
    for (let t = 0; t < thick; t++) {
      hline(m, M, Math.floor(s * 0.25) + t);
      for (let y = Math.floor(s * 0.25); y <= Math.floor(s * 0.80); y++)
        set(Math.floor(s / 2) - thick + t, y);
    }
  }
  if (shape === 'image') {
    rect(m, m, M, M, false);
    const mid = Math.floor(s / 2);
    const peak = Math.floor(s * 0.35);
    line(m, M - 2, mid, peak);
    line(mid, peak, M, M - 2);
  }
  if (shape === 'speaker') {
    const cx = Math.floor(s * 0.35), cy = Math.floor(s / 2);
    const hw = Math.floor(s * 0.14), hh = Math.floor(s * 0.18);
    rect(m, cy - hh, cx, cy + hh, true);
    for (let y = cy - hh - 2; y <= cy + hh + 2; y += 2) {
      set(cx + 2, y); set(cx + 4, y - 2); set(cx + 6, y - 4);
    }
  }
  if (shape === 'diamond') {
    const cx = Math.floor(s / 2), cy = Math.floor(s / 2), r = Math.floor(s * 0.35);
    line(cx, cy - r, cx + r, cy);
    line(cx + r, cy, cx, cy + r);
    line(cx, cy + r, cx - r, cy);
    line(cx - r, cy, cx, cy - r);
  }
  if (shape === 'dot') {
    const cx = Math.floor(s / 2), cy = Math.floor(s / 2), r = Math.floor(s * 0.25);
    for (let y = cy - r; y <= cy + r; y++)
      for (let x = cx - r; x <= cx + r; x++)
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) set(x, y);
  }

  return pixels;
}

// ── Icon definitions ────────────────────────────────────────────────────────
// [name, bg [r,g,b], fg [r,g,b], shape]

const ICON_DEFS = [
  ['roblox_part',        [61,  155, 233], [255, 255, 255], 'square'],
  ['roblox_folder',      [245, 181, 39],  [180, 120, 20],  'folder'],
  ['roblox_frame',       [224, 123, 57],  [255, 255, 255], 'outline'],
  ['roblox_imagelabel',  [76,  175, 80],  [255, 255, 255], 'image'],
  ['roblox_light',       [255, 215, 0],   [180, 140, 0],   'dot'],
  ['roblox_screengui',   [74,  144, 217], [255, 255, 255], 'outline'],
  ['roblox_model',       [232, 93,  74],  [255, 255, 255], 'diamond'],
  ['roblox_module',      [155, 89,  182], [255, 255, 255], 'lines'],
  ['roblox_script',      [149, 165, 166], [255, 255, 255], 'lines'],
  ['roblox_local',       [52,  152, 219], [255, 255, 255], 'lines'],
  ['roblox_sound',       [230, 126, 34],  [255, 255, 255], 'speaker'],
  ['roblox_textlabel',   [30,  144, 255], [255, 255, 255], 'T'],
  ['roblox_textbutton',  [46,  204, 113], [255, 255, 255], 'T'],
  ['roblox_textbox',     [26,  188, 156], [255, 255, 255], 'T'],
  ['roblox_humanoid',    [231, 76,  60],  [255, 255, 255], 'dot'],
  ['roblox_tool',        [142, 68,  173], [255, 255, 255], 'diamond'],
  ['roblox_remote',      [22,  160, 133], [255, 255, 255], 'diamond'],
  ['roblox_anim',        [52,  73,  94],  [255, 255, 255], 'square'],
  ['roblox_camera',      [44,  62,  80],  [255, 255, 255], 'outline'],
  ['roblox_blank',       [127, 140, 141], [100, 110, 111], 'square'],
];

// ── Discord API ─────────────────────────────────────────────────────────────

function discordRequest(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'discord.com',
      path: '/api/v10' + path,
      method,
      headers: {
        'Authorization': 'Bot ' + token,
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      }
    }, res => {
      let out = '';
      res.on('data', c => out += c);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(out) }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function setupEmojis(token) {
  if (fs.existsSync(CONFIG_FILE)) {
    console.log('[emojis] emoji-config.json already exists, skipping setup.');
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  }

  console.log('[emojis] Setting up application emojis...');

  const me = await discordRequest('GET', '/users/@me', null, token);
  const appId = me.body.id;
  console.log('[emojis] App ID:', appId);

  const existing = await discordRequest('GET', `/applications/${appId}/emojis`, null, token);
  const existingMap = {};
  for (const e of (existing.body.items || [])) existingMap[e.name] = e.id;

  const config = {};

  for (const [name, bg, fg, shape] of ICON_DEFS) {
    if (existingMap[name]) {
      console.log(`[emojis] ${name} already exists (${existingMap[name]})`);
      config[name] = existingMap[name];
      continue;
    }

    const pixels = drawIcon(64, bg, fg, shape);
    const png = makePNG(pixels, 64);
    const b64 = `data:image/png;base64,${png.toString('base64')}`;

    const r = await discordRequest('POST', `/applications/${appId}/emojis`, { name, image: b64 }, token);
    if (r.status === 201) {
      console.log(`[emojis] Created ${name} → ${r.body.id}`);
      config[name] = r.body.id;
    } else {
      console.error(`[emojis] Failed ${name}: ${r.status}`, JSON.stringify(r.body));
    }

    await sleep(600);
  }

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  console.log('[emojis] Done. Config saved to emoji-config.json');
  return config;
}

module.exports = { setupEmojis };
