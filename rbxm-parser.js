'use strict';

const MAGIC = Buffer.from([
  0x3C, 0x72, 0x6F, 0x62, 0x6C, 0x6F, 0x78, 0x21,
  0x89, 0xFF, 0x0D, 0x0A, 0x1A, 0x0A
]);

function lz4Decompress(src, uncompressedSize) {
  const dst = Buffer.alloc(uncompressedSize);
  let sPos = 0;
  let dPos = 0;

  while (sPos < src.length) {
    const token = src[sPos++];

    let litLen = (token >>> 4) & 0xF;
    if (litLen === 15) {
      let s;
      do {
        s = src[sPos++];
        litLen += s;
      } while (s === 255);
    }

    src.copy(dst, dPos, sPos, sPos + litLen);
    sPos += litLen;
    dPos += litLen;

    if (sPos >= src.length) break;

    const matchOffset = src.readUInt16LE(sPos);
    sPos += 2;

    let matchLen = (token & 0xF) + 4;
    if ((token & 0xF) === 15) {
      let s;
      do {
        s = src[sPos++];
        matchLen += s;
      } while (s === 255);
    }

    const matchStart = dPos - matchOffset;
    for (let i = 0; i < matchLen; i++) {
      dst[dPos++] = dst[matchStart + i];
    }
  }

  return dst;
}

function readString(buf, pos) {
  const len = buf.readUInt32LE(pos);
  pos += 4;
  const value = buf.toString('utf8', pos, pos + len);
  return { value, pos: pos + len };
}

function readInterleavedInt32(buf, offset, count) {
  const out = [];
  let acc = 0;
  for (let i = 0; i < count; i++) {
    const raw = (
      (buf[offset + i] << 24) |
      (buf[offset + count + i] << 16) |
      (buf[offset + 2 * count + i] << 8) |
      (buf[offset + 3 * count + i])
    ) >>> 0;
    const delta = (raw >>> 1) ^ (-(raw & 1));
    acc += delta;
    out.push(acc);
  }
  return out;
}

function getChunkData(buf, pos) {
  const chunkName = buf.toString('ascii', pos, pos + 4);
  pos += 4;
  const compLen = buf.readUInt32LE(pos); pos += 4;
  const uncompLen = buf.readUInt32LE(pos); pos += 4;
  pos += 4;

  let data;
  if (compLen === 0) {
    data = buf.slice(pos, pos + uncompLen);
    pos += uncompLen;
  } else {
    data = lz4Decompress(buf.slice(pos, pos + compLen), uncompLen);
    pos += compLen;
  }

  return { chunkName, data, nextPos: pos };
}

function parseRBXM(buf) {
  if (buf.length < 32) throw new Error('File is too small to be a valid RBXM.');
  if (!buf.slice(0, 14).equals(MAGIC)) {
    throw new Error('Invalid file. Make sure you upload a `.rbxm` or `.rbxl` binary file.');
  }

  let pos = 14;
  pos += 2; // uint16 version field (always 0)
  const numTypes = buf.readUInt32LE(pos); pos += 4;
  const numInstances = buf.readUInt32LE(pos); pos += 4;
  pos += 8; // reserved

  const typeNames = new Map();
  const instanceTypes = new Map();
  const parentOf = new Map();
  const instanceNames = new Map();

  const pendingProps = [];

  while (pos + 16 <= buf.length) {
    const { chunkName, data, nextPos } = getChunkData(buf, pos);
    pos = nextPos;

    const cleanName = chunkName.replace(/\0/g, ' ').trim();
    if (cleanName === 'END') break;

    if (cleanName === 'INST') {
      let p = 0;
      const typeId = data.readUInt32LE(p); p += 4;
      const { value: className, pos: p2 } = readString(data, p); p = p2;
      p += 1;
      const count = data.readUInt32LE(p); p += 4;

      typeNames.set(typeId, className);

      if (count > 0 && p + count * 4 <= data.length) {
        const refs = readInterleavedInt32(data, p, count);
        for (const ref of refs) {
          instanceTypes.set(ref, typeId);
        }
        pendingProps.push({ typeId, refs });
      }

    } else if (cleanName === 'PROP') {
      let p = 0;
      try {
        const typeId = data.readUInt32LE(p); p += 4;
        const { value: propName, pos: p2 } = readString(data, p); p = p2;

        if (propName === 'Name') {
          const propType = data[p]; p += 1;
          if (propType === 0x02) {
            const typeEntry = pendingProps.find(e => e.typeId === typeId);
            const refs = typeEntry ? typeEntry.refs : [];
            for (let i = 0; i < refs.length; i++) {
              if (p >= data.length) break;
              const { value: nameVal, pos: p3 } = readString(data, p);
              p = p3;
              instanceNames.set(refs[i], nameVal);
            }
          }
        }
      } catch (_) {}

    } else if (cleanName === 'PRNT') {
      let p = 1;
      const count = data.readUInt32LE(p); p += 4;
      if (count > 0 && p + count * 8 <= data.length) {
        const children = readInterleavedInt32(data, p, count); p += count * 4;
        const parents = readInterleavedInt32(data, p, count);
        for (let i = 0; i < children.length; i++) {
          parentOf.set(children[i], parents[i]);
        }
      }
    }
  }

  return { typeNames, instanceTypes, parentOf, instanceNames, numInstances };
}

const MAX_LINES = 500;

const CLASS_TO_EMOJI_KEY = {
  Part: 'roblox_cube', WedgePart: 'roblox_cube', CornerWedgePart: 'roblox_cube',
  TrussPart: 'roblox_cube', CylinderPart: 'roblox_cube', MeshPart: 'roblox_cube',
  UnionOperation: 'roblox_part', SpawnLocation: 'roblox_part',
  Seat: 'roblox_part', VehicleSeat: 'roblox_part',
  SpecialMesh: 'roblox_part', BlockMesh: 'roblox_part', FileMesh: 'roblox_part',
  Attachment: 'roblox_part',
  Vector3Value: 'roblox_part', CFrameValue: 'roblox_part', NumberValue: 'roblox_part',
  IntValue: 'roblox_part', BoolValue: 'roblox_part', StringValue: 'roblox_part',
  ObjectValue: 'roblox_part', Color3Value: 'roblox_part', BrickColorValue: 'roblox_part',
  Folder: 'roblox_folder',
  Frame: 'roblox_frame', ScrollingFrame: 'roblox_frame', ViewportFrame: 'roblox_frame',
  ImageLabel: 'roblox_imagelabel', ImageButton: 'roblox_imagelabel',
  Decal: 'roblox_imagelabel', Texture: 'roblox_imagelabel',
  PointLight: 'roblox_light', SpotLight: 'roblox_light',
  SurfaceLight: 'roblox_light', Lighting: 'roblox_light',
  Sky: 'roblox_light', Atmosphere: 'roblox_light',
  ScreenGui: 'roblox_screengui', SurfaceGui: 'roblox_screengui',
  BillboardGui: 'roblox_screengui', StarterGui: 'roblox_screengui', CoreGui: 'roblox_screengui',
  Model: 'roblox_model',
  ModuleScript: 'roblox_module',
  Script: 'roblox_script', ServerScriptService: 'roblox_script',
  LocalScript: 'roblox_local',
  StarterPlayerScripts: 'roblox_local', StarterCharacterScripts: 'roblox_local',
  Sound: 'roblox_sound', SoundGroup: 'roblox_sound',
  TextLabel: 'roblox_textlabel',
  TextButton: 'roblox_textbutton',
  TextBox: 'roblox_textbox',
  Humanoid: 'roblox_humanoid', HumanoidDescription: 'roblox_humanoid',
  Tool: 'roblox_tool', BackpackItem: 'roblox_tool', HopperBin: 'roblox_tool',
  RemoteEvent: 'roblox_remote', RemoteFunction: 'roblox_remote',
  BindableEvent: 'roblox_remote', BindableFunction: 'roblox_remote',
  Animation: 'roblox_anim', Animator: 'roblox_anim', AnimationController: 'roblox_anim',
  Camera: 'roblox_camera',
};

function getEmoji(className, emojiConfig) {
  if (!emojiConfig) return '';
  const key = CLASS_TO_EMOJI_KEY[className] || 'roblox_blank';
  const id = emojiConfig[key];
  if (!id) return '';
  return `<:${key}:${id}> `;
}

function renderHierarchy(typeNames, instanceTypes, parentOf, instanceNames, emojiConfig = null) {
  const children = new Map();
  for (const [child, parent] of parentOf) {
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(child);
  }

  const lines = [];
  let truncated = false;

  function walk(ref, level) {
    if (lines.length >= MAX_LINES) { truncated = true; return; }

    const typeId = instanceTypes.get(ref);
    const className = typeId !== undefined ? (typeNames.get(typeId) ?? 'Unknown') : 'Unknown';
    const name = instanceNames.get(ref) || className;
    const indent = level === 0 ? '' : ' '.repeat(level + 1);
    const icon = getEmoji(className, emojiConfig);

    lines.push(`${indent}${icon}${name} [${className}]`);

    const kids = children.get(ref) || [];
    for (const kid of kids) {
      walk(kid, level + 1);
    }
  }

  const roots = children.get(-1) || [];
  for (const root of roots) {
    walk(root, 0);
  }

  return { lines, truncated };
}

function calculateFlags(typeNames, instanceTypes) {
  const counts = new Map();
  for (const [, typeId] of instanceTypes) {
    const cls = typeNames.get(typeId) || 'Unknown';
    counts.set(cls, (counts.get(cls) || 0) + 1);
  }

  const requiresScore =
    (counts.get('ModuleScript') || 0);

  const destructionScore =
    (counts.get('Script') || 0) +
    (counts.get('LocalScript') || 0);

  const sandboxingScore =
    (counts.get('RemoteEvent') || 0) +
    (counts.get('RemoteFunction') || 0) +
    (counts.get('BindableEvent') || 0) +
    (counts.get('BindableFunction') || 0);

  return { requiresScore, destructionScore, sandboxingScore };
}

module.exports = { parseRBXM, renderHierarchy, calculateFlags };
