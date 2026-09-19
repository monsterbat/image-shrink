/* 照片縮小器 —— 全部在瀏覽器裡跑,照片不會上傳到任何地方。
 *
 * 演算法(為什麼這樣做,見 ../DESIGN.md):
 *   1. 先試「原尺寸」,用二分法找「還放得進目標大小」的最高 JPG 品質。
 *   2. 品質 >= QUALITY_FLOOR(0.68)就收工 —— 保住最大解析度。
 *   3. 達不到就等比例縮一階再試(3000→2400→2000→…→640 長邊)。
 *      全程只等比例縮放,不裁切。
 *   4. 一階都撐不住 → 回報做不到,不假裝成功。
 */

const QUALITY_FLOOR = 0.68;      // 低於這個就寧可縮尺寸,不硬壓品質
const Q_MIN = 0.30, Q_MAX = 0.95;
const SIDE_LADDER = [3000, 2400, 2000, 1600, 1280, 1024, 800, 640, 512, 400, 320];
const MAX_CANVAS_PX = 16000000;  // Safari 的 canvas 面積上限,超過 toBlob 會回 null

const $ = (s) => document.querySelector(s);
const listEl = $('#list'), barEl = $('#bar'), tallyEl = $('#tally'), hintEl = $('#hint');

let targetBytes = 1048576;
let results = [];   // {name, blob, url}

/* ── 目標大小的按鈕 ───────────────────────────────────────────── */
$('#sizes').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  targetBytes = Number(chip.dataset.bytes);
  $('#custom').value = '';
  paintChips(chip);
});
$('#custom').addEventListener('input', (e) => {
  const kb = Number(e.target.value);
  if (kb >= 20) { targetBytes = Math.round(kb * 1024); paintChips(null); }
});
function paintChips(active) {
  document.querySelectorAll('.chip').forEach(c =>
    c.setAttribute('aria-pressed', String(c === active)));
}

/* ── 拖曳 / 選檔 ─────────────────────────────────────────────── */
const drop = $('#drop'), fileInput = $('#file');
drop.addEventListener('click', () => fileInput.click());
drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });
fileInput.addEventListener('change', () => { handle([...fileInput.files]); fileInput.value = ''; });

['dragenter', 'dragover'].forEach(ev =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('hot'); }));
['dragleave', 'drop'].forEach(ev =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('hot'); }));
drop.addEventListener('drop', (e) => handle([...(e.dataTransfer?.files || [])]));

// 丟到頁面任何地方也算 —— 不要讓瀏覽器把圖片直接開起來取代這一頁
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  if (!drop.contains(e.target)) handle([...(e.dataTransfer?.files || [])]);
});

/* ── 主流程 ──────────────────────────────────────────────────── */
async function handle(files) {
  files = files.filter(f => f && f.size > 0);
  if (!files.length) return;
  hintEl.hidden = true;
  barEl.hidden = false;

  for (const file of files) {
    const row = addRow(file.name);
    try {
      const out = await shrink(file, targetBytes);
      showDone(row, file, out);
    } catch (err) {
      showFail(row, file, err);
    }
  }
  updateTally();
}

async function shrink(file, target) {
  const label = sizeLabel(target);
  const base = file.name.replace(/\.[^.]+$/, '');
  const heic = await looksHeic(file);

  // 本來就夠小,而且格式本來就通用 → 原檔照抄,一個位元都不要重壓
  if (file.size <= target && !heic && /^image\/(jpeg|png)$/.test(file.type)) {
    return { blob: file, name: file.name, untouched: true };
  }

  const img = await loadImage(file, heic);
  const best = await search(img, target);
  if (!best) {
    throw new Error(`就算縮到 ${SIDE_LADDER.at(-1)} 像素、品質壓到最低,還是超過 ${label}`);
  }
  return {
    blob: best.blob, name: `${base}_${label}.jpg`,
    w: best.w, h: best.h, quality: best.quality,
    srcW: img.naturalWidth, srcH: img.naturalHeight,
  };
}

async function search(img, target) {
  const w0 = img.naturalWidth, h0 = img.naturalHeight;
  let longest = Math.max(w0, h0);

  // Safari 的 canvas 面積上限:超過就先縮到剛好在限制內,不然 toBlob 會安靜地回 null
  if (w0 * h0 > MAX_CANVAS_PX) longest = Math.floor(longest * Math.sqrt(MAX_CANVAS_PX / (w0 * h0)));

  const ladder = [longest, ...SIDE_LADDER.filter(s => s < longest)];
  let fallback = null;

  for (const side of ladder) {
    const r = side / Math.max(w0, h0);
    const w = Math.max(1, Math.round(w0 * r)), h = Math.max(1, Math.round(h0 * r));
    const canvas = drawScaled(img, w, h);

    let blob = await toBlob(canvas, Q_MAX);
    if (blob && blob.size <= target) return { blob, w, h, quality: Q_MAX };

    blob = await toBlob(canvas, Q_MIN);
    if (!blob || blob.size > target) continue;      // 這個尺寸怎麼壓都塞不下,縮一階再來

    let lo = Q_MIN, hi = Q_MAX, best = { blob, w, h, quality: Q_MIN };
    for (let i = 0; i < 7; i++) {                   // 二分法找放得下的最高品質
      const mid = (lo + hi) / 2;
      const b = await toBlob(canvas, mid);
      if (b && b.size <= target) { lo = mid; best = { blob: b, w, h, quality: mid }; }
      else hi = mid;
    }
    if (best.quality >= QUALITY_FLOOR) return best;
    if (!fallback || best.quality > fallback.quality) fallback = best;
  }
  return fallback;
}

/* 一次直接縮到位會有鋸齒 —— 每次最多砍一半,畫面乾淨很多 */
function drawScaled(img, w, h) {
  let cw = img.naturalWidth, ch = img.naturalHeight;
  let src = img;
  while (cw > w * 2 && ch > h * 2) {
    cw = Math.max(w, Math.round(cw / 2));
    ch = Math.max(h, Math.round(ch / 2));
    src = paint(src, cw, ch);
  }
  return paint(src, w, h);
}
function paint(src, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';        // PNG 的透明區壓成 JPG 會變黑,先鋪白底
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  return c;
}
const toBlob = (canvas, q) => new Promise(res => canvas.toBlob(res, 'image/jpeg', q));

/* ── 讀圖(含 HEIC)──────────────────────────────────────────── */
async function looksHeic(file) {
  if (/\.(heic|heif)$/i.test(file.name)) return true;
  if (/^image\/hei[cf]/.test(file.type)) return true;
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (head.length < 12) return false;
  const box = String.fromCharCode(...head.slice(4, 8));
  const brand = String.fromCharCode(...head.slice(8, 12));
  return box === 'ftyp' && /^(heic|heix|hevc|hevx|mif1|msf1|heim|heis|hevm|hevs)$/.test(brand);
}

let heicLib = null;
function loadHeicLib() {
  if (heicLib) return heicLib;
  heicLib = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'vendor/heic-to.js';
    s.onload = () => (window.HeicTo ? res(window.HeicTo) : rej(new Error('HEIC 解碼程式載入了但沒生效')));
    s.onerror = () => rej(new Error('找不到 vendor/heic-to.js,HEIC 解不開'));
    document.head.appendChild(s);
  });
  return heicLib;
}

async function loadImage(file, heic) {
  let blob = file;
  if (heic) {
    // Safari 自己就看得懂 HEIC,先讓它試 —— 省下 2.9MB 的解碼程式
    if (!(await canDecodeNatively(file))) {
      const HeicTo = await loadHeicLib();
      blob = await HeicTo({ blob: file, type: 'image/jpeg', quality: 0.95 });
    }
  }
  return await asImg(blob);
}
async function canDecodeNatively(file) {
  try { await asImg(file); return true; } catch { return false; }
}
function asImg(blob) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    // <img> 預設就會照 EXIF 把直拍的照片轉正,不必自己處理方向
    img.onload = () => { URL.revokeObjectURL(url); img.naturalWidth ? res(img) : rej(new Error('讀不到這張圖')); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('這個檔案瀏覽器打不開')); };
    img.src = url;
  });
}

/* ── 畫面 ────────────────────────────────────────────────────── */
function addRow(name) {
  const el = document.createElement('div');
  el.className = 'item';
  el.innerHTML = `<img alt=""><div class="meta"><div class="name"></div>
    <div class="line2">處理中…</div></div>`;
  el.querySelector('.name').textContent = name;
  listEl.appendChild(el);
  return el;
}
function showDone(row, file, out) {
  const url = URL.createObjectURL(out.blob);
  results.push({ name: out.name, url });
  row.querySelector('img').src = url;
  row.querySelector('.name').textContent = out.name;

  const l2 = row.querySelector('.line2');
  if (out.untouched) {
    l2.innerHTML = `<span class="ok">本來就夠小</span> · ${kb(file.size)} · 沒有重壓,原檔照給`;
  } else {
    const shrunk = out.w < out.srcW;
    // HEIC 比 JPG 省空間,轉成 JPG 有可能反而變大 —— 只要還在目標以內就是對的,但不以綠色標示為「變小」
    const grew = out.blob.size > file.size;
    l2.innerHTML =
      `<span class="${grew ? 'warn' : 'ok'}">${kb(file.size)} → ${kb(out.blob.size)}</span>` +
      (grew ? '(HEIC 轉成 JPG 會變大,這是正常的,還是在目標以內)' : '') +
      ` · ${out.srcW}×${out.srcH}${shrunk ? ` → ${out.w}×${out.h}` : '(尺寸沒動)'}` +
      ` · 品質 ${Math.round(out.quality * 100)}` +
      (out.quality < QUALITY_FLOOR ? ' <span class="warn">(壓得比較兇,先看一眼)</span>' : '');
  }
  const a = document.createElement('a');
  a.className = 'dl'; a.href = url; a.download = out.name; a.textContent = '下載';
  row.appendChild(a);
}
function showFail(row, file, err) {
  row.querySelector('.line2').innerHTML =
    `<span class="bad">做不到</span> · ${escapeHtml(err.message || String(err))}`;
}
function updateTally() {
  tallyEl.textContent = results.length ? `${results.length} 張好了,目標 ${sizeLabel(targetBytes)} 以下` : '';
  $('#dlAll').disabled = !results.length;
}

$('#dlAll').addEventListener('click', () => {
  // 瀏覽器會問一次「要允許一次下載多個檔案嗎」,按允許
  results.forEach((r, i) => setTimeout(() => {
    const a = document.createElement('a');
    a.href = r.url; a.download = r.name;
    document.body.appendChild(a); a.click(); a.remove();
  }, i * 250));
});
$('#clear').addEventListener('click', () => {
  results.forEach(r => URL.revokeObjectURL(r.url));
  results = []; listEl.innerHTML = ''; barEl.hidden = true; hintEl.hidden = false;
});

/* ── 小工具 ──────────────────────────────────────────────────── */
function kb(n) {
  return n >= 1048576 ? (n / 1048576).toFixed(2) + ' MB' : Math.round(n / 1024) + ' KB';
}
function sizeLabel(n) {
  return n % 1048576 === 0 ? (n / 1048576) + 'MB' : Math.round(n / 1024) + 'KB';
}
function escapeHtml(s) {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
