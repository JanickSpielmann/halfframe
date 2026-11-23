'use strict';

/* halfframe.spielmann.it
   Teilt Half Frame Scans in zwei Einzelbilder. Alles passiert im Browser:
   Die Scans werden gelesen, geschnitten und als ZIP gespeichert, ohne dass etwas hochgeladen wird. */

const $ = (s, r = document) => r.querySelector(s);
const IMG_EXT = /\.(jpe?g|png|webp|avif|gif|bmp|tiff?|heic|heif)$/i;
const PV_MAX = 1000;                 // Vorschau auf dem Kontaktbogen
const BIG_MAX = 2200;                // Vorschau in der Lupe
const ZIP_PART = 450 * 1024 * 1024;  // grössere Mengen werden auf mehrere ZIP verteilt
const POS_MIN = 0.05, POS_MAX = 0.95;
const LINE = '#ff5236';
const STORE = 'halfframe.settings';

const S = { gap: 1, edge: 0, rot: 0, swap: false, fmt: 'jpeg', q: 0.95 };
const items = [];
let nextId = 1;
let folderName = '';
let work = Promise.resolve();
let exporting = false;
let onlyCheck = false;
let loupe = null;
let view = 'scan';   // 'scan': Scan mit Linie, 'split': die beiden fertigen Bilder
const VIEW_STORE = 'halfframe.view';

const ROT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.4 5.7"/><path d="M20 4v7h-7"/></svg>';
const ZOOM_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2M11 8.5v5M8.5 11h5"/></svg>';

const el = {
  intro: $('#intro'), sheet: $('#sheet'), grid: $('#grid'),
  pickDir: $('#pickDir'), pickFiles: $('#pickFiles'), demo: $('#demo'),
  inDir: $('#inDir'), inFiles: $('#inFiles'),
  sumCount: $('#sumCount'), sumCheck: $('#sumCheck'), addMore: $('#addMore'), reset: $('#reset'),
  settings: $('#settings'),
  gap: $('#sGap'), gapOut: $('#sGapOut'), edge: $('#sEdge'), edgeOut: $('#sEdgeOut'),
  rot: $('#sRot'), swap: $('#sSwap'), fmt: $('#sFmt'), q: $('#sQ'), qOut: $('#sQOut'), qField: $('#sQField'),
  redetect: $('#redetect'),
  dock: $('#dock'), dockText: $('#dockText'), meter: $('#meter'), zip: $('#zip'), zipSub: $('#zipSub'),
  toast: $('#toast'), sheetHint: $('#sheetHint'),
  dlg: $('#loupe'), lCanvas: $('#lCanvas'), lName: $('#lName'), lIdx: $('#lIdx'), lPos: $('#lPos'),
  lPrev: $('#lPrev'), lNext: $('#lNext'), lClose: $('#lClose'), lDir: $('#lDir'), lFind: $('#lFind'),
  lMid: $('#lMid'), lRotA: $('#lRotA'), lRotB: $('#lRotB'), lOk: $('#lOk'), lMinus: $('#lMinus'), lPlus: $('#lPlus'),
  lGap: $('#lGap'), lA: $('#lA'), lB: $('#lB'), lCapA: $('#lCapA'), lCapB: $('#lCapB'), lState: $('#lState'),
};

/* ---------- Hilfsfunktionen ---------- */

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const natural = (a, b) => a.localeCompare(b, 'de', { numeric: true, sensitivity: 'base' });
const pad2 = (n) => String(n).padStart(2, '0');
const tick = () => new Promise((r) => setTimeout(r, 0));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
function closeImg(x) { if (x && typeof x.close === 'function') x.close(); }

let toastTimer = 0;
function toast(text, kind = '') {
  el.toast.textContent = text;
  el.toast.className = 'toast show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), kind === 'error' ? 9000 : 5500);
}

/* ---------- Geometrie ---------- */

// v: senkrechte Linie, Bilder nebeneinander. h: waagrechte Linie, Bilder untereinander.
function axis(it, w = it.w, h = it.h) {
  if (it.orient === 'v' || it.orient === 'h') return it.orient;
  return w >= h ? 'v' : 'h';
}

// Schnittrechtecke in Pixeln eines Bildes der Grösse w × h. A ist links oder oben.
function layout(it, w = it.w, h = it.h) {
  const o = axis(it, w, h);
  const m = Math.round(Math.min(w, h) * S.edge / 100);
  const L = o === 'v' ? w : h;
  const cut = it.pos * L, g = gapOf(it) * L;
  const a1 = Math.round(cut - g / 2), b0 = Math.round(cut + g / 2);
  let A, B;
  if (o === 'v') {
    A = { x: m, y: m, w: a1 - m, h: h - 2 * m };
    B = { x: b0, y: m, w: w - m - b0, h: h - 2 * m };
  } else {
    A = { x: m, y: m, w: w - 2 * m, h: a1 - m };
    B = { x: m, y: b0, w: w - 2 * m, h: h - m - b0 };
  }
  return { o, A, B, out: S.swap ? [B, A] : [A, B] };
}

// Drehung der beiden Ausgabebilder in Grad: Grundwert aus den Einstellungen plus Drehung pro Bild.
// it.rot gilt pro Teil im Scan (0: links oder oben, 1: rechts oder unten), damit «Reihenfolge tauschen» sie nicht vertauscht.
function outRots(it) {
  const r = it.rot.map((v) => (S.rot + v) % 360);
  return S.swap ? [r[1], r[0]] : r;
}

function rotateOut(it, n) {
  const phys = S.swap ? 1 - n : n;
  it.rot[phys] = (it.rot[phys] + 90) % 360;
  renderCard(it);
  drawLoupe();
}

// Breite des weggeschnittenen Stegs als Anteil: erkannt pro Scan, sonst aus den Einstellungen
function gapOf(it) { return it.gap != null ? it.gap : S.gap / 100; }

function outNames(it) {
  const ext = S.fmt === 'png' ? 'png' : 'jpg';
  return [`${it.base}_1.${ext}`, `${it.base}_2.${ext}`];
}

/* ---------- Bilder lesen ---------- */

async function scaled(src, max) {
  const k = Math.min(1, max / Math.max(src.width, src.height));
  if (k >= 1) return null;
  const w = Math.max(1, Math.round(src.width * k)), h = Math.max(1, Math.round(src.height * k));
  try {
    const b = await createImageBitmap(src, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
    if (b.width === w && b.height === h) return b;
    b.close();
  } catch (e) { /* weiter mit Canvas */ }
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.imageSmoothingQuality = 'high';
  x.drawImage(src, 0, 0, w, h);
  return c;
}

async function decode(file, max) {
  const full = await createImageBitmap(file);
  const w = full.width, h = full.height;
  const small = await scaled(full, max);
  if (small) full.close();
  return { img: small || full, w, h };
}

/* ---------- Steg suchen ----------
   1. Steg nach Farbe: Gesucht werden Spalten (bei Bildern untereinander: Zeilen), in denen mindestens 95 %
      der Pixel fast schwarz sind. Das ist der unbelichtete Steg bei Positiv Scans. Von diesem Kern aus wird
      nach aussen erweitert, solange noch die Hälfte der Pixel dunkel ist (so wird auch ein leicht schräger
      Steg ganz erfasst). Gleiches gilt für einen hellen Steg (Negativ Scans, orange Filmbasis).
      Ein Steg muss in der Bildmitte liegen und plausibel breit sein, sonst zählt er nicht. Liegen mehrere vor,
      gilt der nächste zur Mitte. Weggeschnitten wird genau der gefundene Steg plus ein kleiner Rand.
   2. Rückfall: Pro Spalte wird die mittlere Helligkeit gemessen und die Stelle gesucht, die sich am
      stärksten von beiden Seiten abhebt. Dann wird nur die Linie gesetzt, die Breite kommt aus den
      Einstellungen. Ergebnisse dieser Art gelten als unsicher, ausser der Ausschlag ist sehr deutlich.
   Gesucht wird auf einer Vorschau mit 800 Pixeln. Die Positionen sind Anteile (0 bis 1) und gelten
   deshalb unverändert für das Original in voller Auflösung. */

const BAND_CORE = 0.95;     // Anteil dunkler Pixel im Kern des Stegs
const BAND_EDGE = 0.5;      // bis hierhin wird der Steg nach aussen erweitert
const BAND_MIN = 0.006;     // Steg mindestens 0.6 % der Bildbreite
const BAND_MAX = 0.08;      // und höchstens 8 %
const BAND_MARGIN = 0.0015; // zusätzlich je Seite wegschneiden

function median(a) {
  if (!a.length) return 0;
  const s = a.slice().sort((x, y) => x - y);
  return s[s.length >> 1];
}

function sample(it) {
  const src = it.pv;
  const o = axis(it);
  const k = Math.min(1, 800 / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * k)), h = Math.max(1, Math.round(src.height * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(src, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data;
  const L = o === 'v' ? w : h, M = o === 'v' ? h : w;
  // Oben und unten (bzw. links und rechts) 15 % weglassen: dort liegen oft Filmrand und Perforation
  const lo = Math.round(M * 0.15), hi = Math.max(lo + 1, Math.round(M * 0.85));
  const n = hi - lo;
  const lum = new Uint8Array(L * n);
  const hist = new Uint32Array(256);
  for (let i = 0; i < L; i++) {
    for (let j = 0; j < n; j++) {
      const p = ((o === 'v' ? j + lo : i) * w + (o === 'v' ? i : j + lo)) * 4;
      const v = (0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]) | 0;
      lum[i * n + j] = v;
      hist[v]++;
    }
  }
  return { L, n, lum, hist };
}

function percentile(hist, q) {
  let total = 0;
  for (const v of hist) total += v;
  let acc = 0;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= total * q) return i; }
  return 255;
}

// Sucht Kerne mit mindestens 95 % passenden Pixeln, erweitert sie und liefert den besten Steg.
function findBand(frac, L) {
  const zA = Math.round(L * 0.3), zB = Math.round(L * 0.7);
  const lim0 = Math.round(L * 0.2), lim1 = Math.round(L * 0.8);
  const ok = [], wide = [];
  let i = zA;
  while (i <= zB) {
    if (frac[i] < BAND_CORE) { i++; continue; }
    let l = i, r = i;
    while (r + 1 <= lim1 && frac[r + 1] >= BAND_CORE) r++;
    i = r + 1;
    while (l - 1 >= lim0 && frac[l - 1] >= BAND_EDGE) l--;
    while (r + 1 <= lim1 && frac[r + 1] >= BAND_EDGE) r++;
    const wFrac = (r - l + 1) / L;
    const band = { l, r, width: wFrac, center: (l + r + 1) / 2 / L };
    if (wFrac > BAND_MAX) wide.push(band);
    else if (wFrac >= BAND_MIN) ok.push(band);
    if (r + 1 > i) i = r + 1;
  }
  const near = (a, b) => Math.abs(a.center - 0.5) - Math.abs(b.center - 0.5);
  ok.sort(near);
  wide.sort(near);
  return { band: ok[0] || null, wide: wide[0] || null };
}

function bandSearch(smp) {
  const { L, n, lum, hist } = smp;
  const darkT = Math.min(70, percentile(hist, 0.02) + 40);
  const lightT = Math.max(150, percentile(hist, 0.98) - 30);
  const dark = new Float32Array(L), light = new Float32Array(L);
  for (let i = 0; i < L; i++) {
    let dc = 0, lc = 0;
    for (let j = 0; j < n; j++) {
      const v = lum[i * n + j];
      if (v <= darkT) dc++;
      else if (v >= lightT) lc++;
    }
    dark[i] = dc / n;
    light[i] = lc / n;
  }
  const d = findBand(dark, L);
  if (d.band) return { ...d, kind: 'dunkel' };
  const l = findBand(light, L);
  if (l.band) return { ...l, kind: 'hell' };
  return { band: null, wide: d.wide || l.wide, kind: d.wide ? 'dunkel' : 'hell' };
}

// Rückfall: Stelle, die sich am stärksten von beiden Seiten abhebt
function contrastSearch(smp) {
  const { L, n, lum } = smp;
  const prof = new Float32Array(L);
  for (let i = 0; i < L; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += lum[i * n + j];
    prof[i] = s / n;
  }
  const s = Math.max(3, Math.round(L * 0.025));
  const a = Math.round(L * 0.34), b = Math.round(L * 0.66);
  const win = (from, to) => {
    const v = [];
    for (let i = Math.max(0, from); i <= Math.min(L - 1, to); i++) v.push(prof[i]);
    return median(v);
  };
  const score = new Float32Array(L);
  for (let i = a; i <= b; i++) {
    const l = win(i - 2 * s, i - s), r = win(i + s, i + 2 * s);
    score[i] = Math.max(0, Math.abs(prof[i] - (l + r) / 2) - 0.5 * Math.abs(l - r));
  }
  const sm = new Float32Array(L);
  let best = -1, bestV = 0;
  for (let i = a + 1; i < b; i++) {
    sm[i] = (score[i - 1] + score[i] + score[i + 1]) / 3;
    if (sm[i] > bestV) { bestV = sm[i]; best = i; }
  }
  if (best < 0 || bestV < 5) return null;
  let l = best, r = best;
  while (l > a + 1 && sm[l - 1] >= bestV * 0.5) l--;
  while (r < b - 1 && sm[r + 1] >= bestV * 0.5) r++;
  let second = 0;
  for (let i = a + 1; i < b; i++) if (i < l - s || i > r + s) second = Math.max(second, sm[i]);
  return { pos: ((l + r) / 2 + 0.5) / L, sure: bestV >= 25 && second < bestV * 0.5 };
}

// Typische Stegbreite: Median der sicher erkannten Stege, sonst 2.2 %
function typicalGap() {
  const g = items.filter((i) => i.state === 'auto' && i.gap != null && (i.how === 'dunkel' || i.how === 'hell')).map((i) => i.gap);
  return g.length ? median(g) : 0.022;
}

function detect(it) {
  const smp = sample(it);
  const res = bandSearch(smp);
  if (res.band) {
    return { pos: res.band.center, gap: res.band.width + 2 * BAND_MARGIN, sure: true, how: res.kind };
  }
  const c = contrastSearch(smp);
  // Ein zu breiter Bereich: Steg und dunkles Motiv grenzen aneinander. Der Steg liegt dann an der Kante,
  // die näher bei der Bildmitte ist. Seine Breite kommt von den anderen Scans dieser Rolle.
  if (res.wide) {
    const w = res.wide, L = smp.L;
    const g = typicalGap();
    const left = w.l / L, right = (w.r + 1) / L;
    const pos = Math.abs(right - 0.5) < Math.abs(left - 0.5) ? right - g / 2 : left + g / 2;
    return { pos, gap: g, sure: false, how: 'an dunklem Motiv' };
  }
  if (c) return { pos: c.pos, gap: null, sure: c.sure, how: 'kontrast' };
  return null;
}

function autoDetect(it) {
  const r = detect(it);
  if (r) {
    it.pos = clamp(r.pos, POS_MIN, POS_MAX);
    it.gap = r.gap;
    it.how = r.how;
    it.state = r.sure ? 'auto' : 'check';
  } else {
    it.pos = 0.5;
    it.gap = null;
    it.how = '';
    it.state = 'check';
  }
  return !!r && r.sure;
}

/* ---------- Zeichnen ---------- */

function drawSplit(cv, src, it) {
  const W = src.width, H = src.height;
  if (cv.width !== W) cv.width = W;
  if (cv.height !== H) cv.height = H;
  const x = cv.getContext('2d');
  x.drawImage(src, 0, 0, W, H);

  const k = W / it.w;
  const { o, A, B } = layout(it);
  const R = [A, B].map((r) => ({ x: r.x * k, y: r.y * k, w: r.w * k, h: r.h * k }));

  // Was weggeschnitten wird, abdunkeln
  x.save();
  x.fillStyle = 'rgba(8, 7, 6, .74)';
  x.beginPath();
  x.rect(0, 0, W, H);
  for (const r of R) if (r.w > 0 && r.h > 0) x.rect(r.x, r.y, r.w, r.h);
  x.fill('evenodd');
  x.restore();

  // Linie mit Griff
  const L = o === 'v' ? W : H, c = it.pos * L;
  x.strokeStyle = LINE;
  x.lineWidth = Math.max(1.5, L / 420);
  x.beginPath();
  if (o === 'v') { x.moveTo(c, 0); x.lineTo(c, H); } else { x.moveTo(0, c); x.lineTo(W, c); }
  x.stroke();

  const rad = Math.max(9, L / 46);
  const cx = o === 'v' ? c : W / 2, cy = o === 'v' ? H / 2 : c;
  x.fillStyle = LINE;
  x.beginPath(); x.arc(cx, cy, rad, 0, Math.PI * 2); x.fill();
  x.strokeStyle = '#fff';
  x.lineWidth = Math.max(1.5, rad / 5);
  x.lineCap = 'round'; x.lineJoin = 'round';
  const p = (u, v) => (o === 'v' ? [cx + u, cy + v] : [cx + v, cy + u]);
  x.beginPath();
  x.moveTo(...p(-rad * 0.2, -rad * 0.35)); x.lineTo(...p(-rad * 0.5, 0)); x.lineTo(...p(-rad * 0.2, rad * 0.35));
  x.moveTo(...p(rad * 0.2, -rad * 0.35)); x.lineTo(...p(rad * 0.5, 0)); x.lineTo(...p(rad * 0.2, rad * 0.35));
  x.stroke();

  // Nummern der beiden Bilder
  const labels = S.swap ? ['2', '1'] : ['1', '2'];
  const fs = Math.max(11, Math.round(Math.min(W, H) / 16));
  x.font = `700 ${fs}px ui-monospace, Menlo, Consolas, monospace`;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  R.forEach((r, n) => {
    if (r.w < fs * 2 || r.h < fs * 2) return;
    const bx = r.x + fs * 0.95, by = r.y + fs * 0.95;
    x.fillStyle = 'rgba(0, 0, 0, .58)';
    x.beginPath(); x.arc(bx, by, fs * 0.64, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#fff';
    x.fillText(labels[n], bx, by + fs * 0.04);
  });

  cv.style.cursor = o === 'v' ? 'col-resize' : 'row-resize';
}

function drawPart(cv, src, r, k, max, rot) {
  if (r.w < 8 || r.h < 8) { cv.width = 1; cv.height = 1; return; }
  const sw = r.w * k, sh = r.h * k;
  const turned = rot % 180 !== 0;
  const rw = turned ? sh : sw, rh = turned ? sw : sh;
  const f = Math.min(1, max / Math.max(rw, rh));
  cv.width = Math.max(1, Math.round(rw * f));
  cv.height = Math.max(1, Math.round(rh * f));
  const x = cv.getContext('2d');
  x.translate(cv.width / 2, cv.height / 2);
  x.rotate(rot * Math.PI / 180);
  x.drawImage(src, r.x * k, r.y * k, sw, sh, -sw * f / 2, -sh * f / 2, sw * f, sh * f);
}

// Die beiden fertigen Bilder nebeneinander, so wie sie ins ZIP kommen (Reihenfolge und Drehung)
function drawResult(cv, src, it) {
  const k = src.width / it.w;
  const { out } = layout(it);
  const rots = outRots(it);
  const parts = out.map((r, n) => {
    const sw = Math.max(0, r.w * k), sh = Math.max(0, r.h * k);
    const turned = rots[n] % 180 !== 0;
    return { r, sw, sh, rot: rots[n], w: turned ? sh : sw, h: turned ? sw : sh };
  });
  const gap = Math.round(Math.max(parts[0].w, parts[1].w, 1) * 0.06);
  const W = Math.max(1, Math.round(parts[0].w + parts[1].w + gap));
  const H = Math.max(1, Math.round(Math.max(parts[0].h, parts[1].h)));
  if (cv.width !== W) cv.width = W;
  if (cv.height !== H) cv.height = H;
  const x = cv.getContext('2d');
  x.clearRect(0, 0, W, H);
  let ox = 0;
  const fs = Math.max(11, Math.round(Math.max(W, H) / 30));
  parts.forEach((p, n) => {
    if (p.sw >= 2 && p.sh >= 2) {
      const oy = (H - p.h) / 2;
      x.save();
      x.translate(ox + p.w / 2, oy + p.h / 2);
      x.rotate(p.rot * Math.PI / 180);
      x.drawImage(src, p.r.x * k, p.r.y * k, p.sw, p.sh, -p.sw / 2, -p.sh / 2, p.sw, p.sh);
      x.restore();
      const bx = ox + fs * 0.95, by = oy + fs * 0.95;
      x.fillStyle = 'rgba(0, 0, 0, .58)';
      x.beginPath(); x.arc(bx, by, fs * 0.64, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#fff';
      x.font = `700 ${fs}px ui-monospace, Menlo, Consolas, monospace`;
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.fillText(String(n + 1), bx, by + fs * 0.04);
    }
    ox += p.w + gap;
  });
  cv.style.cursor = 'zoom-in';
}

function setView(v) {
  view = v === 'split' ? 'split' : 'scan';
  for (const b of document.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === view));
  el.grid.classList.toggle('view-split', view === 'split');
  el.sheetHint.textContent = view === 'split'
    ? 'So kommen die Bilder ins ZIP. Ein Klick öffnet die Lupe, dort lässt sich die Linie verschieben.'
    : 'Klicke oder ziehe im Bild, um die rote Linie zu setzen. Mit der Lupe prüfst du einen Scan in gross.';
  try { localStorage.setItem(VIEW_STORE, view); } catch (e) { /* ohne Speicher weiter */ }
  for (const it of items) if (it.pv) renderCard(it);
}

/* ---------- Karten ---------- */

const STATE_TEXT = { load: 'Lädt', auto: 'Linie gefunden', check: 'Bitte prüfen', manual: 'Geprüft', error: 'Nicht lesbar', skip: 'Weggelassen' };
function chipState(it) { return it.skip && it.state !== 'error' ? 'skip' : it.state; }

function makeItem({ file, rel }) {
  const slash = rel.lastIndexOf('/');
  const name = slash >= 0 ? rel.slice(slash + 1) : rel;
  const dot = name.lastIndexOf('.');
  return {
    id: nextId++, file, rel, name,
    dir: slash >= 0 ? rel.slice(0, slash + 1) : '',
    base: (dot > 0 ? name.slice(0, dot) : name) || 'bild',
    w: 0, h: 0, pv: null, big: null, pos: 0.5, gap: null, rot: [0, 0], how: '', orient: 'auto',
    state: 'load', skip: false, dead: false, no: 0, card: null,
  };
}

function buildCard(it) {
  const card = document.createElement('article');
  card.className = 'card';
  card.innerHTML = `
    <div class="film">
      <div class="ph"></div>
      <canvas class="cv" tabindex="0" hidden></canvas>
      <button class="lupe" type="button" title="Gross prüfen" aria-label="Gross prüfen" disabled>${ZOOM_ICON}</button>
      <span class="edge" aria-hidden="true"></span>
    </div>
    <div class="rots" role="group" aria-label="Einzelbilder drehen">
      <button type="button" data-n="0" title="Bild 1 um 90° drehen">${ROT_ICON}<span>Bild 1</span></button>
      <button type="button" data-n="1" title="Bild 2 um 90° drehen">${ROT_ICON}<span>Bild 2</span></button>
    </div>
    <div class="meta">
      <span class="name"></span>
      <span class="chip"></span>
    </div>`;
  const cv = $('.cv', card);
  const nm = $('.name', card);
  nm.textContent = it.rel;
  nm.title = it.rel;
  cv.setAttribute('aria-label', `Trennlinie von ${it.name}. Klicken oder ziehen, Pfeiltasten verschieben fein.`);
  bindLine(cv, () => it, true);
  $('.lupe', card).addEventListener('click', () => openLoupe(it));
  for (const b of card.querySelectorAll('.rots button')) b.addEventListener('click', () => rotateOut(it, +b.dataset.n));
  it.card = card;
  return card;
}

function renderCard(it) {
  const card = it.card;
  if (!card) return;
  const st = chipState(it);
  card.dataset.state = it.state;
  const cv = $('.cv', card), ph = $('.ph', card);
  if (it.pv) {
    ph.hidden = true;
    cv.hidden = false;
    if (view === 'split') drawResult(cv, it.pv, it); else drawSplit(cv, it.pv, it);
  } else if (it.state === 'error') {
    ph.className = 'ph err';
    ph.textContent = 'Dieses Format kann dein Browser nicht öffnen. Als JPG speichern hilft.';
  }
  const chip = $('.chip', card);
  chip.dataset.state = st;
  chip.textContent = STATE_TEXT[st];
  $('.lupe', card).disabled = !it.pv;
  for (const b of card.querySelectorAll('.rots button')) b.disabled = !it.pv;
  $('.edge', card).textContent = `${pad2(it.no)}  ▸  ${pad2(it.no)}A`;
}

function numberFrames() {
  items.forEach((it, i) => {
    it.no = i + 1;
    if (it.card) $('.edge', it.card).textContent = `${pad2(it.no)}  ▸  ${pad2(it.no)}A`;
  });
}

let redrawRaf = 0;
function redrawAll() {
  if (redrawRaf) return;
  redrawRaf = requestAnimationFrame(() => {
    redrawRaf = 0;
    for (const it of items) if (it.pv) renderCard(it);
    drawLoupe();
  });
}

/* ---------- Linie setzen ---------- */

function nudgeKey(e) {
  const step = e.shiftKey ? 0.01 : 0.001;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') return -step;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') return step;
  return 0;
}

function bindLine(cv, getIt, withKeys) {
  const onSheet = withKeys;
  const set = (e) => {
    const it = getIt();
    if (!it || !it.pv) return;
    const r = cv.getBoundingClientRect();
    const p = axis(it) === 'v' ? (e.clientX - r.left) / r.width : (e.clientY - r.top) / r.height;
    setPos(it, p, true);
  };
  cv.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    // In der Ansicht «Einzelbilder» öffnet ein Klick die Lupe, dort lässt sich die Linie setzen
    if (onSheet && view === 'split') { openLoupe(getIt()); return; }
    cv.setPointerCapture(e.pointerId);
    set(e);
  });
  cv.addEventListener('pointermove', (e) => { if (cv.hasPointerCapture(e.pointerId)) set(e); });
  if (withKeys) {
    cv.addEventListener('keydown', (e) => {
      const it = getIt();
      const d = view === 'scan' ? nudgeKey(e) : 0;
      if (d && it && it.pv) { e.preventDefault(); setPos(it, it.pos + d, true); }
      if (e.key === 'Enter' && it && it.pv) { e.preventDefault(); openLoupe(it); }
      if (e.key === ' ' && it && it.pv) { e.preventDefault(); setPos(it, 0.5, true); }
    });
  }
}

function setPos(it, p, manual) {
  it.pos = clamp(p, POS_MIN, POS_MAX);
  if (manual && it.state !== 'error') it.state = 'manual';
  renderCard(it);
  if (loupe === it) drawLoupe();
  updateSummary();
}

/* ---------- Übersicht ---------- */

function updateSummary() {
  const live = items.filter((i) => i.state !== 'error');
  const use = live.filter((i) => !i.skip);
  const check = live.filter((i) => i.state === 'check' && !i.skip).length;
  const loading = items.filter((i) => i.state === 'load').length;

  el.sumCount.textContent = `${plural(live.length, 'Scan', 'Scans')} · ${use.length * 2} Bilder`;
  if (onlyCheck && !check) { onlyCheck = false; el.grid.classList.remove('only-check'); }
  el.sumCheck.hidden = !check;
  el.sumCheck.textContent = onlyCheck ? 'Alle zeigen' : `${check} prüfen`;

  el.zip.disabled = exporting || loading > 0 || !use.length;
  el.zipSub.textContent = use.length ? `${use.length * 2} Bilder` : '';
  if (!exporting) {
    el.dockText.textContent = loading
      ? `Scans werden gelesen, noch ${loading} …`
      : !use.length ? 'Kein Scan ausgewählt.'
      : check ? `${plural(check, 'Scan solltest', 'Scans solltest')} du noch ansehen. Du kannst aber auch direkt speichern.`
      : 'Alles bereit. Die Bilder kommen als eine ZIP Datei in deinen Download Ordner.';
  }
}

function showSheet() {
  if (!el.intro.hidden) window.scrollTo({ top: 0 });
  el.intro.hidden = true;
  el.sheet.hidden = false;
  el.dock.hidden = false;
  document.body.classList.add('has-items');
}

/* ---------- Dateien sammeln ---------- */

async function addFiles(list, name = '') {
  const imgs = list.filter((x) => IMG_EXT.test(x.rel) && !x.rel.split('/').some((p) => p.startsWith('.')));
  if (!imgs.length) {
    toast(list.length ? 'Hier sind keine Bilder dabei. Möglich sind JPG, PNG und WebP.' : 'Der Ordner ist leer.', 'error');
    return;
  }
  if (!items.length) folderName = name;
  imgs.sort((a, b) => natural(a.rel, b.rel));
  const fresh = imgs.map(makeItem);
  for (const it of fresh) {
    items.push(it);
    el.grid.append(buildCard(it));
  }
  showSheet();
  numberFrames();
  fresh.forEach(renderCard);
  updateSummary();
  const job = work.then(() => prepareAll(fresh));
  work = job.catch(() => {});
  await job;
}

async function prepareAll(list) {
  let bad = 0;
  for (const it of list) {
    if (it.dead) continue;
    try {
      const { img, w, h } = await decode(it.file, PV_MAX);
      if (it.dead) { closeImg(img); continue; }
      it.pv = img; it.w = w; it.h = h;
      autoDetect(it);
    } catch (e) {
      it.state = 'error';
      it.skip = true;
      bad++;
    }
    renderCard(it);
    updateSummary();
    await tick();
  }
  const done = list.filter((i) => !i.dead && i.state !== 'error');
  if (!done.length && !bad) return;
  const check = done.filter((i) => i.state === 'check').length;
  let msg = `${plural(done.length, 'Scan', 'Scans')} geladen.`;
  if (check) msg += ` Bei ${check} bitte die Linie ansehen, sie sind gelb markiert.`;
  else if (done.length) msg += ' Alle Linien gefunden.';
  if (bad) msg += ` ${plural(bad, 'Datei', 'Dateien')} konnte dein Browser nicht öffnen (zum Beispiel TIFF oder HEIC). Als JPG speichern hilft.`;
  toast(msg, bad ? 'error' : check ? 'warn' : 'ok');
}

function readAll(reader) {
  return new Promise((resolve, reject) => {
    const all = [];
    (function next() {
      reader.readEntries((es) => {
        if (!es.length) return resolve(all);
        all.push(...es);
        next();
      }, reject);
    })();
  });
}

async function walkEntry(entry, prefix, out, isRoot) {
  if (entry.name.startsWith('.')) return;
  if (entry.isFile) {
    const f = await new Promise((res, rej) => entry.file(res, rej));
    out.push({ file: f, rel: prefix + entry.name });
  } else if (entry.isDirectory) {
    const next = isRoot ? '' : prefix + entry.name + '/';
    for (const c of await readAll(entry.createReader())) await walkEntry(c, next, out, false);
  }
}

async function walkHandle(dir, prefix, out) {
  for await (const [n, h] of dir.entries()) {
    if (n.startsWith('.')) continue;
    if (h.kind === 'directory') await walkHandle(h, prefix + n + '/', out);
    else out.push({ file: await h.getFile(), rel: prefix + n });
  }
}

async function pickDir() {
  if (!window.showDirectoryPicker) { el.inDir.click(); return; }
  let h;
  try {
    h = await window.showDirectoryPicker({ id: 'halfframe', mode: 'read' });
  } catch (e) {
    if (e && e.name !== 'AbortError') el.inDir.click();
    return;
  }
  toast('Ordner wird gelesen …');
  const out = [];
  try {
    await walkHandle(h, '', out);
  } catch (e) {
    toast('Der Ordner konnte nicht gelesen werden.', 'error');
    return;
  }
  await addFiles(out, h.name);
}

async function handleDrop(dt) {
  const entries = [...dt.items]
    .filter((i) => i.kind === 'file')
    .map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null))
    .filter(Boolean);
  const plain = [...dt.files];
  try {
    if (!entries.length) {
      await addFiles(plain.map((f) => ({ file: f, rel: f.name })));
      return;
    }
    const out = [];
    let name = '';
    if (entries.length === 1 && entries[0].isDirectory) {
      name = entries[0].name;
      toast('Ordner wird gelesen …');
      await walkEntry(entries[0], '', out, true);
    } else {
      for (const en of entries) await walkEntry(en, '', out, false);
    }
    await addFiles(out, name);
  } catch (e) {
    toast('Das Ablegen hat nicht geklappt. Versuche es mit «Ordner wählen».', 'error');
  }
}

/* ---------- Lupe ---------- */

function navList() { return items.filter((i) => i.pv); }

function openLoupe(it) {
  if (!it || !it.pv) return;
  if (!el.dlg.open) el.dlg.showModal();
  showInLoupe(it);
  el.lCanvas.focus({ preventScroll: true });
}

async function showInLoupe(it) {
  if (loupe && loupe !== it) { closeImg(loupe.big); loupe.big = null; }
  loupe = it;
  const list = navList();
  const i = list.indexOf(it);
  el.lName.textContent = it.rel;
  el.lIdx.textContent = `${i + 1} / ${list.length}`;
  el.lPrev.disabled = i <= 0;
  el.lNext.disabled = i >= list.length - 1;
  el.lOk.textContent = i >= list.length - 1 ? 'Passt, fertig' : 'Passt, weiter';
  el.lDir.value = it.orient;
  drawLoupe();
  if (!it.big) {
    try {
      const { img } = await decode(it.file, BIG_MAX);
      if (loupe === it && el.dlg.open) { it.big = img; drawLoupe(); } else closeImg(img);
    } catch (e) { /* bleibt bei der kleinen Vorschau */ }
  }
}

let loupeRaf = 0;
function drawLoupe() {
  if (loupeRaf || !loupe) return;
  loupeRaf = requestAnimationFrame(() => { loupeRaf = 0; paintLoupe(); });
}

function paintLoupe() {
  const it = loupe;
  if (!it || !el.dlg.open || !it.pv) return;
  const src = it.big || it.pv;
  drawSplit(el.lCanvas, src, it);
  el.lPos.textContent = (it.pos * 100).toFixed(1) + ' %';
  el.lGap.textContent = it.gap != null
    ? `Steg ${(it.gap * 100).toFixed(1)} % breit, erkannt (${it.how})`
    : `Steg ${S.gap.toFixed(1)} % breit, aus den Einstellungen`;
  const st = chipState(it);
  el.lState.dataset.state = st;
  el.lState.textContent = STATE_TEXT[st];
  const { out } = layout(it);
  const k = src.width / it.w;
  const rots = outRots(it);
  drawPart(el.lA, src, out[0], k, 300, rots[0]);
  drawPart(el.lB, src, out[1], k, 300, rots[1]);
  const names = outNames(it);
  el.lCapA.textContent = names[0];
  el.lCapB.textContent = names[1];
}

function step(dir, confirm) {
  const it = loupe;
  if (!it) return;
  if (confirm && it.state === 'check') { it.state = 'manual'; renderCard(it); updateSummary(); }
  const list = navList();
  const i = list.indexOf(it) + dir;
  if (i >= 0 && i < list.length) {
    showInLoupe(list[i]);
    if (list[i].card) list[i].card.scrollIntoView({ block: 'nearest' });
  } else if (confirm && dir > 0) {
    el.dlg.close();
  }
}

/* ---------- ZIP ---------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(u8) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Einfaches ZIP ohne Kompression (JPG und PNG sind schon komprimiert). Die Bilder bleiben als Blob,
// so muss der Browser nicht alles gleichzeitig im Arbeitsspeicher halten.
class Zip {
  constructor() {
    this.parts = []; this.entries = []; this.offset = 0; this.count = 0; this.bytes = 0;
    this.enc = new TextEncoder();
    const d = new Date();
    this.time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    this.date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  }
  async add(name, blob) {
    const crc = crc32(new Uint8Array(await blob.arrayBuffer()));
    const size = blob.size;
    const nm = this.enc.encode(name);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, 0x0800, true);
    h.setUint16(10, this.time, true);
    h.setUint16(12, this.date, true);
    h.setUint32(14, crc, true);
    h.setUint32(18, size, true);
    h.setUint32(22, size, true);
    h.setUint16(26, nm.length, true);
    this.parts.push(h.buffer, nm, blob);
    this.entries.push({ nm, crc, size, offset: this.offset });
    this.offset += 30 + nm.length + size;
    this.count++;
    this.bytes += size;
  }
  blob() {
    const central = [];
    let cdSize = 0;
    for (const e of this.entries) {
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true);
      c.setUint16(4, 20, true);
      c.setUint16(6, 20, true);
      c.setUint16(8, 0x0800, true);
      c.setUint16(12, this.time, true);
      c.setUint16(14, this.date, true);
      c.setUint32(16, e.crc, true);
      c.setUint32(20, e.size, true);
      c.setUint32(24, e.size, true);
      c.setUint16(28, e.nm.length, true);
      c.setUint32(42, e.offset, true);
      central.push(c.buffer, e.nm);
      cdSize += 46 + e.nm.length;
    }
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, this.count, true);
    end.setUint16(10, this.count, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, this.offset, true);
    return new Blob([...this.parts, ...central, end.buffer], { type: 'application/zip' });
  }
}

function renderPart(bmp, r, type, rot) {
  const turned = rot % 180 !== 0;
  const cw = turned ? r.h : r.w, ch = turned ? r.w : r.h;
  const c = document.createElement('canvas');
  c.width = cw; c.height = ch;
  const x = c.getContext('2d');
  if (type === 'image/jpeg') { x.fillStyle = '#fff'; x.fillRect(0, 0, cw, ch); }
  x.translate(cw / 2, ch / 2);
  x.rotate(rot * Math.PI / 180);
  x.drawImage(bmp, r.x, r.y, r.w, r.h, -r.w / 2, -r.h / 2, r.w, r.h);
  return new Promise((res, rej) => c.toBlob((b) => {
    c.width = 0; c.height = 0;
    if (b) res(b); else rej(new Error('Bild zu gross für den Browser'));
  }, type, S.q));
}

function uniquePath(path, used) {
  let p = path, n = 2;
  const dot = path.lastIndexOf('.');
  while (used.has(p.toLowerCase())) p = `${path.slice(0, dot)}_${n++}${path.slice(dot)}`;
  used.add(p.toLowerCase());
  return p;
}

function zipBase() {
  const n = (folderName || 'Half Frame').replace(/[\\/:*?"<>|]+/g, '_').trim();
  return `${n} einzeln`;
}

function save(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 120000);
}

async function exportZip() {
  if (exporting) return;
  await work;
  const todo = items.filter((i) => !i.skip && i.pv && i.state !== 'error');
  if (!todo.length) { toast('Es gibt nichts zu speichern.', 'error'); return; }

  exporting = true;
  updateSummary();
  el.dock.classList.add('busy');
  const type = S.fmt === 'png' ? 'image/png' : 'image/jpeg';
  const base = zipBase();
  const used = new Set();
  const names = [];
  const failed = [];
  let zip = new Zip(), part = 1, files = 0;

  try {
    for (let i = 0; i < todo.length; i++) {
      const it = todo[i];
      el.dockText.textContent = `Schneide ${i + 1} von ${todo.length}: ${it.name}`;
      el.meter.style.width = `${(i / todo.length) * 100}%`;
      let full = null;
      try {
        full = await createImageBitmap(it.file);
        const { out } = layout(it, full.width, full.height);
        if (!out.every((r) => r.w >= 8 && r.h >= 8)) throw new Error('Schnitt zu klein');
        const fn = outNames(it);
        const rots = outRots(it);
        for (let n = 0; n < 2; n++) {
          const blob = await renderPart(full, out[n], type, rots[n]);
          await zip.add(uniquePath(it.dir + fn[n], used), blob);
          files++;
        }
      } catch (e) {
        failed.push(it.name);
      } finally {
        closeImg(full);
      }
      if (zip.bytes >= ZIP_PART && i < todo.length - 1) {
        const n = `${base} Teil ${part}.zip`;
        save(zip.blob(), n);
        names.push(n);
        part++;
        zip = new Zip();
      }
      await tick();
    }
    if (zip.count) {
      const n = part > 1 ? `${base} Teil ${part}.zip` : `${base}.zip`;
      save(zip.blob(), n);
      names.push(n);
    }
    el.meter.style.width = '100%';
    let msg = names.length === 1
      ? `Fertig: ${files} Bilder in «${names[0]}». Die Datei liegt in deinem Download Ordner.`
      : `Fertig: ${files} Bilder in ${names.length} ZIP Dateien (${names.join(', ')}).`;
    if (!names.length) msg = 'Es konnte kein Bild gespeichert werden.';
    if (failed.length) msg += ` Nicht geklappt bei: ${failed.slice(0, 4).join(', ')}${failed.length > 4 ? ' …' : ''}.`;
    toast(msg, failed.length || !names.length ? 'error' : 'ok');
  } catch (e) {
    toast('Speichern hat nicht geklappt: ' + (e.message || e), 'error');
  } finally {
    exporting = false;
    el.dock.classList.remove('busy');
    setTimeout(() => { el.meter.style.width = '0'; }, 1200);
    updateSummary();
  }
}

/* ---------- Einstellungen ---------- */

function readSettings(redraw = true) {
  S.gap = +el.gap.value;
  S.edge = +el.edge.value;
  S.rot = +el.rot.value;
  S.swap = el.swap.checked;
  S.fmt = el.fmt.value;
  S.q = +el.q.value / 100;
  el.gapOut.textContent = S.gap.toFixed(1) + ' %';
  el.edgeOut.textContent = S.edge.toFixed(1) + ' %';
  el.qOut.textContent = el.q.value;
  el.qField.hidden = S.fmt !== 'jpeg';
  try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) { /* ohne Speicher weiter */ }
  if (redraw) redrawAll();
}

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (s) {
      if (typeof s.gap === 'number') el.gap.value = s.gap;
      if (typeof s.edge === 'number') el.edge.value = s.edge;
      if ([0, 90, 180, 270].includes(s.rot)) el.rot.value = String(s.rot);
      el.swap.checked = !!s.swap;
      if (s.fmt === 'png' || s.fmt === 'jpeg') el.fmt.value = s.fmt;
      if (typeof s.q === 'number') el.q.value = Math.round(s.q * 100);
    }
  } catch (e) { /* Standardwerte */ }
  readSettings(false);
}

/* ---------- Testbild ---------- */

async function demoImage() {
  const W = 2400, H = 1600;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#0c0b0a';
  x.fillRect(0, 0, W, H);
  const fw = 1110, gap = 44, pad = (W - 2 * fw - gap) / 2;
  const frame = (x0, hue, sun) => {
    const g = x.createLinearGradient(0, 60, 0, H - 60);
    g.addColorStop(0, `hsl(${hue},55%,72%)`);
    g.addColorStop(0.62, `hsl(${hue + 20},45%,52%)`);
    g.addColorStop(1, `hsl(${hue + 40},40%,22%)`);
    x.fillStyle = g;
    x.fillRect(x0, 60, fw, H - 120);
    x.fillStyle = `hsla(${sun},90%,70%,.9)`;
    x.beginPath(); x.arc(x0 + fw * 0.68, 420, 120, 0, Math.PI * 2); x.fill();
    x.fillStyle = `hsl(${hue + 50},30%,14%)`;
    x.beginPath();
    x.moveTo(x0, H - 60);
    x.lineTo(x0, 1000);
    x.lineTo(x0 + fw * 0.3, 760);
    x.lineTo(x0 + fw * 0.55, 960);
    x.lineTo(x0 + fw * 0.8, 820);
    x.lineTo(x0 + fw, 980);
    x.lineTo(x0 + fw, H - 60);
    x.fill();
  };
  frame(pad, 200, 45);
  frame(pad + fw + gap, 14, 50);
  x.fillStyle = '#f2a93b';
  x.font = '600 34px ui-monospace, Menlo, Consolas, monospace';
  x.fillText('12  ▸  12A', 80, H - 18);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
  await addFiles([{ file: new File([blob], 'Testbild.jpg', { type: 'image/jpeg' }), rel: 'Testbild.jpg' }], 'Testbild');
}

/* ---------- Neu beginnen ---------- */

let resetTimer = 0;
function resetAll() {
  if (!el.reset.classList.contains('armed')) {
    el.reset.classList.add('armed');
    el.reset.textContent = 'Wirklich alles leeren?';
    resetTimer = setTimeout(() => { el.reset.classList.remove('armed'); el.reset.textContent = 'Neu beginnen'; }, 3500);
    return;
  }
  clearTimeout(resetTimer);
  el.reset.classList.remove('armed');
  el.reset.textContent = 'Neu beginnen';
  for (const it of items) { it.dead = true; closeImg(it.pv); closeImg(it.big); }
  items.length = 0;
  el.grid.textContent = '';
  folderName = '';
  onlyCheck = false;
  el.grid.classList.remove('only-check');
  el.sheet.hidden = true;
  el.dock.hidden = true;
  el.intro.hidden = false;
  document.body.classList.remove('has-items');
  el.settings.open = false;
  window.scrollTo({ top: 0 });
}

/* ---------- Version und Änderungsprotokoll ---------- */

function initChangelog() {
  const list = typeof CHANGELOG !== 'undefined' ? CHANGELOG : [];
  const link = $('#versionLink');
  const dlg = $('#changelog');
  if (!list.length) return;
  link.textContent = `Version ${list[0].version} · ${list[0].date}`;
  const box = $('#clList');
  for (const c of list) {
    const item = document.createElement('div');
    item.className = 'cl-item';
    const v = document.createElement('strong');
    v.textContent = c.version ? `Version ${c.version}` : c.label;
    const d = document.createElement('span');
    d.className = 'cl-date';
    d.textContent = c.date;
    const p = document.createElement('p');
    p.textContent = c.text;
    item.append(v, d, p);
    box.append(item);
  }
  const open = () => { if (!dlg.open) dlg.showModal(); };
  link.addEventListener('click', (e) => {
    e.preventDefault();
    history.replaceState(null, '', '#aenderungen');
    open();
  });
  dlg.addEventListener('close', () => {
    if (location.hash === '#aenderungen') history.replaceState(null, '', location.pathname + location.search);
  });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  if (location.hash === '#aenderungen') open();
}

/* ---------- Start ---------- */

function init() {
  loadSettings();
  let v = 'scan';
  try { v = localStorage.getItem(VIEW_STORE) || 'scan'; } catch (e) { /* Standard */ }
  setView(v);
  for (const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', () => setView(b.dataset.view));
  initChangelog();

  el.pickDir.addEventListener('click', pickDir);
  el.pickFiles.addEventListener('click', () => el.inFiles.click());
  el.addMore.addEventListener('click', () => el.inFiles.click());
  el.demo.addEventListener('click', demoImage);
  el.reset.addEventListener('click', resetAll);
  el.zip.addEventListener('click', exportZip);

  el.inDir.addEventListener('change', () => {
    const files = [...el.inDir.files];
    el.inDir.value = '';
    if (!files.length) return;
    const first = (files[0].webkitRelativePath || '').split('/')[0];
    addFiles(files.map((f) => {
      const parts = (f.webkitRelativePath || f.name).split('/');
      return { file: f, rel: parts.length > 1 ? parts.slice(1).join('/') : parts[0] };
    }), first);
  });
  el.inFiles.addEventListener('change', () => {
    const files = [...el.inFiles.files];
    el.inFiles.value = '';
    if (files.length) addFiles(files.map((f) => ({ file: f, rel: f.name })));
  });

  for (const n of [el.gap, el.edge, el.q]) n.addEventListener('input', () => readSettings());
  for (const n of [el.rot, el.swap, el.fmt]) n.addEventListener('change', () => readSettings());
  el.redetect.addEventListener('click', () => {
    let ok = 0, n = 0;
    for (const it of items) if (it.pv) { n++; if (autoDetect(it)) ok++; renderCard(it); }
    updateSummary();
    drawLoupe();
    toast(`Linie bei ${ok} von ${n} Scans sicher gefunden.`, ok === n ? 'ok' : 'warn');
  });
  document.addEventListener('click', (e) => {
    if (el.settings.open && !el.settings.contains(e.target)) el.settings.open = false;
  });

  el.sumCheck.addEventListener('click', () => {
    onlyCheck = !onlyCheck;
    el.grid.classList.toggle('only-check', onlyCheck);
    updateSummary();
  });

  // Lupe
  bindLine(el.lCanvas, () => loupe, false);
  el.lPrev.addEventListener('click', () => step(-1, false));
  el.lNext.addEventListener('click', () => step(1, false));
  el.lOk.addEventListener('click', () => step(1, true));
  el.lClose.addEventListener('click', () => el.dlg.close());
  el.lMinus.addEventListener('click', () => loupe && setPos(loupe, loupe.pos - 0.001, true));
  el.lPlus.addEventListener('click', () => loupe && setPos(loupe, loupe.pos + 0.001, true));
  el.lMid.addEventListener('click', () => loupe && setPos(loupe, 0.5, true));
  el.lRotA.addEventListener('click', () => loupe && rotateOut(loupe, 0));
  el.lRotB.addEventListener('click', () => loupe && rotateOut(loupe, 1));
  el.lFind.addEventListener('click', () => {
    if (!loupe) return;
    const sure = autoDetect(loupe);
    renderCard(loupe); updateSummary(); drawLoupe();
    toast(sure ? 'Linie gefunden.' : 'Keine klare Linie gefunden. Setze sie bitte von Hand.', sure ? 'ok' : 'warn');
  });
  el.lDir.addEventListener('change', () => {
    if (!loupe) return;
    loupe.orient = el.lDir.value;
    autoDetect(loupe);
    renderCard(loupe); updateSummary(); drawLoupe();
  });
  el.dlg.addEventListener('keydown', (e) => {
    if (!loupe) return;
    const t = e.target.tagName;
    if (t === 'SELECT') return;
    const d = nudgeKey(e);
    if (d) { e.preventDefault(); setPos(loupe, loupe.pos + d, true); return; }
    if (e.key === 'Enter' && t !== 'BUTTON') { e.preventDefault(); step(1, true); }
    if (e.key === ' ' && t !== 'BUTTON' && t !== 'INPUT') { e.preventDefault(); setPos(loupe, 0.5, true); }
    if (e.key === '1' || e.key === '2') { e.preventDefault(); rotateOut(loupe, +e.key - 1); }
    if (e.key === 'PageDown') { e.preventDefault(); step(1, false); }
    if (e.key === 'PageUp') { e.preventDefault(); step(-1, false); }
  });
  el.dlg.addEventListener('click', (e) => { if (e.target === el.dlg) el.dlg.close(); });
  el.dlg.addEventListener('close', () => {
    const it = loupe;
    if (it) { closeImg(it.big); it.big = null; }
    loupe = null;
    if (it && it.card) { const cv = $('.cv', it.card); if (cv && !cv.hidden) cv.focus({ preventScroll: true }); }
  });

  // Ziehen und Ablegen auf der ganzen Seite
  let depth = 0;
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth++;
    document.body.classList.add('dragging');
  });
  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) document.body.classList.remove('dragging');
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    document.body.classList.remove('dragging');
    if (el.dlg.open) el.dlg.close();
    handleDrop(e.dataTransfer);
  });

  window.addEventListener('beforeunload', (e) => {
    if (exporting) { e.preventDefault(); e.returnValue = ''; }
  });
}

init();
