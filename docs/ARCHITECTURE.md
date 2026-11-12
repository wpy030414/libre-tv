# ARCHITECTURE — libre-tv

## 系统概述
- 整体结构：

```
                ┌──────────────────────────────────────────┐
  电视/浏览器 →  │ apps/server (Hono :11408)                │
                │  ├─ /api/*        源聚合 JSON API         │
                │  ├─ /assets/*     生产模式托管前端产物     │
                │  └─ dist/client/  (vp build 产出的 SPA)   │
                │       ↑ 开发模式 Vite :5173 代理 /api      │
                ├──────────────────────────────────────────┤
                │ 源适配层（规划：apps/server/src/sources/） │
                │   SourceAdapter: hanime1（首个）| …       │
                ├──────────────────────────────────────────┤
                │ SQLite (node:sqlite) + Drizzle rc（就绪） │
                └───────────────┬──────────────────────────┘
                                │ fetch + HTML 解析 / m3u8 代理
                        各源站（hanime1.me …）
```

## 核心模块
| 模块 | 职责 |
|------|------|
| `@libre-tv/web` | tvOS 风格 SPA：空间导航焦点、海报墙、搜索、详情、全屏播放器、本地库、hash 路由 |
| `@libre-tv/server` | Hono 入口：`/api` 聚合路由、生产模式静态托管、源注册与流/图代理 |
| `@libre-tv/shared` | 零构建契约包：SourceAdapter、VideoSummary/VideoDetail/Page、LibraryItem/DownloadJob/PlaybackResolve |
| 源适配层 | `apps/server/src/sources/`：hanime1 adapter + 传输层（curl）+ DNS/CF 绕行策略 |
| 本地库 | `apps/server/src/library/`：SQLite（node:sqlite）元数据/进度/设置 + 单并发下载队列 |

## 模块关系
- web 只依赖 shared 的类型做编译期约束，运行时数据全部来自 server 的 `/api`。
- server 持有 adapter 注册表（`sources/index.ts`），路由按 `source` 参数分发到对应 adapter。
- shared 被双方直引 TS 源码（`exports` → `./src/*.ts`），构建时内联，无独立发布。
- 下载器依赖适配层的 detail + streamUrl；本地库只存结果，不反向依赖适配器实现。

## 数据流
- 浏览：web → `GET /api/sources/:id/list?page=` → adapter.list() → curl 抓源站 → cheerio 解析 → `Page<VideoSummary>`。
- 详情：`GET /api/sources/:id/detail/:vid` → 解析 `<video><source>` 多清晰度直链 + 相关推荐。
- 播放（双播）：web → `GET /api/library/play/:source/:id` → 本地库命中则返回 `/api/library/media/<file>`（本地优先）；否则 `offline=0` 时返回流代理地址。
- 直放：`<video src="/api/sources/hanime1/stream?v=&quality=">` → curl `-r` 透传 → 上游 206 分片。
- 下载：`POST /api/library/downloads` → 入队 → 详情快照 → 流式写 `.part` → 重命名 → 封面 → 入库（含全量元数据 JSON）。
- 图片：所有封面经 `/api/sources/:id/image?url=` 白名单代理（源站防盗链）。

## 外部系统
- hanime1.me：Laravel SSR，无列表/详情 JSON API；列表与播放地址全在 HTML 内。
  - Cloudflare 防护：WAF 会按 **TLS 指纹** 与 **请求头名大小写** 判定；Node fetch 即使带有效 `cf_clearance` 也被 ban，因此传输层走系统 curl，并把头名规范化为浏览器形态（`User-Agent`/`Cookie`）。
  - 本地 DNS 被污染：DoH 查询（优先经代理）解析真实 Cloudflare IP，再以 `curl --resolve` 直连 IPv4。
- 部署面：pm2 单进程（`.xat/workflows/ci-cd.yml`），`vp pack` 产物自包含（shared 已内联）。

## 重要技术边界
- 前端不感知任何源站细节：新增源只允许改 server 侧 + shared 契约。
- 源站解析代码隔离在 `sources/` 目录内，失败只影响单源，不拖垮 `/api`（`onError` 统一映射）。
- 面向电视的焦点导航（`@noriginmedia/norigin-spatial-navigation`）是前端第一等公民，不是鼠标交互的补丁。
- 离线模式下任何源站请求短路：播放解析只认本地库。
