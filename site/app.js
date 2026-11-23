'use strict';

/* Half Frame Splitter
   Alles läuft im Browser. Die Bilder werden nie hochgeladen. */

const $ = (s) => document.querySelector(s);
const IMG_RE = /\.(jpe?g|png|webp|bmp|gif|avif)$/i;
const TIFF_RE = /\.tiff?$/i;
const OUT_DIR = 'geschnitten';
const PREVIEW_MAX = 1600;
const ZIP_BATCH_BYTES = 400 * 1024 * 1024;

const DEFAULTS = { cut: 50, gap: 0, edge: 0, rot: 0, swap: false, dir: 'auto' };

const state = {
  items: [],
  cur: -1,
  root: null,        // FileSystemDirectoryHandle, falls vorhanden
  defaults: { ...DEFAULTS },
  generation: 0,     // erhöht sich bei jedem neuen Ordner, stoppt alte Hintergrundarbeit
  busy: false,
  cancel: false,
  lru: [],
};

/* ---------- Hilfsfunktionen ---------- */

function showMsg(text, kind) {
  const el = $('#msg');
  el.textContent = text;
  el.className = 'msg' + (kind ? ' ' + kind : '');
  el.hidden = !text;
}

function naturalCompare(a, b) {
  return a.localeCompare(b, 'de', { numeric: true, sensitivity: 'base' });
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

function resolveDir(w, h, s) {
  if (s.dir === 'v' || s.dir === 'h') return s.dir;
  return w >= h ? 'v' : 'h';
}

/* Schnittrechtecke in Pixeln des Originals. Gibt [A, B] zurück. */
function computeParts(w, h, s) {
  const dir = resolveDir(w, h, s);
  const m = Math.round(Math.min(w, h) * (s.edge / 100));
  const x0 = m, y0 = m, x1 = w - m, y1 = h - m;
  let a, b;
  if (dir === 'v') {
    const cx = w * (s.cut / 100);
    const g = w * (s.gap / 100);
    const ax1 = Math.round(cx - g), bx0 = Math.round(cx + g);
    a = { x: x0, y: y0, w: ax1 - x0, h: y1 - y0 };
    b = { x: bx0, y: y0, w: x1 - bx0, h: y1 - y0 };
  } else {
    const cy = h * (s.cut / 100);
    const g = h * (s.gap / 100);
    const ay1 = Math.round(cy - g), by0 = Math.round(cy + g);
    a = { x: x0, y: y0, w: x1 - x0, h: ay1 - y0 };
    b = { x: x0, y: by0, w: x1 - x0, h: y1 - by0 };
  }
  return { dir, parts: s.swap ? [b, a] : [a, b], raw: [a, b] };
}

function validRect(r) { return r.w >= 8 && r.h >= 8; }

/* ---------- Ordner einlesen ---------- */

async function walkHandle(dir, prefix, out) {
  for await (const [name, h] of dir.entries()) {
    if (h.kind === 'directory') {
      if (prefix === '' && name === OUT_DIR) continue;
      await walkHandle(h, prefix + name + '/', out);
    } else {
      out.push({ file: await h.getFile(), rel: prefix + name });
    }
  }
}

function readAllEntries(reader) {
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

async function walkDirEntry(entry, out) {
  const children = await readAllEntries(entry.createReader());
  for (const c of children) {
    await walkChild(c, '', out);
  }
}

async function walkChild(entry, prefix, out) {
  if (entry.isFile) {
    const file = await new Promise((res, rej) => entry.file(res, rej));
    out.push({ file, rel: prefix + entry.name });
  } else if (entry.isDirectory) {
    if (prefix === '' && entry.name === OUT_DIR) return;
    const children = await readAllEntries(entry.createReader());
    for (const c of children) await walkChild(c, prefix + entry.name + '/', out);
  }
}

async function pickFolder() {
  if (window.showDirectoryPicker) {
    try {
      const handle = await window.showDirectoryPicker({ id: 'halfframe', mode: 'read' });
      await loadFromHandle(handle);
    } catch (e) {
      if (e && e.name !== 'AbortError') showMsg('Der Ordner konnte nicht geöffnet werden: ' + e.message, 'error');
    }
  } else {
    $('#fileInput').click();
  }
}

async function loadFromHandle(handle) {
  showMsg('Ordner wird gelesen …');
  const out = [];
  await walkHandle(handle, '', out);
  await loadFiles(out, handle);
}

async function loadFromInput(fileList) {
  const out = [];
  for (const file of fileList) {
    const parts = (file.webkitRelativePath || file.name).split('/');
    const rel = parts.length > 1 ? parts.slice(1).join('/') : parts[0];
    if (rel.startsWith(OUT_DIR + '/')) continue;
    out.push({ file, rel });
  }
  await loadFiles(out, null);
}

async function loadFiles(list, rootHandle) {
  const tiffs = list.filter((x) => TIFF_RE.test(x.rel)).length;
  const imgs = list.filter((x) => IMG_RE.test(x.rel));
  imgs.sort((a, b) => naturalCompare(a.rel, b.rel));

  state.generation++;
  state.lru = [];
  state.root = rootHandle;
  state.items = imgs.map((x, i) => {
    const slash = x.rel.lastIndexOf('/');
    const name = slash >= 0 ? x.rel.slice(slash + 1) : x.rel;
    const dot = name.lastIndexOf('.');
    return {
      id: i, file: x.file, rel: x.rel, name,
      dir: slash >= 0 ? x.rel.slice(0, slash + 1) : '',
      base: dot > 0 ? name.slice(0, dot) : name,
      w: 0, h: 0, pv: null, thumb: null, error: false, uncertain: false,
      s: { ...state.defaults, skip: false },
    };
  });

  if (!state.items.length) {
    showMsg(tiffs
      ? `Es gibt nur TIFF Dateien (${tiffs}). Browser können TIFF nicht lesen. Bitte als JPG oder PNG exportieren und nochmals versuchen.`
      : 'In diesem Ordner liegen keine Bilder (JPG, PNG, WebP).', 'error');
    return;
  }

  let note = '';
  if (tiffs) note = `${tiffs} TIFF Datei${tiffs === 1 ? '' : 'en'} übersprungen, weil Browser TIFF nicht lesen können.`;
  showMsg(note, note ? '' : null);

  $('#welcome').hidden = true;
  $('#workspace').hidden = false;
  buildList();
  updateExportInfo();
  await selectItem(0);
  makeThumbs(state.generation);
}

/* ---------- Liste und Vorschaubilder ---------- */

function buildList() {
  const box = $('#thumbs');
  box.textContent = '';
  state.items.forEach((it, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'thumb';
    b.dataset.i = i;
    const ph = document.createElement('div');
    ph.className = 'ph';
    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = it.rel;
    b.append(ph, nm);
    b.addEventListener('click', () => selectItem(i));
    box.append(b);
    it.el = b;
  });
  updateListHead();
}

function updateListHead() {
  const n = state.items.length;
  const skipped = state.items.filter((i) => i.s.skip).length;
  $('#listHead').textContent = `${n} Bild${n === 1 ? '' : 'er'}` + (skipped ? `, ${skipped} übersprungen` : '');
}

function markItem(it) {
  if (!it.el) return;
  it.el.classList.toggle('skip', !!it.s.skip);
  let flag = it.el.querySelector('.flag');
  const text = it.error ? 'Fehler' : it.uncertain ? 'prüfen' : '';
  if (text) {
    if (!flag) { flag = document.createElement('span'); it.el.append(flag); }
    flag.className = 'flag warn';
    flag.textContent = text;
  } else if (flag) {
    flag.remove();
  }
}

async function makeThumbs(gen) {
  for (const it of state.items) {
    if (gen !== state.generation) return;
    if (it.thumb) continue;
    try {
      const bmp = await createImageBitmap(it.file);
      it.w = bmp.width; it.h = bmp.height;
      const k = 220 / Math.max(bmp.width, bmp.height);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(bmp.width * k));
      c.height = Math.max(1, Math.round(bmp.height * k));
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close();
      it.thumb = c.toDataURL('image/jpeg', 0.7);
      const ph = it.el && it.el.querySelector('.ph');
      if (ph) {
        const img = document.createElement('img');
        img.src = it.thumb;
        img.alt = '';
        ph.replaceWith(img);
      }
    } catch (e) {
      it.error = true;
      markItem(it);
    }
    await new Promise((r) => setTimeout(r, 0));
  }
}

/* ---------- Vorschau ---------- */

async function ensurePreview(it) {
  if (it.pv) return it.pv;
  const full = await createImageBitmap(it.file);
  it.w = full.width; it.h = full.height;
  const k = Math.min(1, PREVIEW_MAX / Math.max(full.width, full.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(full.width * k));
  c.height = Math.max(1, Math.round(full.height * k));
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(full, 0, 0, c.width, c.height);
  full.close();
  it.pv = c;
  state.lru.push(it);
  while (state.lru.length > 6) {
    const old = state.lru.shift();
    if (old !== it) old.pv = null;
  }
  return c;
}

function current() { return state.items[state.cur]; }

async function selectItem(i) {
  if (i < 0 || i >= state.items.length) return;
  state.cur = i;
  const it = current();
  for (const x of state.items) if (x.el) x.el.classList.toggle('cur', x === it);
  if (it.el) it.el.scrollIntoView({ block: 'nearest' });
  $('#counter').textContent = `${i + 1} von ${state.items.length}`;
  $('#fname').textContent = it.rel;
  $('#prev').disabled = i === 0;
  $('#next').disabled = i === state.items.length - 1;
  $('#viewErr').hidden = true;
  try {
    await ensurePreview(it);
    if (current() !== it) return;
    it.error = false;
  } catch (e) {
    it.error = true;
    $('#viewErr').hidden = false;
  }
  markItem(it);
  syncControls();
  redraw();
}

function syncControls() {
  const it = current();
  if (!it) return;
  const s = it.s;
  $('#dir').value = s.dir;
  $('#cut').value = s.cut;
  $('#gap').value = s.gap;
  $('#edge').value = s.edge;
  $('#rot').value = String(s.rot);
  $('#swap').checked = s.swap;
  $('#skip').checked = s.skip;
  updateOutputs();
}

function updateOutputs() {
  $('#cutOut').textContent = Number($('#cut').value).toFixed(1) + ' %';
  $('#gapOut').textContent = Number($('#gap').value).toFixed(1) + ' %';
  $('#edgeOut').textContent = Number($('#edge').value).toFixed(1) + ' %';
  $('#qOut').textContent = $('#quality').value + ' %';
}

function redraw() {
  const it = current();
  const cv = $('#view');
  if (!it || !it.pv) return;
  const pv = it.pv;
  cv.width = pv.width;
  cv.height = pv.height;
  const ctx = cv.getContext('2d');
  ctx.drawImage(pv, 0, 0);

  const k = pv.width / it.w;
  const { dir, raw } = computeParts(it.w, it.h, it.s);
  cv.classList.toggle('h', dir === 'h');
  const sc = raw.map((r) => ({ x: r.x * k, y: r.y * k, w: r.w * k, h: r.h * k }));

  // Alles ausserhalb der beiden Teile abdunkeln
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,.62)';
  ctx.beginPath();
  ctx.rect(0, 0, cv.width, cv.height);
  for (const r of sc) if (r.w > 0 && r.h > 0) ctx.rect(r.x, r.y, r.w, r.h);
  ctx.fill('evenodd');
  ctx.restore();

  const lw = Math.max(2, cv.width / 500);
  const colors = ['#f2b53c', '#5cc8ff'];
  const labels = it.s.swap ? ['B', 'A'] : ['A', 'B'];
  sc.forEach((r, n) => {
    if (r.w <= 0 || r.h <= 0) return;
    ctx.strokeStyle = colors[n];
    ctx.lineWidth = lw;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = colors[n];
    ctx.font = `600 ${Math.round(cv.width / 28)}px system-ui, sans-serif`;
    ctx.fillText(labels[n], r.x + lw * 4, r.y + Math.round(cv.width / 28) + lw * 2);
  });

  // Schnittlinie
  ctx.save();
  ctx.setLineDash([lw * 4, lw * 3]);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = lw;
  ctx.beginPath();
  if (dir === 'v') {
    const x = cv.width * (it.s.cut / 100);
    ctx.moveTo(x, 0); ctx.lineTo(x, cv.height);
  } else {
    const y = cv.height * (it.s.cut / 100);
    ctx.moveTo(0, y); ctx.lineTo(cv.width, y);
  }
  ctx.stroke();
  ctx.restore();

  drawResults(it);
}

function drawResults(it) {
  const pv = it.pv;
  const k = pv.width / it.w;
  const { parts } = computeParts(it.w, it.h, it.s);
  const ids = ['#resA', '#resB'];
  parts.forEach((r, n) => {
    const cv = $(ids[n]);
    if (!validRect(r)) { cv.width = 1; cv.height = 1; return; }
    const sx = r.x * k, sy = r.y * k, sw = r.w * k, sh = r.h * k;
    const rot = it.s.rot;
    const rw = rot % 180 === 0 ? sw : sh;
    const rh = rot % 180 === 0 ? sh : sw;
    const f = Math.min(1, 260 / Math.max(rw, rh));
    cv.width = Math.max(1, Math.round(rw * f));
    cv.height = Math.max(1, Math.round(rh * f));
    const ctx = cv.getContext('2d');
    ctx.save();
    ctx.translate(cv.width / 2, cv.height / 2);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.drawImage(pv, sx, sy, sw, sh, -(sw * f) / 2, -(sh * f) / 2, sw * f, sh * f);
    ctx.restore();
  });
  $('#capA').textContent = 'Bild A: ' + it.base + '_a';
  $('#capB').textContent = 'Bild B: ' + it.base + '_b';
}

/* ---------- Bedienung ---------- */

function readControlsIntoItem() {
  const it = current();
  if (!it) return;
  it.s.dir = $('#dir').value;
  it.s.cut = Number($('#cut').value);
  it.s.gap = Number($('#gap').value);
  it.s.edge = Number($('#edge').value);
  it.s.rot = Number($('#rot').value);
  it.s.swap = $('#swap').checked;
  it.s.skip = $('#skip').checked;
  it.uncertain = false;
  markItem(it);
  updateOutputs();
  updateListHead();
  updateExportInfo();
  redraw();
}

function bindControls() {
  for (const id of ['#dir', '#cut', '#gap', '#edge', '#rot', '#swap', '#skip']) {
    $(id).addEventListener('input', readControlsIntoItem);
  }
  $('#quality').addEventListener('input', updateOutputs);
  $('#fmt').addEventListener('change', () => {
    $('#qualField').hidden = $('#fmt').value !== 'jpeg';
  });

  const cv = $('#view');
  let dragging = false;
  const setFromPointer = (e) => {
    const it = current();
    if (!it || !it.pv) return;
    const rect = cv.getBoundingClientRect();
    const dir = resolveDir(it.w, it.h, it.s);
    const v = dir === 'v' ? (e.clientX - rect.left) / rect.width : (e.clientY - rect.top) / rect.height;
    $('#cut').value = clamp(v * 100, 20, 80).toFixed(1);
    readControlsIntoItem();
  };
  cv.addEventListener('pointerdown', (e) => { dragging = true; cv.setPointerCapture(e.pointerId); setFromPointer(e); });
  cv.addEventListener('pointermove', (e) => { if (dragging) setFromPointer(e); });
  cv.addEventListener('pointerup', () => { dragging = false; });
  cv.addEventListener('pointercancel', () => { dragging = false; });

  $('#prev').addEventListener('click', () => selectItem(state.cur - 1));
  $('#next').addEventListener('click', () => selectItem(state.cur + 1));
  document.addEventListener('keydown', (e) => {
    if ($('#workspace').hidden) return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    if (e.key === 'ArrowLeft') selectItem(state.cur - 1);
    if (e.key === 'ArrowRight') selectItem(state.cur + 1);
  });

  $('#btnAuto').addEventListener('click', async () => {
    const it = current();
    if (!it || !it.pv) return;
    const found = detectSeam(it);
    syncControls();
    redraw();
    showMsg(found ? 'Streifen gefunden. Bitte Schnittlinie prüfen.' : 'Kein klarer Streifen gefunden. Die Linie bleibt, wie sie war.', found ? 'ok' : '');
  });

  $('#btnApplyAll').addEventListener('click', () => {
    const it = current();
    if (!it) return;
    const { skip, ...rest } = it.s;
    state.defaults = { ...rest };
    for (const x of state.items) { x.s = { ...rest, skip: x.s.skip }; x.uncertain = false; markItem(x); }
    redraw();
    showMsg('Einstellungen auf alle Bilder übernommen (ausser «überspringen»).', 'ok');
  });

  $('#btnAutoAll').addEventListener('click', autoAll);
  $('#btnExport').addEventListener('click', exportAll);
  $('#btnCancel').addEventListener('click', () => { state.cancel = true; });
}

/* ---------- Automatische Suche des Streifens ---------- */

/* Sucht in der Bildmitte die Spalte (oder Zeile), die sich am stärksten von ihrer Umgebung abhebt.
   Das ist der Filmsteg zwischen zwei Bildern. Liefert true, wenn etwas Klares gefunden wurde. */
function detectSeam(it) {
  const pv = it.pv;
  const dir = resolveDir(it.w, it.h, it.s);
  const k = Math.min(1, 800 / Math.max(pv.width, pv.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(pv.width * k));
  c.height = Math.max(1, Math.round(pv.height * k));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(pv, 0, 0, c.width, c.height);
  const { data } = ctx.getImageData(0, 0, c.width, c.height);

  const n = dir === 'v' ? c.width : c.height;      // Länge entlang der Schnittachse
  const m = dir === 'v' ? c.height : c.width;      // Länge quer dazu
  const lo = Math.round(m * 0.25), hi = Math.round(m * 0.75);
  const prof = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = lo; j < hi; j++) {
      const x = dir === 'v' ? i : j;
      const y = dir === 'v' ? j : i;
      const p = (y * c.width + x) * 4;
      sum += 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
    }
    prof[i] = sum / (hi - lo);
  }

  const a = Math.round(n * 0.35), b = Math.round(n * 0.65);
  const side = Math.max(4, Math.round(n * 0.04));
  const dev = new Float32Array(n);
  for (let i = a; i < b; i++) {
    const left = [], right = [];
    for (let d = 2; d <= side; d++) {
      if (i - d >= 0) left.push(prof[i - d]);
      if (i + d < n) right.push(prof[i + d]);
    }
    const base = median(left.concat(right));
    dev[i] = Math.abs(prof[i] - base);
  }
  // leicht glätten
  let best = -1, bestV = 0;
  for (let i = a + 1; i < b - 1; i++) {
    const v = (dev[i - 1] + dev[i] + dev[i + 1]) / 3;
    if (v > bestV) { bestV = v; best = i; }
  }
  if (best < 0 || bestV < 8) {
    it.uncertain = true;
    markItem(it);
    return false;
  }
  // Breite des Streifens: so lange die Abweichung über der Hälfte des Maximums bleibt
  let l = best, r = best;
  while (l > a && dev[l - 1] > bestV * 0.5) l--;
  while (r < b - 1 && dev[r + 1] > bestV * 0.5) r++;
  const mid = (l + r + 1) / 2;
  const half = (r - l + 1) / 2;
  it.s.cut = clamp((mid / n) * 100, 20, 80);
  it.s.gap = clamp((half / n) * 100, 0, 6);
  it.uncertain = false;
  markItem(it);
  return true;
}

function median(arr) {
  if (!arr.length) return 0;
  const s = arr.slice().sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}

async function autoAll() {
  if (state.busy) return;
  state.busy = true;
  const gen = state.generation;
  const keep = state.cur;
  let found = 0, miss = 0;
  const prog = $('#prog'), txt = $('#progText');
  prog.hidden = false; txt.hidden = false;
  prog.max = state.items.length;
  for (let i = 0; i < state.items.length; i++) {
    if (gen !== state.generation) break;
    const it = state.items[i];
    prog.value = i;
    txt.textContent = `Suche Streifen: ${i + 1} von ${state.items.length}`;
    try {
      await ensurePreview(it);
      if (detectSeam(it)) found++; else miss++;
    } catch (e) {
      it.error = true; markItem(it); miss++;
    }
    await new Promise((r) => setTimeout(r, 0));
  }
  prog.hidden = true; txt.hidden = true;
  state.busy = false;
  await selectItem(keep);
  showMsg(miss
    ? `Streifen bei ${found} Bildern gefunden, bei ${miss} nicht. Bilder mit «prüfen» bitte von Hand ansehen.`
    : `Streifen bei allen ${found} Bildern gefunden. Bitte stichprobenweise prüfen.`, miss ? '' : 'ok');
}

/* ---------- Export ---------- */

function updateExportInfo() {
  const n = state.items.filter((i) => !i.s.skip).length;
  let t = `${n} Bild${n === 1 ? '' : 'er'} werden zu ${n * 2} Dateien.`;
  t += window.showDirectoryPicker && state.root
    ? ` Gespeichert wird im Unterordner «${OUT_DIR}» des gewählten Ordners. Der Browser fragt dafür einmal nach der Erlaubnis zum Schreiben.`
    : ' Die Ergebnisse kommen als ZIP Dateien in den Download Ordner.';
  $('#exportInfo').textContent = t;
}

async function renderPartBlob(bmp, r, rot, type, quality) {
  const rw = rot % 180 === 0 ? r.w : r.h;
  const rh = rot % 180 === 0 ? r.h : r.w;
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(rw, rh) : Object.assign(document.createElement('canvas'), { width: rw, height: rh });
  const ctx = canvas.getContext('2d');
  if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, rw, rh); }
  ctx.translate(rw / 2, rh / 2);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.drawImage(bmp, r.x, r.y, r.w, r.h, -r.w / 2, -r.h / 2, r.w, r.h);
  if (canvas.convertToBlob) return canvas.convertToBlob({ type, quality });
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Kein Bild erzeugt'))), type, quality));
}

async function getOutDir(path) {
  let dir = await state.root.getDirectoryHandle(OUT_DIR, { create: true });
  for (const seg of path.split('/').filter(Boolean)) dir = await dir.getDirectoryHandle(seg, { create: true });
  return dir;
}

async function writeFile(dir, name, blob) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(blob);
  await w.close();
}

async function exportAll() {
  if (state.busy) return;
  const todo = state.items.filter((i) => !i.s.skip);
  if (!todo.length) { showMsg('Alle Bilder sind übersprungen. Es gibt nichts zu speichern.', 'error'); return; }

  const fmt = $('#fmt').value;
  const type = fmt === 'png' ? 'image/png' : 'image/jpeg';
  const ext = fmt === 'png' ? 'png' : 'jpg';
  const quality = Number($('#quality').value) / 100;

  // Zielart bestimmen: Ordner schreiben, wenn der Browser es kann und die Erlaubnis kommt, sonst ZIP
  let toFolder = false;
  if (window.showDirectoryPicker && state.root && state.root.requestPermission) {
    try {
      toFolder = (await state.root.requestPermission({ mode: 'readwrite' })) === 'granted';
    } catch (e) { toFolder = false; }
    if (!toFolder) showMsg('Keine Schreiberlaubnis. Die Ergebnisse kommen stattdessen als ZIP Dateien.', '');
  }

  state.busy = true;
  state.cancel = false;
  const prog = $('#prog'), txt = $('#progText');
  prog.hidden = false; txt.hidden = false; $('#btnCancel').hidden = false;
  $('#btnExport').disabled = true; $('#btnAutoAll').disabled = true;
  prog.max = todo.length; prog.value = 0;

  const failed = [];
  let files = 0, zip = null, zipNo = 0, zipBytes = 0;
  const usedNames = new Set();

  const flushZip = () => {
    if (!zip || !zip.count) return;
    zipNo++;
    downloadBlob(zip.finish(), `halfframe_${String(zipNo).padStart(2, '0')}.zip`);
    zip = null; zipBytes = 0;
  };

  try {
    for (let i = 0; i < todo.length; i++) {
      if (state.cancel) break;
      const it = todo[i];
      prog.value = i;
      txt.textContent = `Schneide ${i + 1} von ${todo.length}: ${it.rel}`;
      let bmp;
      try {
        bmp = await createImageBitmap(it.file);
        const { parts } = computeParts(bmp.width, bmp.height, it.s);
        if (!parts.every(validRect)) throw new Error('Schnitt ergibt ein zu kleines Bild');
        const letters = ['a', 'b'];
        for (let n = 0; n < 2; n++) {
          const blob = await renderPartBlob(bmp, parts[n], it.s.rot, type, quality);
          let name = `${it.base}_${letters[n]}.${ext}`;
          const key = it.dir + name;
          if (usedNames.has(key.toLowerCase())) name = `${it.base}_${it.id}_${letters[n]}.${ext}`;
          usedNames.add((it.dir + name).toLowerCase());
          if (toFolder) {
            await writeFile(await getOutDir(it.dir), name, blob);
          } else {
            if (!zip) zip = new ZipBuilder();
            await zip.addFile(it.dir + name, blob);
            zipBytes += blob.size;
            if (zipBytes >= ZIP_BATCH_BYTES) flushZip();
          }
          files++;
        }
      } catch (e) {
        failed.push(`${it.rel} (${e.message || e})`);
      } finally {
        if (bmp) bmp.close();
      }
      await new Promise((r) => setTimeout(r, 0));
    }
    flushZip();
  } catch (e) {
    failed.push('Abbruch: ' + (e.message || e));
  }

  prog.hidden = true; txt.hidden = true; $('#btnCancel').hidden = true;
  $('#btnExport').disabled = false; $('#btnAutoAll').disabled = false;
  state.busy = false;

  let msg = state.cancel ? `Abgebrochen. ${files} Dateien sind fertig.` : `Fertig: ${files} Dateien.`;
  if (toFolder) msg += ` Sie liegen im Unterordner «${OUT_DIR}».`;
  else if (zipNo) msg += ` ${zipNo} ZIP Datei${zipNo === 1 ? '' : 'en'} im Download Ordner.`;
  if (failed.length) msg += ` Probleme bei ${failed.length} Bild${failed.length === 1 ? '' : 'ern'}: ${failed.slice(0, 5).join('; ')}${failed.length > 5 ? ' …' : ''}`;
  showMsg(msg, failed.length || state.cancel ? 'error' : 'ok');
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 120000);
}

/* ---------- ZIP (ohne Kompression, reicht für Bilder) ---------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

class ZipBuilder {
  constructor() { this.parts = []; this.central = []; this.offset = 0; this.count = 0; this.enc = new TextEncoder(); }
  async addFile(name, blob) {
    const data = new Uint8Array(await blob.arrayBuffer());
    const nameBytes = this.enc.encode(name);
    const crc = crc32(data);
    const d = new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();

    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true);
    lh.setUint16(8, 0, true);
    lh.setUint16(10, time, true);
    lh.setUint16(12, date, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true);
    lh.setUint32(22, data.length, true);
    lh.setUint16(26, nameBytes.length, true);
    lh.setUint16(28, 0, true);

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true);
    ch.setUint16(12, time, true);
    ch.setUint16(14, date, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true);
    ch.setUint32(24, data.length, true);
    ch.setUint16(28, nameBytes.length, true);
    ch.setUint32(42, this.offset, true);

    this.parts.push(lh.buffer, nameBytes, data);
    this.central.push(ch.buffer, nameBytes);
    this.offset += 30 + nameBytes.length + data.length;
    this.count++;
  }
  finish() {
    let centralSize = 0;
    for (const p of this.central) centralSize += p.byteLength;
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, this.count, true);
    end.setUint16(10, this.count, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, this.offset, true);
    return new Blob([...this.parts, ...this.central, end.buffer], { type: 'application/zip' });
  }
}

/* ---------- Start ---------- */

function init() {
  bindControls();
  updateOutputs();

  $('#btnPick').addEventListener('click', pickFolder);
  $('#fileInput').addEventListener('change', async (e) => {
    const list = [...e.target.files];
    e.target.value = '';
    if (list.length) await loadFromInput(list);
  });

  if (!window.showDirectoryPicker) {
    showMsg('Dieser Browser kann nicht direkt in Ordner schreiben. Die Ergebnisse kommen als ZIP Dateien. Mit Chrome, Edge oder Brave am Computer geht es direkt.', '');
  }

  const drop = $('#welcome');
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  for (const ev of ['dragenter', 'dragover']) {
    document.addEventListener(ev, (e) => { stop(e); drop.classList.add('over'); });
  }
  for (const ev of ['dragleave']) {
    document.addEventListener(ev, (e) => { stop(e); if (!e.relatedTarget) drop.classList.remove('over'); });
  }
  document.addEventListener('drop', async (e) => {
    stop(e);
    drop.classList.remove('over');
    const item = e.dataTransfer && e.dataTransfer.items && e.dataTransfer.items[0];
    // Beides sofort holen, danach ist das Drop Objekt nicht mehr gültig
    const handleP = item && item.getAsFileSystemHandle ? item.getAsFileSystemHandle() : null;
    const entry = item && item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
    const plainFiles = [...(e.dataTransfer.files || [])];
    try {
      if (handleP) {
        const h = await handleP;
        if (h && h.kind === 'directory') { await loadFromHandle(h); return; }
      }
      if (entry && entry.isDirectory) {
        showMsg('Ordner wird gelesen …');
        const out = [];
        await walkDirEntry(entry, out);
        await loadFiles(out, null);
        return;
      }
      if (plainFiles.length) await loadFiles(plainFiles.map((f) => ({ file: f, rel: f.name })), null);
    } catch (err) {
      showMsg('Das Ablegen hat nicht geklappt: ' + (err.message || err), 'error');
    }
  });
}

init();
