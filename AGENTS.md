# AGENTS.md

libre-tv 是 tvOS 风格视频聚合应用（pnpm monorepo：Hono 源适配后端 + React SPA 前端 + shared 契约包）。

## 概述
- 本项目是什么：自托管单进程全栈应用；内容源以 SourceAdapter 接口接入，前端只消费归一化 JSON。

## 边界与范围
- 范围内：tvOS 风格 SPA、源适配层（首个源 hanime1.me）、播放聚合、SQLite 持久化（进度/收藏）。
- 非目标（明确排除）：内容下载/离线缓存、账号与多用户体系、面向公网的多租户部署、SEO/SSR。

## Agent 操作指南
- 如何理解本项目：先读 `docs/ARCHITECTURE.md` 看模块与数据流；源契约在 `packages/shared/src/types.ts`，任何新源先实现 SourceAdapter 再挂到 server 路由。
- 全局规则 / 约定：
  - 构建/检查/测试统一走 vp（`vp dev/build/pack/check/test`）；Node 服务进程开发用 `tsx watch`。
  - 依赖一律最新版，两个例外：`tailwindcss` 钉 3.4.x；`drizzle-orm`/`drizzle-kit` 取 rc 线且版本严格一致。
  - 回答与文档只用中文；下载走 npmmirror 镜像；commit 遵循 Conventional Commits（type/scope 英文、描述中文）。
  - 工作目录不是 Git 仓库时拒绝写入；多步骤任务验证通过后只提交一次。

## 目录速查
- `apps/server/src/` — Hono 入口：API 路由 + 生产模式托管 `dist/client` 静态文件
- `apps/web/src/` — React SPA（tvOS 风格界面，Tailwind + shadcn/ui）
- `packages/shared/src/` — 源契约（SourceAdapter/VideoSummary/VideoDetail/Page）与常量
- `docs/` — PRD / ARCHITECTURE / DECISIONS / specs（模块验收标准）
- `.xat/workflows/ci-cd.yml` — pm2 部署模板
