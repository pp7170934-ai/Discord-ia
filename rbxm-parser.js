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
  const numTypes = buf.readUInt32LE(pos); pos += 4;
  const numInstances = buf.readUInt32LE(pos); pos += 4;
  pos += 8;

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

const MAX_LINES = 200;

function renderHierarchy(typeNames, instanceTypes, parentOf, instanceNames) {
  const children = new Map();
  for (const [child, parent] of parentOf) {
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(child);
  }

  const lines = [];
  let truncated = false;

  function walk(ref, prefix, isLast) {
    if (lines.length >= MAX_LINES) { truncated = true; return; }

    const typeId = instanceTypes.get(ref);
    const cls = typeId !== undefined ? (typeNames.get(typeId) ?? 'Unknown') : 'Unknown';
    const name = instanceNames.get(ref);
    const label = name && name !== cls ? `${cls} ("${name}")` : cls;

    lines.push(`${prefix}${isLast ? '└── ' : '├── '}${label}`);

    const kids = (children.get(ref) || []).sort((a, b) => a - b);
    const childPrefix = prefix + (isLast ? '    ' : '│   ');
    for (let i = 0; i < kids.length; i++) {
      walk(kids[i], childPrefix, i === kids.length - 1);
    }
  }

  const roots = (children.get(-1) || []).sort((a, b) => a - b);
  for (let i = 0; i < roots.length; i++) {
    walk(roots[i], '', i === roots.length - 1);
  }

  return { lines, truncated };
}

module.exports = { parseRBXM, renderHierarchy };
