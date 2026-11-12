# libre-tv

Apple TV（tvOS）风格的自托管视频聚合前端：界面走 tvOS 视觉语言，内容源以接口（SourceAdapter）方式接入，首个目标源为 hanime1.me。

## 这是什么？
- 定位：单服务进程自托管的全栈应用——Hono 后端做源适配与聚合，React SPA 做 tvOS 风格界面，生产模式由同一进程托管。
- 解决的核心问题：电视大屏上「遥控器/方向键友好」的聚合浏览体验；各源站结构差异由后端归一化，前端只消费统一契约。

## 为什么存在？
- 背景 / 动机：社区没有「Apple TV 风格 Web UI + 可插拔源」的完整实现——OrionTV 是 React Native 原生应用，LunaTV/MoonTV 系源接口化完善但界面非 tvOS 风格。本项目把两者各取一半自己搭。

## 如何安装和运行？
- 前置要求：Node 26（见 `.nvmrc`）、pnpm 12+；依赖走 npmmirror 镜像（项目 `.npmrc` 已配置）。
- 安装步骤：`pnpm install`
- 运行 / 启动：
  - 开发：`pnpm dev`（同时起 Hono :11408 与 Vite :5173，`/api` 自动代理）
  - 构建：`pnpm build`（server 走 `vp pack`，web 走 `vp build` 产出到 `apps/server/dist/client/`）
  - 生产：`pnpm start` → http://localhost:11408 单进程托管
  - 检查 / 测试：`pnpm check` / `pnpm test`

## 当前状态
- 阶段：原型（骨架已跑通，源适配层与 tvOS 界面待实现）
- 已知限制：仅 `/api/health` 一个路由；数据库依赖已就绪但无 schema；hanime1 源适配器未实现。

## 核心技术
- 语言 / 框架 / 关键依赖：TypeScript（strict）、pnpm workspace、Hono 4、React 19、Tailwind 3.4 + shadcn/ui、Drizzle ORM（rc 线）+ SQLite（node:sqlite）、vp（Vite+）统一构建。
