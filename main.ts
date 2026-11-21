// news-image-20261120 — Friday 20 November 2026, one-page newspaper front page.
// Node 22 stdlib only. Self-contained: own PNG encoder, own TTF rasterizer,
// fonts loaded from the repo's fonts/ dir. Fully deterministic (seeded PRNG,
// no clock, no network). Writes /output/entry.png (or MAKEFUN_OUTPUT_DIR).
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const W = 1024;
const H = 1024;

// ---------- palette ----------
const CREAM: RGB = [246, 238, 222];
const INK: RGB = [26, 24, 22];
const RED: RGB = [178, 34, 28];
const RED_D: RGB = [140, 24, 20];
const NAVY: RGB = [24, 34, 68];
const NAVY2: RGB = [16, 24, 52];
const SKY: RGB = [168, 206, 232];
const GOLD: RGB = [214, 164, 48];
const WHITE: RGB = [255, 255, 255];
const GREY: RGB = [120, 118, 110];
const GREEN: RGB = [36, 110, 66];
const TAN: RGB = [214, 188, 148];
const SAND: RGB = [226, 205, 166];
const TEAL: RGB = [32, 120, 116];
const ORANGE: RGB = [214, 110, 40];
const PURPLE: RGB = [96, 62, 140];
const BLUE: RGB = [38, 84, 160];
const OLIVE: RGB = [96, 104, 52];

type RGB = [number, number, number];

// ---------- seeded PRNG (mulberry32) ----------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function (): number {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261120);

// ---------- CRC32 + PNG encoder ----------
const CRC_TABLE: number[] = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function encodePNG(w: number, h: number, rgb: Uint8Array): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
  }
  const comp = zlib.deflateSync(raw, { level: 9 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", comp),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- Canvas ----------
class Canvas {
  w: number; h: number; buf: Uint8Array;
  constructor(w: number, h: number, bg: RGB) {
    this.w = w; this.h = h;
    this.buf = new Uint8Array(w * h * 3);
    for (let i = 0; i < w * h; i++) {
      this.buf[i * 3] = bg[0]; this.buf[i * 3 + 1] = bg[1]; this.buf[i * 3 + 2] = bg[2];
    }
  }
  px(x: number, y: number, c: RGB): void {
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= this.w || yi >= this.h) return;
    const o = (yi * this.w + xi) * 3;
    this.buf[o] = c[0]; this.buf[o + 1] = c[1]; this.buf[o + 2] = c[2];
  }
  rect(x: number, y: number, w: number, h: number, c: RGB): void {
    const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.w, Math.round(x + w)), y1 = Math.min(this.h, Math.round(y + h));
    for (let yy = y0; yy < y1; yy++) {
      let o = (yy * this.w + x0) * 3;
      for (let xx = x0; xx < x1; xx++) {
        this.buf[o] = c[0]; this.buf[o + 1] = c[1]; this.buf[o + 2] = c[2]; o += 3;
      }
    }
  }
  strokeRect(x: number, y: number, w: number, h: number, c: RGB, t: number): void {
    this.rect(x, y, w, t, c); this.rect(x, y + h - t, w, t, c);
    this.rect(x, y, t, h, c); this.rect(x + w - t, y, t, h, c);
  }
  line(x0: number, y0: number, x1: number, y1: number, c: RGB, t: number): void {
    const dx = x1 - x0, dy = y1 - y0;
    const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);
    const r = Math.max(1, Math.floor(t / 2));
    for (let i = 0; i <= steps; i++) {
      const x = x0 + (dx * i) / steps, y = y0 + (dy * i) / steps;
      for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) this.px(x + a, y + b, c);
    }
  }
  circle(cx: number, cy: number, r: number, c: RGB): void {
    const rr = Math.round(r);
    for (let y = -rr; y <= rr; y++) for (let x = -rr; x <= rr; x++) {
      if (x * x + y * y <= rr * rr) this.px(cx + x, cy + y, c);
    }
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, c: RGB): void {
    for (let y = -Math.round(ry); y <= Math.round(ry); y++) {
      for (let x = -Math.round(rx); x <= Math.round(rx); x++) {
        if ((x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1) this.px(cx + x, cy + y, c);
      }
    }
  }
  ring(cx: number, cy: number, r: number, t: number, c: RGB): void {
    const rr = Math.round(r);
    for (let a = 0; a < 360; a += 1) {
      const rad = (a * Math.PI) / 180;
      for (let k = -Math.floor(t / 2); k <= Math.floor(t / 2); k++) {
        this.px(cx + (rr + k) * Math.cos(rad), cy + (rr + k) * Math.sin(rad), c);
      }
    }
  }
  poly(pts: number[][], c: RGB): void {
    if (pts.length < 3) return;
    let minY = Infinity, maxY = -Infinity;
    for (const p of pts) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
    for (let y = Math.ceil(minY); y <= Math.floor(maxY); y++) {
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
          xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let x = Math.ceil(xs[k]); x <= Math.floor(xs[k + 1]); x++) this.px(x, y, c);
      }
    }
  }
  // scanline fill of MULTIPLE polygons with the even-odd rule in one pass:
  // crossings from every contour are pooled per row, so holes (counters
  // in glyphs like "o", "e", "a") stay hollow instead of being painted over.
  fillEvenOdd(polys: number[][][], c: RGB): void {
    let minY = Infinity, maxY = -Infinity;
    for (const pts of polys) for (const p of pts) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
    for (let y = Math.ceil(minY); y <= Math.floor(maxY); y++) {
      const xs: number[] = [];
      for (const pts of polys) {
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i], b = pts[(i + 1) % pts.length];
          if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
            xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
          }
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let x = Math.ceil(xs[k]); x <= Math.floor(xs[k + 1]); x++) this.px(x, y, c);
      }
    }
  }
  // 5-pointed star, outer radius R, inner radius r
  star5(cx: number, cy: number, R: number, c: RGB): void {
    const pts: number[][] = [];
    for (let i = 0; i < 10; i++) {
      const ang = -Math.PI / 2 + (i * Math.PI) / 5;
      const rad = i % 2 === 0 ? R : R * 0.42;
      pts.push([cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)]);
    }
    this.poly(pts, c);
  }
  // deterministic paper grain: faint dark speckles, per-speckle random alpha
  grain(n: number, maxAlpha: number): void {
    for (let i = 0; i < n; i++) {
      const x = Math.floor(rnd() * this.w), y = Math.floor(rnd() * this.h);
      const a = 4 + Math.floor(rnd() * maxAlpha);
      const o = (y * this.w + x) * 3;
      for (let k = 0; k < 3; k++) this.buf[o + k] = Math.max(0, this.buf[o + k] - a);
    }
  }
  // fine full-page fibre noise on a 4px grid (deterministic, subtle)
  fibre(amp: number): void {
    for (let y = 0; y < this.h; y += 4) {
      for (let x = 0; x < this.w; x += 4) {
        const d = Math.floor((rnd() * 2 - 1) * amp);
        if (d === 0) continue;
        const o = (y * this.w + x) * 3;
        for (let k = 0; k < 3; k++) {
          const v = this.buf[o + k] + d;
          this.buf[o + k] = v < 0 ? 0 : v > 255 ? 255 : v;
        }
      }
    }
  }
  png(): Buffer { return encodePNG(this.w, this.h, this.buf); }
}

// ---------- TTF reader + glyph rasterizer ----------
interface Glyph { adv: number; pts: number[][][]; }
class TTF {
  units: number; cmap4: Map<number, number>; cmap12: Map<number, number>;
  glyfOff: number; loca: number[]; hmtxOff: number; numH: number; upm: number;
  kern: Map<string, number>; buf: Buffer;
  constructor(file: string) {
    this.buf = fs.readFileSync(file);
    const b = this.buf;
    const u16 = (o: number): number => b.readUInt16BE(o);
    const u32 = (o: number): number => b.readUInt32BE(o);
    const i16 = (o: number): number => b.readInt16BE(o);
    const nTab = u16(4);
    const tabs = new Map<string, number>();
    for (let i = 0; i < nTab; i++) {
      const o = 12 + i * 16;
      tabs.set(b.toString("ascii", o, o + 4), u32(o + 8));
    }
    const head = tabs.get("head")!; this.upm = u16(head + 18);
    const maxp = tabs.get("maxp")!;
    const numGlyphs = u16(maxp + 4);
    const hhea = tabs.get("hhea")!; this.numH = u16(hhea + 34);
    this.hmtxOff = tabs.get("hmtx")!;
    const locaOff = tabs.get("loca")!;
    const idxFmt = i16(head + 50);
    this.loca = [];
    if (idxFmt === 0) {
      for (let i = 0; i <= numGlyphs; i++) this.loca.push(u16(locaOff + i * 2) * 2);
    } else {
      for (let i = 0; i <= numGlyphs; i++) this.loca.push(u32(locaOff + i * 4));
    }
    this.glyfOff = tabs.get("glyf")!;
    // cmap: prefer format 12, else format 4
    this.cmap4 = new Map(); this.cmap12 = new Map();
    const cmap = tabs.get("cmap")!;
    const nSub = u16(cmap + 2);
    for (let i = 0; i < nSub; i++) {
      const so = cmap + 4 + i * 8;
      const fmt = u16(cmap + u32(so + 4));
      if (fmt === 12) {
        const nG = u32(cmap + u32(so + 4) + 12);
        for (let g = 0; g < nG; g++) {
          const go = cmap + u32(so + 4) + 16 + g * 12;
          const s = u32(go), e = u32(go + 4), gl = u32(go + 8);
          for (let cp = s; cp <= e; cp++) this.cmap12.set(cp, gl + (cp - s));
        }
      } else if (fmt === 4) {
        const fo = cmap + u32(so + 4);
        const seg = u16(fo + 6) / 2;
        const endOff = fo + 14, startOff = endOff + seg * 2 + 2, deltaOff = startOff + seg * 2, rangeOff = deltaOff + seg * 2;
        for (let s = 0; s < seg; s++) {
          const end = u16(endOff + s * 2), start = u16(startOff + s * 2);
          const delta = i16(deltaOff + s * 2), ro = u16(rangeOff + s * 2);
          for (let cp = start; cp <= end && cp !== 0xffff; cp++) {
            if (ro === 0) this.cmap4.set(cp, (cp + delta) & 0xffff);
            else {
              const gi = u16(rangeOff + s * 2 + ro + (cp - start) * 2);
              if (gi !== 0) this.cmap4.set(cp, (gi + delta) & 0xffff);
            }
          }
        }
      }
    }
    // kern table (format 0)
    this.kern = new Map();
    const kernOff = tabs.get("kern");
    if (kernOff !== undefined) {
      const nT = u16(kernOff + 2);
      let o = kernOff + 4;
      for (let t = 0; t < nT; t++) {
        const len = u16(o + 2), cov = u16(o + 4);
        if ((cov & 0xff) === 0) {
          const nP = u16(o + 6);
          for (let p = 0; p < nP; p++) {
            const po = o + 14 + p * 6;
            this.kern.set(u16(po) + ":" + u16(po + 2), i16(po + 4));
          }
        }
        o += len;
      }
    }
    this.units = this.upm;
  }
  glyphIndex(cp: number): number {
    return this.cmap12.get(cp) ?? this.cmap4.get(cp) ?? 0;
  }
  loadGlyph(gi: number): Glyph {
    const b = this.buf;
    const adv = gi < this.numH ? b.readUInt16BE(this.hmtxOff + gi * 4) : b.readUInt16BE(this.hmtxOff + (this.numH - 1) * 4);
    const g0 = this.glyfOff + this.loca[gi], g1 = this.glyfOff + this.loca[gi + 1];
    if (g1 <= g0) return { adv, pts: [] };
    const nC = b.readInt16BE(g0);
    if (nC < 0) {
      // composite: flatten components (no transforms beyond translate/scale)
      const contours: number[][][] = [];
      let o = g0 + 10;
      while (true) {
        const flags = b.readUInt16BE(o);
        const comp = b.readUInt16BE(o + 2);
        let arg1 = 0, arg2 = 0, p = o + 4;
        if (flags & 1) { arg1 = b.readInt16BE(p); arg2 = b.readInt16BE(p + 2); p += 4; }
        else { arg1 = b.readInt8(p); arg2 = b.readInt8(p + 1); p += 2; }
        let sx = 1, sy = 1;
        if (flags & 8) { sx = b.readInt16BE(p) / 16384; sy = sx; p += 2; }
        else if (flags & 0x40) { sx = b.readInt16BE(p) / 16384; sy = b.readInt16BE(p + 2) / 16384; p += 4; }
        else if (flags & 0x80) { sx = b.readInt16BE(p) / 16384; sy = b.readInt16BE(p + 6) / 16384; p += 8; }
        const sub = this.loadGlyph(comp);
        for (const c of sub.pts) {
          contours.push(c.map((pt) => [pt[0] * sx + arg1, pt[1] * sy + arg2, pt[2]]));
        }
        o = p;
        if (!(flags & 0x20)) break;
      }
      return { adv, pts: contours };
    }
    const endPts = g0 + 10;
    const nPts = b.readUInt16BE(endPts + (nC - 1) * 2) + 1;
    const instLen = b.readUInt16BE(endPts + nC * 2);
    let o = endPts + nC * 2 + 2 + instLen;
    const flags: number[] = [];
    while (flags.length < nPts) {
      const f = b[o++];
      flags.push(f);
      if (f & 8) { const r = b[o++]; for (let k = 0; k < r; k++) flags.push(f); }
    }
    const xs: number[] = [], ys: number[] = [];
    let x = 0;
    for (let i = 0; i < nPts; i++) {
      const f = flags[i];
      if (f & 2) { const d = b[o++]; x += f & 16 ? d : -d; } else if (!(f & 16)) { x += b.readInt16BE(o); o += 2; }
      xs.push(x);
    }
    let y = 0;
    for (let i = 0; i < nPts; i++) {
      const f = flags[i];
      if (f & 4) { const d = b[o++]; y += f & 32 ? d : -d; } else if (!(f & 32)) { y += b.readInt16BE(o); o += 2; }
      ys.push(y);
    }
    const contours: number[][][] = [];
    let start = 0;
    for (let c = 0; c < nC; c++) {
      const end = b.readUInt16BE(endPts + c * 2);
      const raw: number[][] = [];
      for (let i = start; i <= end; i++) raw.push([xs[i], -ys[i], flags[i] & 1]);
      // expand implied on-curve points between consecutive off-curve points
      const exp: number[][] = [];
      for (let i = 0; i < raw.length; i++) {
        const p = raw[i], q = raw[(i + 1) % raw.length];
        exp.push(p);
        if (p[2] === 0 && q[2] === 0) exp.push([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, 1]);
      }
      if (exp.length > 0 && exp[0][2] === 0) exp.unshift(exp[exp.length - 1]);
      contours.push(exp);
      start = end + 1;
    }
    return { adv, pts: contours };
  }
}

// rasterize one glyph outline into the canvas at pixel size `size`.
// Antialiased: the glyph is rendered at 2x into an offscreen buffer with a
// single even-odd fill across ALL contours (so counters in "o"/"e"/"a"
// stay hollow), then downsampled with a 2x2 box filter and blended by
// coverage. This keeps small text solid (no dropped sub-pixel strokes)
// and large text smooth. Fully deterministic.
function drawGlyph(cv: Canvas, font: TTF, cp: number, size: number, x0: number, yBase: number, color: RGB): number {
  const gi = font.glyphIndex(cp);
  const g = font.loadGlyph(gi);
  const scale = size / font.units;
  const adv = g.adv * scale;
  if (g.pts.length === 0) return adv;
  // flatten quadratic curves into line segments (final coords)
  const polys: number[][][] = [];
  for (const contour of g.pts) {
    const poly: number[][] = [];
    let i = 0;
    while (i < contour.length) {
      const p = contour[i];
      if (p[2] === 1) { poly.push([x0 + p[0] * scale, yBase + p[1] * scale]); i++; continue; }
      const prev = poly.length > 0 ? poly[poly.length - 1] : [x0 + contour[contour.length - 1][0] * scale, yBase + contour[contour.length - 1][1] * scale];
      const nxt = contour[(i + 1) % contour.length];
      for (let t = 1; t <= 8; t++) {
        const u = t / 8;
        const mx = (1 - u) * (1 - u) * prev[0] + 2 * (1 - u) * u * (x0 + p[0] * scale) + u * u * (x0 + nxt[0] * scale);
        const my = (1 - u) * (1 - u) * prev[1] + 2 * (1 - u) * u * (yBase + p[1] * scale) + u * u * (yBase + nxt[1] * scale);
        poly.push([mx, my]);
      }
      i++;
    }
    if (poly.length > 2) polys.push(poly);
  }
  if (polys.length === 0) return adv;
  // glyph bbox (final coords)
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const poly of polys) for (const [px, py] of poly) {
    minX = Math.min(minX, px); maxX = Math.max(maxX, px);
    minY = Math.min(minY, py); maxY = Math.max(maxY, py);
  }
  const SS = 2, pad = 1;
  const bx0 = Math.floor(minX) - pad, by0 = Math.floor(minY) - pad;
  const bx1 = Math.ceil(maxX) + pad, by1 = Math.ceil(maxY) + pad;
  const bw = bx1 - bx0, bh = by1 - by0;
  if (bw <= 0 || bh <= 0) return adv;
  // render at 2x into an offscreen buffer (black bg, white fill)
  const tmp = new Canvas(bw * SS, bh * SS, [0, 0, 0]);
  const sp = polys.map((poly) => poly.map(([px, py]) => [(px - bx0) * SS, (py - by0) * SS]));
  tmp.fillEvenOdd(sp, WHITE);
  // downsample 2x2 box filter -> coverage, blend onto the canvas
  for (let yy = 0; yy < bh; yy++) {
    for (let xx = 0; xx < bw; xx++) {
      let sum = 0;
      for (let sy = 0; sy < SS; sy++) {
        let ro = ((yy * SS + sy) * tmp.w + xx * SS) * 3;
        for (let sx = 0; sx < SS; sx++) { sum += tmp.buf[ro]; ro += 3; }
      }
      if (sum === 0) continue;
      const dx = bx0 + xx, dy = by0 + yy;
      if (dx < 0 || dy < 0 || dx >= cv.w || dy >= cv.h) continue;
      const a = sum / (SS * SS * 255);
      const o = (dy * cv.w + dx) * 3;
      if (a >= 0.999) {
        cv.buf[o] = color[0]; cv.buf[o + 1] = color[1]; cv.buf[o + 2] = color[2];
      } else {
        cv.buf[o] = Math.round(cv.buf[o] + (color[0] - cv.buf[o]) * a);
        cv.buf[o + 1] = Math.round(cv.buf[o + 1] + (color[1] - cv.buf[o + 1]) * a);
        cv.buf[o + 2] = Math.round(cv.buf[o + 2] + (color[2] - cv.buf[o + 2]) * a);
      }
    }
  }
  return adv;
}

const serifB = new TTF(path.join(HERE, "fonts", "DejaVuSerif-Bold.ttf"));
const serif = new TTF(path.join(HERE, "fonts", "DejaVuSerif.ttf"));
const sansB = new TTF(path.join(HERE, "fonts", "DejaVuSans-Bold.ttf"));
const sans = new TTF(path.join(HERE, "fonts", "DejaVuSans.ttf"));

// text helpers on Canvas
function textWidth(font: TTF, size: number, s: string): number {
  const scale = size / font.units;
  let w = 0, prev = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    const gi = font.glyphIndex(cp);
    const g = font.loadGlyph(gi);
    w += g.adv * scale;
    if (prev) w += (font.kern.get(prev + ":" + gi) ?? 0) * scale;
    prev = gi;
  }
  return w;
}
function drawText(cv: Canvas, font: TTF, size: number, x: number, yBase: number, s: string, color: RGB, align: "l" | "c" | "r" = "l", maxW?: number): number {
  let startX = x;
  const w = textWidth(font, size, s);
  if (align === "c") startX = x - w / 2;
  if (align === "r") startX = x - w;
  let cx = startX, prev = 0;
  const scale = size / font.units;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    const gi = font.glyphIndex(cp);
    if (prev) cx += (font.kern.get(prev + ":" + gi) ?? 0) * scale;
    cx += drawGlyph(cv, font, cp, size, cx, yBase, color);
    prev = gi;
  }
  return w;
}
function wrapText(font: TTF, size: number, s: string, maxW: number): string[] {
  const words = s.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const trial = cur ? cur + " " + w : w;
    if (textWidth(font, size, trial) <= maxW || !cur) cur = trial;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}
// draw wrapped text; returns total height used
function drawPara(cv: Canvas, font: TTF, size: number, x: number, yTop: number, s: string, color: RGB, maxW: number, lh: number, align: "l" | "c" = "l"): number {
  const lines = wrapText(font, size, s, maxW);
  lines.forEach((ln, i) => {
    const bx = align === "c" ? x + maxW / 2 : x;
    drawText(cv, font, size, bx, yTop + (i + 1) * lh - (lh - size) / 2, ln, color, align);
  });
  return lines.length * lh;
}

// ---------- scenes ----------
// Hero 1: Zelensky, big named figure, Kyiv night skyline + missile streaks
function heroKyiv(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.rect(x, y, w, h, NAVY2);
  for (let i = 0; i < 46; i++) {
    const sx = x + 6 + rnd() * (w - 12), sy = y + 4 + rnd() * (h * 0.5);
    cv.px(sx, sy, rnd() < 0.7 ? WHITE : GOLD);
    if (rnd() < 0.4) cv.px(sx + 1, sy, WHITE);
  }
  cv.rect(x, y + h * 0.55, w, h * 0.45, [58, 44, 96]); // purple horizon
  cv.circle(x + w * 0.82, y + 18, 11, [238, 224, 178]); // moon
  // skyline with lit windows
  const blds = [[0, 0.62, 0.14, 0.38], [0.13, 0.55, 0.11, 0.45], [0.23, 0.66, 0.13, 0.34], [0.68, 0.58, 0.12, 0.42], [0.79, 0.64, 0.10, 0.36], [0.88, 0.56, 0.12, 0.44]];
  for (const b of blds) {
    cv.rect(x + w * b[0], y + h * b[1], w * b[2], h * b[3], NAVY);
    for (let wy = 0; wy < 3; wy++) for (let wx = 0; wx < 2; wx++) {
      if (rnd() < 0.6) cv.rect(x + w * b[0] + 4 + wx * (w * b[2] - 8) / 2, y + h * b[1] + 5 + wy * 12, 3, 4, GOLD);
    }
  }
  // missile streaks (dashed gold lines + bursts)
  cv.line(x + w * 0.08, y + 10, x + w * 0.30, y + 46, GOLD, 2);
  cv.line(x + w * 0.55, y + 8, x + w * 0.72, y + 40, GOLD, 2);
  cv.star5(x + w * 0.30, y + 46, 7, GOLD); cv.star5(x + w * 0.72, y + 40, 6, GOLD);
  // Zelensky figure, centre-left — detailed bust portrait, face fully in frame
  const fx = x + w * 0.42, fy = y + 40; // face centre
  // neck
  cv.rect(fx - 8, fy + 24, 16, 12, [214, 168, 128]);
  // jacket: shoulders (bottom cropped by the banner below the scene, like a bust)
  cv.ellipse(fx, fy + 62, 56, 26, OLIVE);
  // lapels, darker olive
  cv.poly([[fx - 18, fy + 36], [fx - 2, fy + 48], [fx - 12, fy + 70], [fx - 24, fy + 46]], [76, 84, 42]);
  cv.poly([[fx + 18, fy + 36], [fx + 2, fy + 48], [fx + 12, fy + 70], [fx + 24, fy + 46]], [76, 84, 42]);
  // white shirt V + collar
  cv.poly([[fx - 12, fy + 34], [fx, fy + 50], [fx + 12, fy + 34], [fx + 6, fy + 32], [fx, fy + 40], [fx - 6, fy + 32]], [240, 236, 228]);
  // jacket pocket (left chest) + buttons
  cv.rect(fx - 44, fy + 56, 14, 8, [76, 84, 42]);
  cv.circle(fx, fy + 58, 1, [60, 66, 34]);
  cv.circle(fx, fy + 66, 1, [60, 66, 34]);
  // ears
  cv.ellipse(fx - 23, fy + 2, 4, 6, [232, 190, 150]);
  cv.ellipse(fx + 23, fy + 2, 4, 6, [232, 190, 150]);
  // face
  cv.ellipse(fx, fy, 23, 26, [232, 190, 150]);
  // hair: shaped cap with a side parting, fully inside the frame
  cv.poly([[fx - 24, fy - 18], [fx - 23, fy - 30], [fx - 12, fy - 36], [fx + 12, fy - 36], [fx + 23, fy - 30], [fx + 24, fy - 18], [fx + 16, fy - 26], [fx - 16, fy - 26]], [74, 58, 40]);
  cv.line(fx - 4, fy - 33, fx + 8, fy - 28, [52, 40, 28], 1); // parting
  // brows
  cv.line(fx - 14, fy - 8, fx - 5, fy - 9, [60, 48, 36], 2);
  cv.line(fx + 5, fy - 9, fx + 14, fy - 8, [60, 48, 36], 2);
  // eyes: white + pupil
  cv.ellipse(fx - 10, fy - 1, 3.5, 2.5, WHITE); cv.circle(fx - 10, fy - 1, 1, INK);
  cv.ellipse(fx + 10, fy - 1, 3.5, 2.5, WHITE); cv.circle(fx + 10, fy - 1, 1, INK);
  // nose wedge
  cv.poly([[fx - 1, fy + 2], [fx + 1, fy + 2], [fx + 2, fy + 11], [fx - 2, fy + 11]], [190, 150, 118]);
  // mouth: serious, slight curve
  cv.line(fx - 7, fy + 17, fx - 3, fy + 18, [140, 96, 70], 2);
  cv.line(fx - 3, fy + 18, fx + 3, fy + 18, [140, 96, 70], 2);
  cv.line(fx + 3, fy + 18, fx + 7, fy + 17, [140, 96, 70], 2);
  // chin shadow
  cv.line(fx - 4, fy + 22, fx + 4, fy + 22, [200, 160, 125], 1);
  // mic in front of his chest
  cv.line(fx + 40, fy + 72, fx + 33, fy + 44, [30, 30, 30], 3);
  cv.circle(fx + 32, fy + 38, 7, [40, 40, 40]);
  cv.circle(fx + 32, fy + 38, 4, [96, 96, 96]);
  // labels
  cv.rect(x + 8, y + 8, 52, 18, RED); drawText(cv, sansB, 11, x + 34, y + 21, "KYIV", WHITE, "c");
  cv.rect(x + 8, y + h - 24, 108, 16, WHITE); drawText(cv, sansB, 9, x + 62, y + h - 12, "3 BRIDGES HIT", INK, "c");
  cv.rect(x + w - 126, y + h - 24, 118, 16, NAVY); drawText(cv, sansB, 8, x + w - 67, y + h - 12, "OFFICIALS' COUNT", WHITE, "c");
}
// Hero 2: Cyclone Akvan landfall, Odisha coast
function heroCyclone(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.rect(x, y, w, h, [96, 160, 200]);
  cv.poly([[x, y], [x + w * 0.42, y], [x + w * 0.30, y + h * 0.45], [x + w * 0.38, y + h], [x, y + h]], TAN); // land
  cv.poly([[x + w * 0.42, y], [x + w * 0.46, y + h * 0.22], [x + w * 0.30, y + h * 0.45], [x + w * 0.38, y + h], [x + w * 0.42, y]], [190, 168, 128]);
  // cyclone spiral: concentric broken rings
  const cx = x + w * 0.62, cy = y + h * 0.52;
  for (let r = 12; r <= 40; r += 9) {
    for (let a = 0; a < 300; a += 6) {
      const rad = ((a + r * 3) * Math.PI) / 180;
      cv.px(cx + r * Math.cos(rad), cy + r * Math.sin(rad) * 0.9, WHITE);
      cv.px(cx + (r + 1) * Math.cos(rad), cy + (r + 1) * Math.sin(rad) * 0.9, WHITE);
    }
  }
  cv.circle(cx, cy, 5, RED);
  // dashed track to Gopalpur
  const gx = x + w * 0.33, gy = y + h * 0.40;
  for (let t = 0; t <= 10; t += 2) {
    cv.line(cx - ((cx - gx) * t) / 10, cy - ((cy - gy) * t) / 10, cx - ((cx - gx) * (t + 1)) / 10, cy - ((cy - gy) * (t + 1)) / 10, RED, 2);
  }
  cv.circle(gx, gy, 5, RED); cv.circle(gx, gy, 2, WHITE);
  drawText(cv, sansB, 9, gx - 14, gy + 3, "GOPALPUR", INK, "r");
  // rain slashes on the sea (kept clear of the CYCLONE AKVAN banner above and the BAY OF BENGAL label below)
  for (let i = 0; i < 14; i++) {
    const rx = x + w * (0.55 + rnd() * 0.4), ry = y + h * (0.25 + rnd() * 0.4);
    cv.line(rx, ry, rx - 3, ry + 7, WHITE, 1);
  }
  cv.rect(x + w * 0.42, y + 8, 138, 18, RED); drawText(cv, sansB, 11, x + w * 0.42 + 69, y + 21, "CYCLONE AKVAN", WHITE, "c");
  cv.rect(x + 8, y + h - 24, 118, 16, WHITE); drawText(cv, sansB, 9, x + 67, y + h - 12, "LANDFALL · 8 AM", INK, "c");
  drawText(cv, sansB, 8, x + w - 8, y + h - 12, "BAY OF BENGAL", WHITE, "r");
}
// Hero 3: AI sell-off chart + closing table
function heroSelloff(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.rect(x, y, w, h, NAVY);
  for (let i = 1; i < 4; i++) cv.line(x + 8, y + (h * i) / 4, x + w * 0.58, y + (h * i) / 4, [52, 64, 104], 1);
  const pts = [[0.02, 0.18], [0.12, 0.30], [0.22, 0.26], [0.32, 0.44], [0.42, 0.52], [0.52, 0.72], [0.58, 0.78]];
  for (let i = 0; i + 1 < pts.length; i++) {
    cv.line(x + w * pts[i][0], y + h * pts[i][1], x + w * pts[i + 1][0], y + h * pts[i + 1][1], RED, 3);
  }
  for (const p of pts) cv.circle(x + w * p[0], y + h * p[1], 3, WHITE);
  // closing table, right side
  const rows: [string, string][] = [["Taipei", "−6.2%"], ["Seoul", "−5.2%"], ["Tokyo", "−5.1%"], ["Hong Kong", "−1.9%"]];
  rows.forEach((r, i) => {
    const ry = y + 34 + i * 18;
    drawText(cv, sans, 10, x + w * 0.62, ry + 8, r[0], WHITE);
    drawText(cv, sansB, 10, x + w - 10, ry + 8, r[1], [255, 120, 110], "r");
  });
  cv.rect(x + 8, y + 8, 96, 18, RED); drawText(cv, sansB, 11, x + 56, y + 21, "AI SELL-OFF", WHITE, "c");
  cv.rect(x + 8, y + h - 24, 128, 16, WHITE); drawText(cv, sansB, 9, x + 72, y + h - 12, "ASIA, FRIDAY'S CLOSE", INK, "c");
  drawText(cv, sans, 8, x + w - 10, y + 20, "Closing prices", [180, 190, 220], "r");
}

// ---------- mid scenes (w ~190, h ~48) ----------
function midFlags(cv: Canvas, x: number, y: number, w: number, h: number): void {
  // UK + EU flags side by side
  cv.rect(x, y, w / 2, h, BLUE);
  for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4; cv.circle(x + w * 0.25 + 12 * Math.cos(a), y + h / 2 + 9 * Math.sin(a), 2, GOLD); }
  cv.rect(x + w / 2, y, w / 2, h, [32, 48, 96]);
  cv.line(x + w / 2, y, x + w, y + h, WHITE, 4); cv.line(x + w, y, x + w / 2, y + h, WHITE, 4);
  cv.line(x + w / 2, y, x + w, y + h, RED, 2); cv.line(x + w, y, x + w / 2, y + h, RED, 2);
  cv.line(x + w * 0.75, y, x + w * 0.75, y + h, WHITE, 5); cv.line(x + w / 2, y + h / 2, x + w, y + h / 2, WHITE, 5);
  cv.line(x + w * 0.75, y, x + w * 0.75, y + h, RED, 2); cv.line(x + w / 2, y + h / 2, x + w, y + h / 2, RED, 2);
  cv.rect(x + 6, y + h - 16, 62, 13, WHITE); drawText(cv, sansB, 8, x + 37, y + h - 6, "AGREED", INK, "c");
}
function midCop(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.rect(x, y, w, h, [206, 232, 222]);
  cv.circle(x + 34, y + 24, 17, [58, 130, 190]);
  cv.ellipse(x + 28, y + 20, 6, 4, GREEN); cv.ellipse(x + 40, y + 28, 5, 3, GREEN); cv.ellipse(x + 32, y + 32, 4, 3, GREEN);
  // thermometer
  cv.rect(x + 74, y + 6, 7, 26, WHITE); cv.rect(x + 74, y + 18, 7, 14, RED); cv.circle(x + 77, y + 34, 7, RED);
  // clock
  cv.circle(x + 118, y + 22, 15, WHITE); cv.strokeRect(x + 103, y + 7, 30, 30, INK, 1);
  cv.line(x + 118, y + 22, x + 118, y + 10, INK, 2); cv.line(x + 118, y + 22, x + 128, y + 24, INK, 2);
  cv.rect(x + w - 58, y + 6, 52, 15, RED); drawText(cv, sansB, 9, x + w - 32, y + 17, "NO DEAL", WHITE, "c");
  drawText(cv, sansB, 8, x + w - 6, y + h - 6, "DRAFT 3", RED, "r");
}
function midPoland(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.rect(x, y, w, h, [140, 180, 110]);
  cv.rect(x, y + h - 12, w, 12, [90, 130, 70]);
  for (let i = 0; i < 3; i++) {
    const tx = x + 150 + i * 14;
    cv.poly([[tx, y + 8], [tx - 6, y + 26], [tx + 6, y + 26]], [30, 90, 50]);
    cv.rect(tx - 1, y + 26, 2, 8, [80, 60, 40]);
  }
  // Kh-101 cruise missile, diagonal
  cv.ellipse(x + 62, y + 24, 34, 6, [200, 200, 200]);
  cv.poly([[x + 92, y + 20], [x + 104, y + 24], [x + 92, y + 28]], [160, 160, 160]);
  cv.poly([[x + 34, y + 18], [x + 30, y + 10], [x + 40, y + 19]], [160, 160, 160]);
  cv.rect(x + 8, y + 6, 52, 14, WHITE); drawText(cv, sansB, 9, x + 34, y + 16, "KH-101", INK, "c");
  for (let i = 0; i < 5; i++) cv.line(x + 128, y + 4 + i * 8, x + 128, y + 10 + i * 8, RED, 2);
}
function midIraq(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.rect(x, y, w, h, [224, 200, 150]);
  cv.circle(x + w - 26, y + 14, 11, [240, 200, 90]);
  cv.rect(x, y + h - 10, w, 10, [190, 160, 110]);
  // two tanks
  for (const tx of [20, 78]) {
    cv.rect(x + tx, y + 26, 44, 10, [50, 70, 46]); cv.rect(x + tx + 12, y + 18, 20, 9, [50, 70, 46]);
    cv.line(x + tx + 30, y + 21, x + tx + 48, y + 18, [40, 56, 38], 3);
    cv.circle(x + tx + 8, y + 38, 4, INK); cv.circle(x + tx + 22, y + 38, 4, INK); cv.circle(x + tx + 36, y + 38, 4, INK);
  }
  // palm
  cv.line(x + 150, y + 40, x + 152, y + 14, [110, 80, 40], 3);
  for (let i = 0; i < 5; i++) { const a = -0.4 - i * 0.5; cv.line(x + 152, y + 14, x + 152 + 14 * Math.cos(a), y + 14 + 8 * Math.sin(a) - 4, GREEN, 2); }
  drawText(cv, sansB, 8, x + 6, y + 12, "JURF AL-SAKHAR", INK);
}
function midItaly(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.rect(x, y, w, h, CREAM);
  // crowd heads + placards
  for (let i = 0; i < 6; i++) {
    const hx = x + 16 + i * 30;
    cv.circle(hx, y + 30, 7, [232, 190, 150]);
    cv.rect(hx - 9, y + 37, 18, 11, [90 + (i % 3) * 40, 80, 120]);
    cv.line(hx + 12, y + 12, hx + 12, y + 30, [120, 100, 70], 2);
    cv.rect(hx + 2, y + 6, 22, 10, i % 2 ? RED : WHITE);
  }
  cv.rect(x + w - 74, y + 4, 68, 14, RED); drawText(cv, sansB, 9, x + w - 40, y + 14, "SCIOPERO", WHITE, "c");
}
function midJapan(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.rect(x, y, w, h, WHITE);
  const bars = [10, 16, 22, 30];
  bars.forEach((bh, i) => cv.rect(x + 12 + i * 16, y + h - 8 - bh, 11, bh, RED));
  cv.line(x + 8, y + 8, x + 76, y + h - 30, RED, 2);
  drawText(cv, sansB, 20, x + 92, y + 34, "2.3%", INK);
  drawText(cv, sansB, 8, x + 92, y + 46, "OCT CPI", INK);
  cv.circle(x + w - 18, y + 14, 10, RED); drawText(cv, sansB, 11, x + w - 18, y + 18, "¥", WHITE, "c");
}
function midKorea(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.rect(x, y, w, h, [228, 228, 222]);
  cv.poly([[x + 30, y + 8], [x + 90, y + 8], [x + 60, y + 20]], [200, 196, 186]);
  for (let i = 0; i < 4; i++) cv.rect(x + 34 + i * 16, y + 20, 5, 20, [180, 176, 166]);
  cv.rect(x + 28, y + 40, 64, 4, [160, 156, 146]);
  // gavel
  cv.line(x + 128, y + 34, x + 158, y + 14, [120, 84, 48], 4);
  cv.rect(x + 138, y + 8, 26, 10, [120, 84, 48]);
  cv.rect(x + w - 62, y + 4, 56, 14, RED); drawText(cv, sansB, 9, x + w - 34, y + 14, "IMPEACH", WHITE, "c");
}
function midKenya(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.rect(x, y, w, h, [240, 170, 70]);
  cv.circle(x + w - 30, y + 13, 10, [250, 220, 130]);
  cv.rect(x, y + h - 8, w, 8, [120, 70, 30]);
  // oil derrick silhouette
  cv.line(x + 40, y + h - 8, x + 58, y + 6, INK, 3);
  cv.line(x + 76, y + h - 8, x + 58, y + 6, INK, 3);
  cv.line(x + 46, y + 26, x + 70, y + 26, INK, 2);
  cv.line(x + 50, y + 16, x + 66, y + 16, INK, 2);
  cv.line(x + 58, y + 6, x + 82, y + 10, INK, 2);
  drawText(cv, sansB, 10, x + 100, y + 30, "TURKANA", INK);
  drawText(cv, sans, 8, x + 100, y + h - 10, "FIRST OIL", [90, 50, 20]);
}
function midBukele(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.rect(x, y, w, h, [36, 84, 160]);
  cv.rect(x + 24, y + 8, 52, 26, WHITE); cv.rect(x + 40, y + 8, 20, 4, INK);
  cv.poly([[x + 52, y + 2], [x + 62, y + 12], [x + 44, y + 12]], WHITE);
  drawText(cv, sansB, 9, x + 24, y + h - 6, "EL SALVADOR", WHITE);
  cv.rect(x + w - 78, y + 6, 72, 15, RED); drawText(cv, sansB, 9, x + w - 42, y + 17, "3RD TERM", WHITE, "c");
  cv.rect(x + w - 96, y + 26, 90, 13, WHITE); drawText(cv, sansB, 8, x + w - 51, y + 35, "VOTE 28 FEB 2027", INK, "c");
}
function midCricket(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.rect(x, y, w, h, [70, 150, 70]);
  cv.rect(x, y + 18, w, 12, [200, 180, 130]);
  for (let i = 0; i < 3; i++) cv.rect(x + 20 + i * 5, y + 8, 3, 10, GOLD);
  cv.line(x + 120, y + 8, x + 150, y + 40, [210, 180, 130], 5);
  cv.circle(x + 158, y + 42, 4, RED);
  drawText(cv, sansB, 22, x + 60, y + 42, "118", WHITE);
  drawText(cv, sansB, 8, x + 8, y + h - 6, "PHILLIPS", WHITE);
}

// ---------- world map ----------
const CONTINENTS: number[][][][] = [
  [[-168, 66], [-140, 70], [-120, 72], [-95, 80], [-80, 73], [-60, 62], [-55, 47], [-70, 42], [-75, 35], [-80, 26], [-85, 30], [-97, 26], [-105, 20], [-110, 24], [-120, 34], [-125, 49], [-150, 60], [-168, 66]],
  [[-80, 10], [-60, 8], [-50, 0], [-35, -8], [-40, -22], [-48, -28], [-58, -38], [-65, -45], [-70, -52], [-73, -40], [-70, -20], [-80, -5], [-80, 10]],
  [[-10, 36], [-9, 43], [-2, 48], [0, 51], [5, 53], [8, 57], [10, 59], [18, 56], [21, 55], [24, 60], [30, 70], [40, 68], [45, 60], [40, 52], [30, 46], [28, 42], [23, 40], [19, 42], [12, 44], [8, 44], [3, 43], [-2, 37], [-10, 36]],
  [[-17, 15], [-10, 30], [0, 36], [10, 37], [20, 32], [30, 31], [35, 28], [43, 12], [51, 11], [48, 2], [40, -10], [35, -20], [30, -30], [20, -35], [15, -27], [12, -18], [9, 4], [-8, 5], [-17, 15]],
  [[40, 68], [60, 70], [80, 73], [100, 77], [120, 73], [140, 72], [160, 70], [178, 66], [170, 60], [160, 55], [145, 45], [140, 40], [130, 35], [122, 30], [115, 22], [108, 10], [105, 5], [100, 8], [95, 15], [90, 22], [80, 15], [77, 8], [72, 20], [60, 25], [55, 27], [50, 30], [45, 30], [40, 36], [35, 36], [30, 36], [40, 45], [45, 55], [40, 68]],
  [[113, -22], [114, -30], [115, -35], [125, -33], [132, -32], [137, -35], [140, -38], [145, -38], [150, -37], [153, -32], [150, -22], [146, -19], [142, -11], [136, -12], [132, -11], [126, -14], [122, -17], [114, -21], [113, -22]],
  [[130, 31], [132, 33], [134, 34], [136, 35], [139, 37], [141, 40], [141, 44], [143, 44], [141, 41], [139, 38], [136, 36], [133, 34], [130, 31]],
  [[167, -45], [170, -42], [173, -40], [175, -38], [177, -38], [174, -41], [172, -43], [168, -46], [167, -45]],
];
const PINS: [number, number, number][] = [
  [1, 30.5, 50.5], [2, 84.9, 19.3], [3, 121.5, 25.0], [4, 4.4, 50.8], [5, 30.7, 36.9],
  [6, 23.0, 52.0], [7, 44.2, 32.9], [8, 12.5, 41.9], [9, 139.7, 35.7], [10, 127.0, 37.5],
  [11, 36.0, 3.5], [12, -89.2, 13.7], [13, 174.8, -41.3],
];
function drawMap(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.rect(x, y, w, h, [198, 224, 234]);
  const proj = (lon: number, lat: number): [number, number] => [
    x + ((lon + 180) / 360) * w,
    y + ((75 - lat) / 135) * h,
  ];
  for (const cont of CONTINENTS) {
    cv.poly(cont.map((p) => proj(p[0], p[1])), TAN);
  }
  for (const [n, lon, lat] of PINS) {
    const [px, py] = proj(lon, lat);
    cv.circle(px, py, 8, RED);
    cv.circle(px, py, 7, WHITE);
    cv.circle(px, py, 6, RED);
    drawText(cv, sansB, 7, px, py + 2.5, String(n), WHITE, "c");
  }
}

// ---------- story data ----------
interface Hero { scene: (cv: Canvas, x: number, y: number, w: number, h: number) => void; banner: string; kicker: string; head: string; deck: string; }
const HEROES: Hero[] = [
  { scene: heroKyiv, banner: "KYIV: ZELENSKY WARNS", kicker: "1  KYIV, UKRAINE · WAR",
    head: "Zelensky: missile barrage hits three Kyiv bridges",
    deck: "110 missiles and 400 drones fired overnight; nine killed, power and water cut in Kyiv. (Kyiv Independent, BBC)" },
  { scene: heroCyclone, banner: "ODISHA: CYCLONE AKVAN", kicker: "2  ODISHA, INDIA · CYCLONE",
    head: "Cyclone Akvan comes ashore in eastern India",
    deck: "Came ashore near Gopalpur from 8 am, after 300,000+ moved to shelters. No deaths reported. (IMD, Deccan Herald)" },
  { scene: heroSelloff, banner: "ASIA: AI SELL-OFF", kicker: "3  TAIPEI · SEOUL · TOKYO · MARKETS",
    head: "AI sell-off sinks Asia's stock markets",
    deck: "Taiwan fell 6.2% in its worst week since 1991; Seoul −5.2%, Tokyo −5.1% as chipmakers slid. (Al Jazeera, Anadolu)" },
];
interface Mid { scene: (cv: Canvas, x: number, y: number, w: number, h: number) => void; kicker: string; head: string; deck: string; }
const MIDS: Mid[] = [
  { scene: midFlags, kicker: "4  BRUSSELS · DIPLOMACY", head: "UK and EU seal a “reset” deal", deck: "Food trade, youth visas, carbon link. (Reuters)" },
  { scene: midCop, kicker: "5  ANTALYA · CLIMATE", head: "COP31 reaches its last day with no deal", deck: "The draft text leaves out fossil fuels. (UN News)" },
  { scene: midPoland, kicker: "6  EASTERN POLAND · SECURITY", head: "Russian missile lands in Poland", deck: "A Kh-101 fell in a field; two airports paused. (Reuters)" },
  { scene: midIraq, kicker: "7  CENTRAL IRAQ · SECURITY", head: "Iraqi army enters a militia stronghold", deck: "Troops deploy to Jurf al-Sakhar. (Reuters)" },
  { scene: midItaly, kicker: "8  ITALY · LABOUR", head: "General strike over Italy's budget", deck: "Workers and students march. (Reuters)" },
  { scene: midJapan, kicker: "9  TOKYO · ECONOMY", head: "Japan's inflation picks up to 2.3%", deck: "A December rate rise stays in view. (Reuters)" },
  { scene: midKorea, kicker: "10  SEOUL · POLITICS", head: "Korea's ruling party to impeach top judge", deck: "It follows an overturned conviction. (Korea Herald)" },
  { scene: midKenya, kicker: "11  TURKANA, KENYA · ENERGY", head: "Kenya starts drilling its first oil well", deck: "First crude is due on 1 December. (allAfrica)" },
  { scene: midBukele, kicker: "12  SAN SALVADOR · POLITICS", head: "Bukele files to run for a third term", deck: "The vote is on 28 February 2027. (AP)" },
  { scene: midCricket, kicker: "13  WELLINGTON · CRICKET", head: "Phillips hits 118 against India", deck: "Hundreds v India in all three formats. (ICC)" },
];
const ALSO: string[] = [
  "Lviv: A strike on a railway station kills two (BBC)",
  "Moscow: Russia declares Estonia's border closure (Reuters)",
  "Berlin: Pupils strike against military service (Al Jazeera)",
  "London: General says UK runs cyber attacks abroad (Sky News)",
  "Beijing: China holds its loan rates for an 18th month (Xinhua)",
  "Tokyo: SoftBank shares fall more than 14% in a day (Al Jazeera)",
  "Seoul: Kospi index ends the week 7.9% lower (Anadolu)",
  "Ganjam: 209 mm of rain falls as Akvan crosses Odisha (PTI)",
  "Lebanon: Israeli air strikes hit the south and east (Anadolu)",
  "Yemen: Gunmen fire on a cargo ship off the coast (UKMTO)",
  "Abuja: Court bars new evidence against Tinubu (Channels TV)",
  "Kampala: Police told to enforce Ebola ban on rallies (allAfrica)",
  "Malawi: Fuel crisis brings night-long petrol queues (Al Jazeera)",
  "Africa: AfDB says 22 countries are in debt distress (allAfrica)",
  "Las Vegas: Russell fastest in wet Grand Prix practice (Autosport)",
  "New York: Nasdaq futures fall 1.6% before the bell (24/7 Wall St)",
  "Washington: Democrats query law firm's free work (Al Jazeera)",
  "Wellington: Nicholls makes 175 in a stand of 216 (ICC)",
  "Sydney: Australian shares fall 1.8% in the sell-off (Reuters)",
  "Antalya: Panama asks COP31 to cap world oil output (Anadolu)",
  "Antalya: EU official calls the climate draft unacceptable (RTE)",
  "Turin: ATP backs a plan to lift player pay past $350m (Anadolu)",
];
const DATE_CHECK = "Left out as Thursday 19 November's news: the World Court's ruling on Myanmar · the three-leader declaration in Shenzhen · Anthropic's $83 debut · GTA VI's launch · Tonga's drought emergency · the migrant boat lost off Senegal. Older still: Voyager 1's light-day (18 Nov) · the $190.4m Van Gogh sale (Wed 18 Nov) · the Senate's Iran vote (Thu 19 Nov). Not yet happened, so not shown: BepiColombo entering Mercury orbit · any final COP31 text.";

// ---------- layout ----------
function main(): void {
  const cv = new Canvas(W, H, CREAM);
  const M = 12, CW = W - 2 * M; // content width 1000

  // kicker row
  drawText(cv, sansB, 11, M, 19, "THE WORLD IN ONE DAY", RED);
  drawText(cv, sansB, 10, W - M, 19, "35 STORIES · 7 REGIONS · EVERY ONE DATED FRIDAY 20 NOVEMBER 2026", INK, "r");
  cv.rect(M, 25, CW, 2, INK);

  // giant headline + sub-headline
  drawText(cv, serifB, 50, M + CW / 2, 70, "Friday 20 November 2026", INK, "c");
  drawText(cv, serif, 13, M + CW / 2, 90, "Russian missiles hit Kyiv's bridges · Cyclone Akvan strikes India · An AI sell-off sinks Asia's markets · UK and EU seal a deal", INK, "c");
  cv.rect(M, 97, CW, 1, GREY);

  // stat strip: 6 big numbers
  const stats: [string, string][] = [
    ["3", "bridges hit"],
    ["300,000+", "moved to shelters"],
    ["−6.2%", "Taiwan index Friday"],
    ["100,000", "youth visas a year"],
    ["2.3%", "Japan CPI in Oct"],
    ["118", "Phillips v India"],
  ];
  const sw = CW / 6;
  stats.forEach((s, i) => {
    const x = M + i * sw;
    drawText(cv, serifB, 24, x + 6, 126, s[0], RED);
    drawText(cv, sans, 8, x + 6, 137, s[1], INK);
    if (i > 0) cv.rect(x, 104, 1, 32, GREY);
  });

  // region strip
  const regions: [string, number, RGB][] = [
    ["EUROPE 8", 8, BLUE], ["ASIA 8", 8, RED], ["MIDDLE EAST 3", 3, ORANGE],
    ["AFRICA 5", 5, GREEN], ["AMERICAS 4", 4, PURPLE], ["OCEANIA 3", 3, TEAL], ["GLOBAL 4", 4, GREY],
  ];
  let rx = M;
  for (const [label, n, col] of regions) {
    const rw = (n / 35) * CW;
    cv.rect(rx, 144, rw, 15, col);
    drawText(cv, sansB, 9, rx + rw / 2, 155, label, WHITE, "c");
    rx += rw;
  }

  // heroes
  const hw = 326, hgap = 11;
  HEROES.forEach((hero, i) => {
    const x = M + i * (hw + hgap);
    hero.scene(cv, x, 164, hw, 112);
    cv.rect(x, 276, hw, 19, RED);
    drawText(cv, sansB, 11, x + 8, 289, hero.banner, WHITE);
    drawText(cv, sansB, 9, x, 304, hero.kicker, RED);
    const headLines = wrapText(serifB, 13, hero.head, hw);
    drawPara(cv, serifB, 13, x, 308, hero.head, INK, hw, 15);
    const deckY = 308 + headLines.length * 15 + 4;
    drawPara(cv, sans, 9.5, x, deckY, hero.deck, INK, hw, 11.5);
  });

  // mids: 2 rows x 5
  const mw = 192, mgap = 10;
  MIDS.forEach((mid, i) => {
    const row = Math.floor(i / 5), col = i % 5;
    const x = M + col * (mw + mgap);
    const y = 380 + row * 134;
    mid.scene(cv, x, y, mw, 52);
    cv.rect(x, y + 52, mw, 2, INK);
    drawText(cv, sansB, 8, x, y + 64, mid.kicker, RED);
    const headLines = wrapText(serifB, 11.5, mid.head, mw);
    drawPara(cv, serifB, 11.5, x, y + 68, mid.head, INK, mw, 13.5);
    const deckY = y + 68 + headLines.length * 13.5 + 3;
    drawPara(cv, sans, 8.5, x, deckY, mid.deck, INK, mw, 10.5);
  });

  // map + also-on
  drawText(cv, sansB, 12, M, 656, "WHERE IT HAPPENED", INK);
  drawMap(cv, M, 662, 340, 202);
  drawText(cv, sansB, 11, 364, 656, "ALSO ON FRIDAY 20 NOVEMBER 2026 — 22 MORE STORIES", RED);
  const colW = 318;
  for (let c = 0; c < 2; c++) {
    let ay = 664;
    const items = ALSO.slice(c * 11, c * 11 + 11);
    items.forEach((item, k) => {
      const n = String(14 + c * 11 + k);
      const lines = wrapText(sans, 9, n + " " + item, colW);
      lines.forEach((ln, li) => {
        if (li === 0) {
          const numW = textWidth(sansB, 9, n + " ");
          drawText(cv, sansB, 9, 364 + c * 328, ay + 9, n, RED);
          drawText(cv, sans, 9, 364 + c * 328 + numW, ay + 9, ln.slice(n.length + 1), INK);
        } else {
          drawText(cv, sans, 9, 364 + c * 328, ay + 9, ln, INK);
        }
        ay += 10.5;
      });
      ay += 3.5;
    });
  }
  drawText(cv, sans, 8, M, 876, "Each number is the story with that number on this page.", GREY);

  // date check
  cv.strokeRect(M, 884, CW, 84, RED, 2);
  drawText(cv, sansB, 11, M + 10, 902, "DATE CHECK", RED);
  drawPara(cv, sans, 9.5, M + 10, 906, DATE_CHECK, INK, CW - 20, 13);

  // footer
  drawText(cv, sans, 9, M + CW / 2, 984, "Every story here happened, or was first reported, on Friday 20 November 2026. Sources named beside each story · Original drawings", GREY, "c");

  cv.grain(42000, 10);
  cv.fibre(1);
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "out";
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "entry.png");
  fs.writeFileSync(outPath, cv.png());
  console.log(`wrote ${outPath} (${fs.statSync(outPath).size} bytes)`);
}

main();
