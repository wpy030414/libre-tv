# Spec — 本地库（Library / 双播模式）

## 要构建什么
- 目标：每个视频既可 CDN 直放（经服务端 Range 代理，不落盘），也可下载到本地后本地播放；下载必须携带页面全部元数据；App 支持在线/离线模式切换。

## 架构与代码对应
- 对应 ARCHITECTURE 模块职责：「本地库：SQLite（node:sqlite）元数据/进度/设置 + 单并发下载队列」。
- 对应源码入口（文件 / 路径）：
  - `apps/server/src/library/db.ts`（建表、设置、路径校验）
  - `apps/server/src/library/downloader.ts`（队列、流式下载、封面、元数据快照）
  - `apps/server/src/routes/library.ts`（`/api/library/*`、Range 单文件服务、播放解析）
  - `apps/server/tests/library.test.ts`（db 与 Range 行为）
  - `apps/web/src/pages/LibraryPage.tsx`（本地库与在线/离线切换）

## 行为
- 预期行为：
  - 播放解析 `GET /api/library/play/:source/:id`：本地有片 → 本地地址；无片且在线 → 源站流代理；离线 → 404。
  - 下载 `POST /api/library/downloads`：单并发排队；进度可查询；完成后库内一条记录。
  - 下载产物：`media/<source>-<id>-<quality>.mp4` + `media/covers/<...>.jpg` + `library` 表行（`meta_json` 为详情页全量快照）。
  - 删除条目同时删文件与记录。
  - 在线/离线为全局设置，持久化在 `settings` 表。

## 输入 / 输出
- 输入：`{source, id, quality?}`、`PUT {offline:boolean}`、进度 `{positionMs, durationMs}`。
- 输出：`PlaybackResolve { url, source: 'cdn'|'local', quality, localQualities }`、`DownloadJob`、`LibraryItem[]`。

## 约束
- 下载一律 `.part` 临时文件 + 原子重命名，半成品不得入库。
- 若上游给 `content-length`，完成后校验大小，不足即判失败并清理。
- 本地媒体服务必须支持 Range（206），否则电视浏览器拖拽/续播不可用。
- 封面抓取失败不阻断下载（降级为无封面）。
- 元数据快照必须完整（含 qualities/related/tags），离线时前端不依赖源站即可展示。

## 边界条件
- 同一条目重复下载：覆盖更新记录与新文件。
- 下载中取消：标记 error 并删除 `.part`。
- 离线模式下进入详情页：详情请求仍可能失败，前端应显示本地库可播放的条目。
- 磁盘路径穿越（`../`）必须拒绝。

## 验收标准
- [x] `/api/library/play` 三分支语义正确（本地优先 / 在线直放 / 离线未下载 404）
- [x] 下载完成生成 mp4 + 封面 + 含全量元数据的库记录（实测 2.3MB 短片全流程）
- [x] 本地媒体 Range 请求返回 206 与正确切片（单测覆盖）
- [x] 目录穿越被拒绝（单测覆盖）
- [x] 在线/离线开关持久化并影响播放解析
- [x] 前端本地库页展示进度、条目、容量，并支持一键切换离线

## 完成定义
- 如何判定已完成：上述验收全部满足，`pnpm check` / `pnpm test` / `pnpm build` 全绿。
- 双向对齐自检：上对齐 ARCHITECTURE「本地库」行；下对齐每一验收项到具体源文件与测试。
