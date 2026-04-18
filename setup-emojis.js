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
  ihdr[8] = 8; ihdr[9] = 6; // RGBA

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

// ── Pixel art icon painter ──────────────────────────────────────────────────

function makeIcon(name) {
  const S = 64;
  const px = Array.from({ length: S * S }, () => [0, 0, 0, 0]);

  const set = (x, y, r, g, b, a = 255) => {
    if (x >= 0 && x < S && y >= 0 && y < S) px[y * S + x] = [r, g, b, a];
  };
  const fill = (x1, y1, x2, y2, r, g, b, a = 255) => {
    for (let y = Math.max(0, y1); y <= Math.min(S - 1, y2); y++)
      for (let x = Math.max(0, x1); x <= Math.min(S - 1, x2); x++)
        set(x, y, r, g, b, a);
  };
  const border = (x1, y1, x2, y2, r, g, b, thick = 2) => {
    for (let t = 0; t < thick; t++) {
      for (let x = x1 + t; x <= x2 - t; x++) {
        set(x, y1 + t, r, g, b);
        set(x, y2 - t, r, g, b);
      }
      for (let y = y1 + t + 1; y <= y2 - t - 1; y++) {
        set(x1 + t, y, r, g, b);
        set(x2 - t, y, r, g, b);
      }
    }
  };
  const line = (x1, y1, x2, y2, r, g, b) => {
    const dx = Math.abs(x2 - x1), dy = Math.abs(y2 - y1);
    const sx = x1 < x2 ? 1 : -1, sy = y1 < y2 ? 1 : -1;
    let err = dx - dy, x = x1, y = y1;
    while (true) {
      set(x, y, r, g, b);
      if (x === x2 && y === y2) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
    }
  };
  const circle = (cx, cy, radius, r, g, b, filled = true) => {
    const r2 = radius * radius;
    const ir2 = Math.max(0, radius - 2) * Math.max(0, radius - 2);
    for (let dy = -radius; dy <= radius; dy++)
      for (let dx2 = -radius; dx2 <= radius; dx2++) {
        const d2 = dx2 * dx2 + dy * dy;
        if (filled ? d2 <= r2 : (d2 <= r2 && d2 >= ir2))
          set(cx + dx2, cy + dy, r, g, b);
      }
  };

  // ── roblox_part: solid blue square (Roblox Studio Part icon) ──────────────
  if (name === 'roblox_part') {
    const m = 12, M = 51;
    fill(m, m, M, M, 72, 148, 214);
    // top highlight
    fill(m, m, M, m + 3, 130, 190, 240);
    fill(m, m, m + 3, M, 130, 190, 240);
    // bottom shadow
    fill(M - 3, m, M, M, 45, 105, 170);
    fill(m, M - 3, M, M, 45, 105, 170);
  }

  // ── roblox_folder: yellow folder shape ────────────────────────────────────
  else if (name === 'roblox_folder') {
    // folder body
    fill(6, 26, 57, 54, 215, 148, 28);
    // folder tab (top-left rounded)
    fill(6, 18, 24, 26, 215, 148, 28);
    fill(7, 17, 23, 18, 215, 148, 28);
    // top highlight on body
    fill(6, 26, 57, 29, 240, 185, 70);
    fill(6, 17, 24, 20, 240, 185, 70);
    // inner lighter area
    fill(9, 31, 54, 51, 230, 165, 45);
    // bottom shadow
    fill(6, 52, 57, 54, 165, 105, 15);
  }

  // ── roblox_frame: dark bg + orange dashed selection border ────────────────
  else if (name === 'roblox_frame') {
    fill(0, 0, S - 1, S - 1, 44, 44, 48);
    // solid corners
    fill(10, 10, 16, 16, 224, 118, 42);
    fill(47, 10, 53, 16, 224, 118, 42);
    fill(10, 47, 16, 53, 224, 118, 42);
    fill(47, 47, 53, 53, 224, 118, 42);
    // dashed top and bottom edges
    for (let x = 19; x <= 46; x += 7) {
      fill(x, 10, x + 4, 12, 224, 118, 42);
      fill(x, 51, x + 4, 53, 224, 118, 42);
    }
    // dashed left and right edges
    for (let y = 19; y <= 46; y += 7) {
      fill(10, y, 12, y + 4, 224, 118, 42);
      fill(51, y, 53, y + 4, 224, 118, 42);
    }
  }

  // ── roblox_imagelabel: green bg with landscape inside ─────────────────────
  else if (name === 'roblox_imagelabel') {
    // outer frame
    fill(4, 4, 59, 59, 55, 130, 55);
    border(4, 4, 59, 59, 35, 90, 35, 2);
    // sky
    fill(7, 7, 56, 28, 90, 175, 210);
    // sun
    circle(48, 14, 5, 250, 230, 60, true);
    // mountain left
    for (let i = 0; i < 22; i++) fill(7 + i, 28 - i, 7 + i * 2, 28 - i, 60, 120, 60);
    // mountain right peak
    for (let i = 0; i < 16; i++) fill(38 - i, 28 - i, 56, 28 - i, 80, 145, 75);
    // ground
    fill(7, 28, 56, 56, 55, 125, 55);
    // path
    fill(22, 38, 42, 56, 85, 165, 75);
  }

  // ── roblox_light: dark bg + yellow lightbulb ──────────────────────────────
  else if (name === 'roblox_light') {
    fill(0, 0, S - 1, S - 1, 32, 32, 36);
    // faint glow halo
    for (let r2 = 22; r2 >= 16; r2--) {
      const a = Math.floor(30 * (22 - r2) / 6);
      circle(32, 24, r2, 200, 180, 20, false);
    }
    // bulb body
    circle(32, 22, 13, 240, 205, 30, true);
    // glare spot
    circle(27, 17, 4, 255, 245, 140, true);
    // base / screw collar
    fill(26, 33, 38, 37, 185, 160, 30);
    fill(27, 38, 37, 41, 150, 130, 28);
    fill(28, 42, 36, 45, 100, 90, 100);
    fill(28, 46, 36, 49, 80, 75, 82);
    // filament
    line(29, 27, 32, 33, 200, 165, 20);
    line(35, 27, 32, 33, 200, 165, 20);
  }

  // ── roblox_screengui: dark + monitor with UI wireframe ────────────────────
  else if (name === 'roblox_screengui') {
    fill(0, 0, S - 1, S - 1, 35, 52, 82);
    // monitor outer
    fill(5, 5, 58, 48, 55, 85, 140);
    border(5, 5, 58, 48, 85, 130, 200, 3);
    // screen interior
    fill(9, 9, 54, 44, 65, 105, 170);
    // toolbar row
    fill(11, 11, 52, 16, 90, 150, 210);
    // left sidebar
    fill(11, 18, 20, 42, 80, 135, 195);
    // content pane lines
    fill(23, 20, 52, 23, 75, 125, 185);
    fill(23, 27, 52, 30, 75, 125, 185);
    fill(23, 34, 44, 37, 75, 125, 185);
    fill(23, 41, 38, 43, 75, 125, 185);
    // stand
    fill(25, 49, 39, 52, 85, 130, 200);
    fill(18, 53, 46, 56, 85, 130, 200);
  }

  // ── roblox_model: dark bg + overlapping orange & pink squares ─────────────
  else if (name === 'roblox_model') {
    fill(0, 0, S - 1, S - 1, 35, 35, 38);
    // back square (pink/magenta)
    fill(26, 12, 55, 42, 195, 55, 175);
    border(26, 12, 55, 42, 155, 35, 140, 2);
    // front square (orange)
    fill(8, 24, 37, 54, 225, 82, 40);
    border(8, 24, 37, 54, 185, 58, 22, 2);
  }

  // ── roblox_module: dark bg + grey document + purple right-arrow ───────────
  else if (name === 'roblox_module') {
    fill(0, 0, S - 1, S - 1, 35, 35, 38);
    // document body
    fill(6, 8, 40, 56, 105, 108, 118);
    // dog-ear fold (top right corner)
    fill(32, 8, 40, 16, 35, 35, 38);
    line(32, 8, 40, 16, 135, 138, 148);
    // text lines on doc
    fill(10, 20, 36, 23, 165, 168, 178);
    fill(10, 28, 36, 31, 165, 168, 178);
    fill(10, 36, 26, 39, 165, 168, 178);
    fill(10, 44, 36, 47, 165, 168, 178);
    // right-pointing triangle (purple)
    for (let i = 0; i < 14; i++) {
      fill(44, 25 + i, 44 + Math.min(i, 13 - i), 25 + i, 155, 85, 230);
      fill(44, 38 - i, 44 + Math.min(i, 13 - i), 38 - i, 155, 85, 230);
    }
  }

  // ── roblox_script: dark bg + white code lines ─────────────────────────────
  else if (name === 'roblox_script') {
    fill(0, 0, S - 1, S - 1, 44, 47, 54);
    // code lines (indented to look like code)
    fill(8, 12, 52, 16, 215, 215, 220);
    fill(14, 22, 52, 26, 215, 215, 220);
    fill(8, 32, 42, 36, 215, 215, 220);
    fill(14, 42, 52, 46, 215, 215, 220);
    // keyword color hint
    fill(8, 12, 22, 16, 100, 155, 230);
    fill(14, 22, 28, 26, 100, 155, 230);
  }

  // ── roblox_local: blue bg + white code lines ──────────────────────────────
  else if (name === 'roblox_local') {
    fill(0, 0, S - 1, S - 1, 36, 62, 100);
    fill(8, 12, 52, 16, 200, 220, 245);
    fill(14, 22, 52, 26, 200, 220, 245);
    fill(8, 32, 42, 36, 200, 220, 245);
    fill(14, 42, 52, 46, 200, 220, 245);
    fill(8, 12, 22, 16, 100, 185, 255);
    fill(14, 22, 28, 26, 100, 185, 255);
  }

  // ── roblox_sound: orange bg + white speaker icon ──────────────────────────
  else if (name === 'roblox_sound') {
    fill(0, 0, S - 1, S - 1, 208, 95, 22);
    // speaker box body
    fill(8, 22, 26, 42, 255, 255, 255);
    // triangular horn (right side of box expanding outward)
    for (let y = 14; y <= 50; y++) {
      const half = Math.max(0, 10 - Math.abs(y - 32));
      if (half > 0) fill(26, y, 26 + half * 2, y, 255, 255, 255);
    }
    // sound waves (3 arcs as vertical lines)
    for (let w = 0; w < 3; w++) {
      const wx = 50 + w * 4;
      const h = 14 - w * 4;
      for (let y = 32 - h; y <= 32 + h; y++) set(wx, y, 255, 255, 255);
      // round the arc slightly
      set(wx - 1, 32 - h, 255, 255, 255);
      set(wx - 1, 32 + h, 255, 255, 255);
    }
  }

  // ── roblox_textlabel: dark bg + blue "T" ─────────────────────────────────
  else if (name === 'roblox_textlabel') {
    fill(0, 0, S - 1, S - 1, 35, 35, 38);
    // crossbar
    fill(10, 13, 54, 21, 80, 148, 228);
    // vertical stem
    fill(26, 13, 38, 54, 80, 148, 228);
    // bottom serif
    fill(16, 50, 48, 54, 80, 148, 228);
    // top corners (anti-square the crossbar)
    fill(10, 13, 14, 17, 35, 35, 38);
    fill(50, 13, 54, 17, 35, 35, 38);
  }

  // ── roblox_textbutton: green bg + white "T" ───────────────────────────────
  else if (name === 'roblox_textbutton') {
    fill(0, 0, S - 1, S - 1, 52, 160, 62);
    // slight rounded-rect look
    fill(0, 0, 3, 3, 0, 0, 0, 0);
    fill(60, 0, 63, 3, 0, 0, 0, 0);
    fill(0, 60, 3, 63, 0, 0, 0, 0);
    fill(60, 60, 63, 63, 0, 0, 0, 0);
    // crossbar
    fill(10, 13, 54, 21, 255, 255, 255);
    // stem
    fill(26, 13, 38, 54, 255, 255, 255);
    // bottom serif
    fill(16, 50, 48, 54, 255, 255, 255);
  }

  // ── roblox_textbox: dark bg + teal "T" with cursor ───────────────────────
  else if (name === 'roblox_textbox') {
    fill(0, 0, S - 1, S - 1, 35, 35, 38);
    fill(10, 13, 54, 21, 28, 188, 165);
    fill(26, 13, 38, 54, 28, 188, 165);
    fill(16, 50, 48, 54, 28, 188, 165);
    // text cursor line
    fill(40, 28, 42, 48, 28, 188, 165);
  }

  // ── roblox_humanoid: simple character silhouette ──────────────────────────
  else if (name === 'roblox_humanoid') {
    fill(0, 0, S - 1, S - 1, 35, 35, 38);
    // head
    circle(32, 14, 9, 210, 172, 128, true);
    // body
    fill(22, 24, 42, 43, 180, 140, 100);
    // arms
    fill(10, 24, 21, 42, 180, 140, 100);
    fill(43, 24, 54, 42, 180, 140, 100);
    // legs
    fill(22, 44, 30, 58, 85, 90, 175);
    fill(34, 44, 42, 58, 85, 90, 175);
  }

  // ── roblox_tool: dark bg + tool/gear icon ────────────────────────────────
  else if (name === 'roblox_tool') {
    fill(0, 0, S - 1, S - 1, 35, 35, 38);
    // wrench handle (diagonal bar)
    for (let i = 0; i < 5; i++) line(10 + i, 54, 36 + i, 28, 175, 115, 210);
    // wrench head (ring)
    circle(42, 22, 12, 175, 115, 210, false);
    circle(42, 22, 8, 175, 115, 210, false);
    fill(38, 8, 46, 14, 35, 35, 38); // gap slot
    fill(38, 8, 46, 14, 175, 115, 210, 0);
    fill(39, 9, 45, 13, 35, 35, 38);
  }

  // ── roblox_remote: dark bg + teal diamond ────────────────────────────────
  else if (name === 'roblox_remote') {
    fill(0, 0, S - 1, S - 1, 35, 35, 38);
    // filled diamond
    for (let i = 0; i <= 20; i++) {
      fill(32 - i, 12 + i, 32 + i, 12 + i, 22, 165, 140);
    }
    for (let i = 0; i <= 20; i++) {
      fill(32 - (20 - i), 32 + i, 32 + (20 - i), 32 + i, 22, 165, 140);
    }
  }

  // ── roblox_anim: dark bg + film-strip / play button ──────────────────────
  else if (name === 'roblox_anim') {
    fill(0, 0, S - 1, S - 1, 35, 35, 38);
    // film strip body
    fill(14, 6, 50, 57, 60, 65, 75);
    // perforations left column
    for (let y = 10; y <= 52; y += 10) fill(16, y, 20, y + 6, 35, 35, 38);
    // perforations right column
    for (let y = 10; y <= 52; y += 10) fill(44, y, 48, y + 6, 35, 35, 38);
    // center frame
    fill(22, 12, 42, 52, 88, 98, 118);
    // play triangle
    for (let i = 0; i < 12; i++) {
      fill(26 + i, 22 + i, 26 + i, 42 - i, 200, 205, 220);
    }
  }

  // ── roblox_camera: dark bg + camera body + lens ──────────────────────────
  else if (name === 'roblox_camera') {
    fill(0, 0, S - 1, S - 1, 35, 35, 38);
    // camera body
    fill(6, 20, 58, 52, 72, 78, 90);
    border(6, 20, 58, 52, 95, 102, 118, 2);
    // viewfinder bump
    fill(16, 12, 34, 20, 72, 78, 90);
    border(16, 12, 34, 20, 95, 102, 118, 2);
    // shutter button
    fill(42, 12, 52, 20, 185, 65, 65);
    // lens rings
    circle(32, 36, 12, 48, 52, 64, true);
    circle(32, 36, 9, 35, 38, 48, true);
    circle(32, 36, 6, 90, 100, 125, true);
    circle(32, 36, 3, 160, 170, 195, true);
  }

  // ── roblox_blank: neutral grey square ────────────────────────────────────
  else if (name === 'roblox_blank') {
    fill(0, 0, S - 1, S - 1, 55, 58, 65);
    border(0, 0, S - 1, S - 1, 75, 78, 86, 3);
  }

  return px;
}

// ── Emoji names list ────────────────────────────────────────────────────────

const EMOJI_NAMES = [
  'roblox_part',
  'roblox_folder',
  'roblox_frame',
  'roblox_imagelabel',
  'roblox_light',
  'roblox_screengui',
  'roblox_model',
  'roblox_module',
  'roblox_script',
  'roblox_local',
  'roblox_sound',
  'roblox_textlabel',
  'roblox_textbutton',
  'roblox_textbox',
  'roblox_humanoid',
  'roblox_tool',
  'roblox_remote',
  'roblox_anim',
  'roblox_camera',
  'roblox_blank',
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
  if (!appId) throw new Error('Could not get application ID — check DISCORD_TOKEN');
  console.log('[emojis] App ID:', appId);

  const existing = await discordRequest('GET', `/applications/${appId}/emojis`, null, token);
  const existingMap = {};
  for (const e of (existing.body.items || [])) existingMap[e.name] = e.id;

  const config = {};

  for (const name of EMOJI_NAMES) {
    if (existingMap[name]) {
      console.log(`[emojis] ${name} already exists (${existingMap[name]})`);
      config[name] = existingMap[name];
      continue;
    }

    const pixels = makeIcon(name);
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
