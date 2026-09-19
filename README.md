# Image Shrink

[English](#english) | [繁體中文](#繁體中文)

<a id="english"></a>

## English

Compress photos to fit under a target file size, such as a 1 MB upload limit, directly in the browser.
Nothing is uploaded: every image is processed locally on the user's device.

### Features

- **Target-size compression**: choose 500 KB, 1 MB, 2 MB, 4 MB, or a custom size in KB.
- **No cropping**: images are only scaled proportionally, so the composition stays intact.
- **HEIC support**: iPhone photos (`.heic`) are decoded in the browser.
- **Batch processing**: drop many files at once, then download them one by one or all together.
- **Metadata removal**: re-encoding drops GPS location and camera information from the output.
- **Honest failure**: if a photo cannot reach the target size, the tool reports it instead of returning an oversized file.

### Usage

1. Open `web/index.html` in a modern browser, or serve the `web/` folder with any static file server.
2. Select the target size.
3. Drag photos onto the drop zone. Compression starts automatically.
4. Download each result, or use **Download all**.

Output files are JPEG and are named `<original name>_<target>.jpg`. The original files are never modified.
The user interface is in Traditional Chinese.

### How it works

1. **Keep the resolution if possible.** The original size is tried first, and a binary search finds the highest JPEG quality that still fits the target.
2. **Stop at a quality floor.** If that quality is at least 0.68, the result is accepted at full resolution.
3. **Otherwise scale down in steps.** The long edge is reduced step by step (3000, 2400, 2000, … down to 640 px) and the search runs again.
4. **Resize without aliasing.** Each resize halves the image at most once per pass, which keeps edges clean.
5. **Skip unnecessary work.** A file that is already small enough and in a widely supported format is returned unchanged.
6. **Respect browser limits.** Very large images are first reduced to fit Safari's canvas size limit, which would otherwise fail silently.

HEIC files are decoded natively when the browser supports it (Safari).
Other browsers load the bundled decoder on demand, so it is only downloaded when a HEIC file is added.

### Tech stack

- Vanilla JavaScript, HTML, and CSS, with no framework and no build step
- Canvas API for resizing and JPEG encoding
- [heic-to](https://github.com/hoppergee/heic-to) 1.5.2 for HEIC decoding (bundled in `web/vendor/`)

### License

- Application code: MIT License. See [LICENSE](LICENSE).
- `web/vendor/heic-to.js`: GNU LGPL v3.0. See [web/vendor/heic-to.LICENSE.txt](web/vendor/heic-to.LICENSE.txt).

---

<a id="繁體中文"></a>

## 繁體中文

**Image Shrink(照片縮小器)**

在瀏覽器中把照片壓縮到指定的檔案大小以下,例如上傳限制為 1 MB 的表單。
所有處理都在使用者自己的裝置上完成,照片不會上傳到任何伺服器。

### 功能

- **指定目標大小**:可選 500 KB、1 MB、2 MB、4 MB,或自訂 KB 數。
- **不裁切**:只做等比例縮放,構圖維持不變。
- **支援 HEIC**:iPhone 拍攝的 `.heic` 照片可直接在瀏覽器中解碼。
- **批次處理**:一次放入多張照片,可逐張下載,也可全部下載。
- **移除中繼資料**:重新編碼時會去除 GPS 位置與相機資訊。
- **明確回報失敗**:照片無法壓到目標大小時會直接說明,不會輸出仍然超過上限的檔案。

### 使用方式

1. 以現代瀏覽器開啟 `web/index.html`,或用任何靜態檔案伺服器提供 `web/` 資料夾。
2. 選擇目標大小。
3. 把照片拖曳到放置區,壓縮會自動開始。
4. 逐張下載,或按「全部下載」。

輸出一律為 JPEG,檔名為 `<原檔名>_<目標大小>.jpg`,原始檔案不會被修改。介面語言為繁體中文。

### 運作原理

1. **盡量保留解析度**:先以原尺寸嘗試,用二分搜尋找出仍符合目標大小的最高 JPEG 品質。
2. **品質下限**:品質不低於 0.68 就採用,保留完整解析度。
3. **逐階縮小**:未達標時,把長邊依序縮為 3000、2400、2000……直到 640 px,每一階重新搜尋。
4. **避免鋸齒**:每次縮放最多縮小一半,讓邊緣保持平滑。
5. **略過不必要的處理**:已經符合大小、格式也通用的檔案,直接回傳原檔。
6. **遵守瀏覽器限制**:超大圖片會先縮到 Safari 的 canvas 面積上限內,避免在沒有錯誤訊息的情況下失敗。

瀏覽器原生支援 HEIC 時(Safari)直接解碼;其他瀏覽器只在加入 HEIC 檔案時才載入內附的解碼器。

### 技術

- 原生 JavaScript、HTML、CSS,不使用框架,不需要建置
- 以 Canvas API 縮放並編碼 JPEG
- HEIC 解碼:[heic-to](https://github.com/hoppergee/heic-to) 1.5.2(內附於 `web/vendor/`)

### 授權

- 程式碼:MIT License,見 [LICENSE](LICENSE)。
- `web/vendor/heic-to.js`:GNU LGPL v3.0,見 [web/vendor/heic-to.LICENSE.txt](web/vendor/heic-to.LICENSE.txt)。
