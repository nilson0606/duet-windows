# Windows 版開發交接：合拍 DUET

## 交接目的

使用者要以目前 iPhone 版為基礎，開發 Windows 版。本次只建立交接文件，尚未建立 Windows 專案、修改 Windows 功能或發布 Windows 網站。

**最重要基準：「20260910 重要還原點」＝已發布第 17 版。請保留 iPhone 版及所有還原點，Windows 開發放在獨立目錄／分支與獨立發布目標。**

「Windows 版」目前未明確指定是 Windows Chrome／Edge 網頁版，還是可安裝桌面程式。建議先沿用現有網頁架構建立 Windows 瀏覽器版；這是交接建議，不是使用者已選定的交付形式。若打算改為 Electron、Tauri 或本機 FFmpeg 後端，先確認交付形式，不要直接重寫。

## 精確基準與還原資訊

| 項目 | 值 |
| --- | --- |
| iPhone 原始碼目錄 | `D:/iphone_2movie_align` |
| 重要還原標籤 | `restore-20260910-important` |
| 基準 commit | `e52f852488423422d55315aef0a93b6dbe92f297` |
| 已發布版本 | 第 17 版 |
| 現有網站 | https://duet-video-align.nilson-hsu.chatgpt.site |
| iPhone Sites project ID | `appgprj_6aa2509bc2f48191bfaa849d312ec7bd` |
| 第 17 版 version ID | `appgprj_6aa2509bc2f48191bfaa849d312ec7bd~appgver_fb44d045c70881918fd3d06f13df5da3` |
| 成功 deployment ID | `appgdep_6aa2a268fc64819184a5d39bb961c074` |

其他保留標籤：

- `restore-0910`：第 15 版，尚未加入雙影片試聽。
- `restore-2026-09-10-auto-match-recrop`：第 13 版。
- `restore-2026-09-10-aligned-crop-ok`：更早的還原點；如需使用，先檢視標籤內容。

**`restore-0910` 與 `restore-20260910-important` 不是同一版。Windows 起點應使用後者。**

這些還原標籤已在本機 Git 建立並驗證；本次未將標籤推送遠端。第 17 版原始碼與部署產物已另存於 Sites。交接文件不屬於上述基準 commit；複製／checkout 基準後，請另外保留本文件。

現有 `.openai/hosting.json` 綁定 iPhone 正式網站。建立 Windows 獨立專案時，**不要沿用這個 project ID 來發布 Windows 改版**。新目標確定後，依 Sites 流程註冊自己的網站；不要改掉原 iPhone 專案的設定。

## 使用者已確認的功能與規則

### 音樂對齊

- 兩部影片通常播放相同音樂，但可能混有拍手、老師說話、不同開頭或尾段。
- 用全段音樂搜尋時間差；清楚且可信的局部片段能確認時間差即可成功，不能因後段不同就直接否決。
- 選項是「自動、1 秒、2 秒、3 秒、4 秒、5 秒」，初始就看得到，預設「自動」。
- 「自動」內部數值仍為 `0`，不是只比 0 秒，也不是要求零時間差。
- 1～5 秒指定局部確認片段長度，不限制整體搜尋範圍；換選項可以重試。
- 靜音、無關聲音、重複片段造成歧義時，不能硬判成功。保留手動設定時間差。
- 編輯 offset > 0：裁掉 A 開頭 offset 秒；offset < 0：裁掉 B 開頭的絕對值。
- 保留較長影片的剩餘尾段，較短影片結束後，其矩形區域是不透明黑幕，即使在上層也不能透出下層。
- 融合只保留使用者選定 A 或 B 的一條音軌；該音軌結束後靜音。

### 畫面配置與裁切

- 可選橫式、直式、方形畫布；兩影片可拖曳、縮放、獨立調寬高、鎖比例、調圖層。
- 畫面裁切與開頭時間裁切是不同功能。
- 每部影片第一次顯示「裁切」，套用過才顯示「重新裁切」。只展開後取消不算套用。
- A、B 各自記錄，透過該來源是否已有 `crop` 判斷。展開時顯示「收起裁切」。
- 裁切參考圖固定取對齊後時間 0 的影格；瀏覽後面的時間軸不替換這張參考圖。

### 獨立雙影片試聽

這是使用者明確強調的**獨立功能**，不能自動連動主編輯器：

- A、B 各一個小畫面，主要是聽聲音；可各自播放／暫停、拖動各自位置。
- 可依試聽專用時間差與共同位置「同時播放」，也可「全部暫停」。
- 試聽時間差不寫入編輯 offset，不改自動對齊結果、裁切、排版或融合結果。
- 不需先按自動對齊或先輸出成品。
- 第 17 版同時播放使用**兩個 AudioBufferSourceNode，共用同一 AudioContext 的 start 時間**；各自套用試聽起點。
- 小畫面保持靜音，只提供視覺預覽；音訊不依賴兩個 video 元素能否同時持續播放。
- 首次同時試聽先讀取兩部聲音，優先快速解碼，失敗則逐片原速擷取。顯示進度，可取消，完成後使用專用快取重播。
- 未準備 PCM 時，單片試聽可走原生播放器；已有 PCM 後可分別操作緩衝音訊。
- 換來源重設試聽；背景切換或其他處理開始時暫停。仍不把試聽的值套回編輯。

## 重要失敗經驗：不要退回舊做法

1. **整個 iPhone MOV 交給 `decodeAudioData` 曾出現 `EncodingError: decoding failed`。**
   匯入現在只用原生 video 讀 metadata／縮圖，音訊工作延後到明確操作。MP4 是封裝，改副檔名或重封裝不代表音訊編碼變了。尚未取得使用者失敗原檔，不能斷言一定是某種 codec。

2. **真正差約 2 秒，卻誤判裁 0.06 秒。**
   以已知 2.34 秒素材，分別加入 0.18／0.12 秒開頭靜音，重現同樣問題。靜音切換的 log 能量跳變壓過音樂訊號。現在排除靜音與過渡 FFT 視窗，保留原始時間索引。不要把靜音移除再拼接，否則時間差會改變。

3. **兩個有聲 video 直接一起播，在使用者 iPhone 上有一個被暫停。**
   第 16 版出現「其中一部影片未持續播放」。第 17 版改成共用音訊時鐘，靜音 video 只做畫面。不要只刪掉錯誤提示，也不要回到兩個原生有聲播放器啟播即假設同步。Windows 也應保留共用時鐘的音訊設計。

4. **正式 Worker URL 曾被 SSR 固定成 `file:///ROOT/...`。**
   使用 Vite 的 `?worker&url`，在瀏覽器端以 `new URL(workerUrl, window.location.href)` 建立 Worker。保留正式產物驗證。

5. **MediaElementAudioSourceNode 不能對同一 video 重複建立。**
   `player-audio.ts` 以 WeakMap 保存來源與 context，重試與輸出沿用。試聽有自己的 video／context，不能拿主編輯的來源元素來共用操作。

## 程式架構與入口

下表路徑均相對於 `D:/iphone_2movie_align`；移植後以 Windows 新專案根目錄解析。

| 檔案 | 用途 |
| --- | --- |
| `app/page.tsx` | 匯入、主編輯 offset、音樂選項、配置、融合流程 |
| `app/globals.css` | 深色介面與手機／桌面樣式 |
| `app/crop-editor.tsx`、`lib/crop.ts` | 畫面裁切控制與來源矩形運算 |
| `lib/timeline.mjs` | offset 正負、共同片段、剩餘片長定義 |
| `lib/alignment.mjs` | 六頻帶特徵、FFT 搜尋、局部唯一性確認、靜音修正 |
| `app/align.worker.ts`、`lib/align-clips.ts` | 音樂比對 Worker 與生命週期 |
| `app/decode-audio.worker.ts`、`lib/decode-audio-track.ts` | Mediabunny 抽音軌、WebCodecs／PCM 解碼 |
| `lib/fast-audio.ts` | 快速 Worker 管理、12 秒無進度／45 秒總逾時、錯誤備援 |
| `lib/capture-audio.ts`、`public/audio-capture.worklet.js` | 原生播放器音訊擷取備援、取消、進度、快取 |
| `lib/audio-samples.ts` | 依媒體時間戳定位並降採樣至 16 kHz |
| `lib/player-audio.ts` | 每個 video 唯一音訊來源與釋放 |
| `lib/media.ts` | Clip、載入／釋放、定位、縮圖、Canvas 合成、輸出 MIME 選擇 |
| `lib/render-movie.ts` | Canvas＋Web Audio＋MediaRecorder 融合與輸出 |
| `app/audio-audition.tsx` | 獨立試聽 UI、專用音訊讀取與狀態 |
| `lib/audition-player.ts` | 單片／共用時鐘播放、PCM 快取、暫停／取消、畫面校正 |
| `lib/media-deadline.ts` | 非同步媒體等待的逾時與取消 |
| `tests/` | 音訊、裁切、輸出、試聽與生命週期測試 |
| `scripts/verify-worker-build.mjs` | 正式 Worker URL、實際編譯後比對與 MOV 音軌解碼驗證 |
| `public/demo/camera-a.mp4`、`camera-b.mp4` | 有已知時間差的測試影片 |

核心依賴：React 19.2.6、Vinext 1.0.0-beta.5、Vite 8.0.13、TypeScript 5.9.3、Mediabunny 1.56.1。保留 `package-lock.json`，不要為移植任意升級所有套件。

快速音軌路徑只解碼音訊，不轉碼影像；presentation timestamp（包含 edit list）必須保留。相容擷取也依媒體時間定位樣本，不按資料抵達時間排列。

主融合目前是即時錄製：開始前定位一次，之後原速播放，不持續 seek／調速。**試聽畫面可依聲音校正位置，不代表主融合也可套用同樣校正策略。**

## Windows 版建議落地順序

這些是尚未實作的移植建議，不能當成現有功能：

1. 從重要還原點建立獨立專案，先跑通既有測試與素材；確認原 iPhone checkout、還原標籤與網站沒有被變更。
2. 先針對 Windows Chrome／Edge 驗證匯入、音訊解碼、獨立試聽、配置、裁切及輸出，再調整桌面排版與文案。
3. 介面改以滑鼠、鍵盤及較寬工作區為主；保留小型試聽畫面與可讀控制。可保留觸控相容性。
4. 保存流程以「下載影片」為主。不要把 iPhone「分享／儲存到照片」當作 Windows 的主要操作。
5. 以 feature detection 檢查 `AudioDecoder`、codec 支援與 `MediaRecorder.isTypeSupported`，不要只依作業系統名稱硬判可用。Windows 上 HEVC／HDR／特殊音軌仍需實際檔案驗證。
6. 現有手機限制是每部 3～180 秒、250 MB，輸出 720p／480p、30 fps。Windows 可以規劃放寬，但要先量測記憶體、Worker 時間與輸出速度，不能只修改表面文案。
7. 若使用者要求快速、高畫質或長片離線輸出，再評估本機 FFmpeg 或其他編碼路徑。這會改變打包、安裝與檔案處理方式，需另訂範圍。FFmpeg 目前只用於開發測試素材與測試解碼，沒有內建到正式網頁。
8. 目前是瀏覽器本機處理，不上傳影片。改成伺服器轉檔不是已授權需求；不要為解碼方便直接上傳使用者媒體。

## 開發與驗收

使用 Node 24 可沿用現有 TypeScript 直接執行測試的環境；測試需要 PATH 上可執行的 FFmpeg。重建素材另外需要 Python。先檢查新環境，不要假設套件或工具都已安裝。

```powershell
npm ci
npm run dev -- --host 0.0.0.0
```

在另一個終端執行：

```powershell
npm run typecheck
npm test
npm run build
npm run test:build
```

第 17 版發布前：86 項測試通過，TypeScript、修改範圍的 oxlint、正式建置通過。正式 Worker 驗證工具已在前面版本通過，Windows 建置仍須重新執行。README 前面「10 個核心測試」是早期紀錄，不是目前總數。

有大量播放器模擬測試及真實 AAC／MOV PCM 素材測試；**這不等於完整 Windows 瀏覽器或 iPhone 真機端到端測試**。使用者將第 17 版指定為重要還原點，但沒有提供所有格式的驗收矩陣。現有完整 lint 可能包含未使用預載 UI 元件的既有錯誤；區分既有與新增問題。

Windows 實際驗收至少涵蓋：

- 測試素材 A 22 秒、B 14 秒，預期音樂差 +2.34 秒；交換來源為 -2.34 秒。對齊後成品 19.66 秒，B 尾端黑幕 5.66 秒。
- 真實 iPhone MOV／MP4、不同採樣率、特殊音軌；解碼失敗能備援，取消不保留半成品。
- 相同音樂夾拍手／說話／不同尾段仍可對齊；無關聲音與共同靜音邊界不能誤判。
- 先單片播放再同時試聽、改正負時間差、重播、個別暫停／拖動、播放中換片、背景切換、取消讀音訊。
- 試聽之後主編輯的 offset、裁切、排版及原有成品不被修改。
- 第一次「裁切」、套用後「重新裁切」，A／B 分開記錄。
- 重複融合不出現音訊來源重複連接錯誤；起點、黑幕、音軌尾端靜音都正確。
- 下載檔的容器、MIME、副檔名相符，在 Windows 播放器檢查有畫面、有聲音、片長正確。

## 本工作環境的操作備註

- PowerShell；優先用 `rg` 搜尋。
- 此會話一般 sandbox 指令曾因 Windows ACL helper 失敗，後續使用經審核的 `require_escalated` 工作目錄指令；新環境先正常執行，遇到相同錯誤再處理，勿假設所有操作都需提升權限。
- Sites 標準 Node 打包 helper 在這台機器有路徑問題；已成功使用 Git Bash 執行 Sites 隨附 `package-site.sh`，並使用 `/d/...`、`/c/...` 路徑。網站本身 `npm run build` 正常。
- Sites 發布必須保存精確已推送來源與對應產物。不要在交接文件保存 token；新工作取得自己的短效憑證。
- 使用者偏好「做完直接發布」，不喜歡反覆詢問同一事項。但這個既有授權不應被拿來把尚未指定的 Windows 新網站覆蓋到 iPhone 網站。
- 這份交接沒有建立新任務或執行 Codex 任務 handoff，也沒有更動 iPhone 網站。

## 可貼到下一個開發任務的起始指令

> 請先閱讀 `D:/iphone_2movie_align/HANDOFF_WINDOWS.md`，以 `restore-20260910-important`（第 17 版，commit `e52f852488423422d55315aef0a93b6dbe92f297`）為基礎建立獨立 Windows 版。保留原 iPhone 專案、正式網站及所有還原點。先確認 Windows 的交付形式；若沒有另行指定，提出以 Chrome／Edge 網頁版起步的具體做法。保留全段搜尋／局部確認的音樂對齊、快速解碼失敗備援、畫面裁切，以及完全獨立且共用音訊時鐘的雙影片試聽。不要把試聽時間差自動套回主編輯。從現有測試與素材建立基準，完成 Windows 實際播放與輸出驗證，再發布至自己的目標。
