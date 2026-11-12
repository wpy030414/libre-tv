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
| `@libre-tv/web` | tvOS 风格 SPA：焦点导航、大图卡片浏览、搜索、详情、播放（当前为骨架占位） |
| `@libre-tv/server` | Hono 入口：`/api` 聚合路由、生产模式静态托管、（规划）源注册与代理 |
| `@libre-tv/shared` | 零构建契约包：SourceAdapter 接口、VideoSummary/VideoDetail/Page 类型、常量 |
| 源适配层（规划） | server 内子模块：每源一个 adapter，实现 shared 契约，首个为 hanime1 |

## 模块关系
- web 只依赖 shared 的类型做编译期约束，运行时数据全部来自 server 的 `/api`。
- server 持有 adapter 注册表（规划），路由按 `source` 参数分发到对应 adapter。
- shared 被双方直引 TS 源码（`exports` → `./src/*.ts`），构建时内联，无独立发布。

## 数据流
- 浏览：web → `GET /api/sources/:id/list?page=` → server 调 adapter.list() → fetch 源站 → HTML 解析归一化 → `Page<VideoSummary>` JSON。
- 播放：web → `GET /api/sources/:id/detail/:vid` → adapter.detail() 解析 streamUrl → 前端播放器请求（必要时经 server 代理流）。

## 外部系统
- hanime1.me：首个源站，无官方 API，靠 HTML 解析 + 播放地址逆向（参考 Han1meViewer 的解析路径）；未接入。
- 部署面：pm2 单进程（`.xat/workflows/ci-cd.yml`），`vp pack` 产物自包含（shared 已内联）。

## 重要技术边界
- 前端不感知任何源站细节：新增源只允许改 server 侧 + shared 契约。
- 源站解析代码隔离在 `sources/` 目录内，失败只影响单源，不拖垮 `/api`。
- 面向电视的焦点导航（规划引入空间导航库）是前端第一等公民，不是鼠标交互的补丁。
