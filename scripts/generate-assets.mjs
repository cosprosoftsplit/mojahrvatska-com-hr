import { writeFileSync, mkdirSync, copyFileSync, existsSync } from 'fs';
import { deflateSync } from 'zlib';

// --- PNG Generation Utilities ---

const crc32Table = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crc32Table[n] = c;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (c >>> 8) ^ crc32Table[(c ^ buf[i]) & 0xff];
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeData = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(typeData));
  return Buffer.concat([len, typeData, crcBuf]);
}

function createPNG(width, height, pixelFn) {
  // Raw pixel data with filter byte (0 = None) per row
  const rowBytes = 1 + width * 3;
  const raw = Buffer.alloc(rowBytes * height);

  for (let y = 0; y < height; y++) {
    raw[y * rowBytes] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixelFn(x, y, width, height);
      const offset = y * rowBytes + 1 + x * 3;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
    }
  }

  const compressed = deflateSync(raw, { level: 9 });

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // color type: RGB
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // PNG signature
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- Generate favicon.png (32x32, theme color #1e3a5f) ---

const faviconPng = createPNG(32, 32, () => [0x1e, 0x3a, 0x5f]);
writeFileSync('public/favicon.png', faviconPng);
console.log(`  favicon.png (${faviconPng.length} bytes)`);

// --- Generate og-default.png (1200x630, branded design) ---

const ogPng = createPNG(1200, 630, (x, y, w, h) => {
  // Background: dark navy #0f172a
  let r = 0x0f, g = 0x17, b = 0x2a;

  // Center band (y: 180-450): theme color #1e3a5f
  if (y >= 180 && y <= 450) {
    r = 0x1e; g = 0x3a; b = 0x5f;
  }

  // Red accent stripe (Croatian flag): y 178-180
  if (y >= 178 && y < 180) {
    r = 0xdc; g = 0x26; b = 0x26;
  }

  // White accent stripe: y 450-452
  if (y > 450 && y <= 452) {
    r = 0xf1; g = 0xf5; b = 0xf9;
  }

  // Subtle checkered pattern in center (Croatian šahovnica nod)
  if (y >= 280 && y <= 350 && x >= 500 && x <= 700) {
    const cellSize = 25;
    const cx = Math.floor((x - 500) / cellSize);
    const cy = Math.floor((y - 280) / cellSize);
    if ((cx + cy) % 2 === 0) {
      r = 0xdc; g = 0x26; b = 0x26; // red
    } else {
      r = 0xf1; g = 0xf5; b = 0xf9; // white
    }
  }

  return [r, g, b];
});
writeFileSync('public/og-default.png', ogPng);
console.log(`  og-default.png (${ogPng.length} bytes)`);

// --- Vendor Fuse.js ---

mkdirSync('public/vendor', { recursive: true });

const fuseSrc = 'node_modules/fuse.js/dist/fuse.mjs';
if (existsSync(fuseSrc)) {
  copyFileSync(fuseSrc, 'public/vendor/fuse.mjs');
  console.log('  vendor/fuse.mjs copied');
} else {
  console.warn('  WARNING: fuse.js not found in node_modules. Run npm install first.');
}

console.log('Asset generation complete.');
