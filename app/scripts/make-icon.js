// Writes the app icons into resources/: a white clock showing 6 o'clock with a crescent moon on a night-sky rounded square. No dependencies.
//   icon.png (256, windows) · icon-256.png (installer) · icon.ico (16–256, installer) · tray.png + tray@1.5x.png + tray@2x.png (tray, simplified)
const { deflateSync } = require('node:zlib')
const { writeFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')

// --- shapes as signed distances (negative = inside), coordinates 0..1 ---
const circle = (x, y, cx, cy, r) => Math.hypot(x - cx, y - cy) - r
const capsule = (x, y, ax, ay, bx, by, w) => {
  const px = x - ax; const py = y - ay; const dx = bx - ax; const dy = by - ay
  const t = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - dx * t, py - dy * t) - w / 2
}
const roundRect = (x, y, inset, r) => {
  const qx = Math.abs(x - 0.5) - (0.5 - inset - r); const qy = Math.abs(y - 0.5) - (0.5 - inset - r)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t)

const SKY_TOP = [30, 27, 75]       // #1e1b4b indigo night
const SKY_BOTTOM = [124, 58, 237]  // #7c3aed violet dusk
const FACE = [255, 255, 255]
const HAND = [30, 27, 75]
const MOON = [252, 211, 77]        // #fcd34d

// Layout per detail level: 'full' (≥48), 'mid' (32–47: no ticks/stars), 'tray' (≤24 or tray: bigger clock, no moon)
function layout(size, tray) {
  if (tray || size <= 24) return { inset: 0, radius: 0.2, cx: 0.5, cy: 0.5, r: 0.38, minute: 0.25, hour: 0.17, mw: 0.125, hw: 0.125, moon: false, ticks: false, stars: false, hub: 0, hourAngle: 120 }
  if (size < 48) return { inset: 0.02, radius: 0.22, cx: 0.45, cy: 0.55, r: 0.32, minute: 0.23, hour: 0.15, mw: 0.1, hw: 0.1, moon: true, ticks: false, stars: false, hub: 0, hourAngle: 120 }
  return { inset: 0.03, radius: 0.22, cx: 0.45, cy: 0.55, r: 0.3, minute: 0.22, hour: 0.145, mw: 0.045, hw: 0.06, moon: true, ticks: true, stars: true, hub: 0.038, hourAngle: 180 }
}

// One sample: paint shapes back to front, return [r,g,b,a] (a 0..1)
function sample(x, y, L) {
  if (roundRect(x, y, L.inset, L.radius) > 0) return [0, 0, 0, 0]
  let c = mix(SKY_TOP, SKY_BOTTOM, Math.max(0, Math.min(1, (x * 0.35 + y * 0.65 - 0.1) / 0.85)))
  if (L.stars) {
    for (const [sx, sy, sr] of [[0.2, 0.17, 0.012], [0.33, 0.1, 0.008], [0.12, 0.35, 0.008], [0.6, 0.12, 0.009]]) {
      if (circle(x, y, sx, sy, sr) < 0) c = [220, 215, 255]
    }
  }
  if (L.moon && circle(x, y, 0.775, 0.235, 0.135) < 0 && circle(x, y, 0.835, 0.185, 0.115) > 0) c = MOON
  if (circle(x, y, L.cx, L.cy, L.r) < 0) {
    c = FACE
    if (L.ticks) {
      for (let k = 0; k < 12; k++) {
        const a = k * Math.PI / 6; const major = k % 3 === 0
        const r0 = L.r * (major ? 0.74 : 0.8); const r1 = L.r * 0.88
        if (capsule(x, y, L.cx + Math.sin(a) * r0, L.cy - Math.cos(a) * r0, L.cx + Math.sin(a) * r1, L.cy - Math.cos(a) * r1, major ? 0.03 : 0.018) < 0) c = [196, 190, 230]
      }
    }
    // minute hand at 12; hour hand at 6 (clock-out time), or at 4 below 48px where a straight 6:00 line reads as "!"
    const ha = L.hourAngle * Math.PI / 180
    if (capsule(x, y, L.cx, L.cy, L.cx, L.cy - L.minute, L.mw) < 0) c = HAND
    if (capsule(x, y, L.cx, L.cy, L.cx + Math.sin(ha) * L.hour, L.cy - Math.cos(ha) * L.hour, L.hw) < 0) c = HAND
    if (L.hub > 0 && circle(x, y, L.cx, L.cy, L.hub) < 0) c = MOON
  }
  return [...c, 1]
}

// Supersampled pixels (SS×SS samples per pixel), returned as PNG scanlines with filter byte 0
function draw(size, tray) {
  const L = layout(size, tray); const SS = size <= 32 ? 8 : 4
  const rows = []
  for (let y = 0; y < size; y++) {
    const row = [0]   // filter type none
    for (let x = 0; x < size; x++) {
      let r = 0; let g = 0; let b = 0; let a = 0
      for (let j = 0; j < SS; j++) {
        for (let i = 0; i < SS; i++) {
          const s = sample((x + (i + 0.5) / SS) / size, (y + (j + 0.5) / SS) / size, L)
          r += s[0] * s[3]; g += s[1] * s[3]; b += s[2] * s[3]; a += s[3]
        }
      }
      row.push(...(a === 0 ? [0, 0, 0, 0] : [Math.round(r / a), Math.round(g / a), Math.round(b / a), Math.round(a / (SS * SS) * 255)]))
    }
    rows.push(Buffer.from(row))
  }
  return rows
}

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td))
  return Buffer.concat([len, td, c])
}
function png(SIZE, tray = false) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(draw(SIZE, tray)))), chunk('IEND', Buffer.alloc(0))])
}

// ICO with PNG-compressed entries (Windows Vista+ reads these at every size)
function ico(sizes) {
  const images = sizes.map(s => png(s))
  const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4)
  let offset = 6 + 16 * sizes.length
  const entries = sizes.map((s, i) => {
    const e = Buffer.alloc(16)
    e[0] = s >= 256 ? 0 : s; e[1] = s >= 256 ? 0 : s   // 0 means 256
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(images[i].length, 8); e.writeUInt32LE(offset, 12)
    offset += images[i].length
    return e
  })
  return Buffer.concat([header, ...entries, ...images])
}

const out = join(__dirname, '..', 'resources')
mkdirSync(out, { recursive: true })
writeFileSync(join(out, 'icon.png'), png(256))
writeFileSync(join(out, 'icon-256.png'), png(256))
writeFileSync(join(out, 'icon.ico'), ico([16, 24, 32, 48, 64, 128, 256]))
writeFileSync(join(out, 'tray.png'), png(16, true))
writeFileSync(join(out, 'tray@1.5x.png'), png(24, true))
writeFileSync(join(out, 'tray@2x.png'), png(32, true))
console.log('resources/icon.png, icon-256.png, icon.ico, tray.png (+@1.5x, @2x) written')
