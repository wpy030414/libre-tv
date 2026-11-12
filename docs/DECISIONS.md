# DECISIONS

## ADR-1：全栈 monorepo（Hono 单进程）而非纯前端聚合
- 日期：2026-11-12
- 状态：已采纳
- 背景（遇到了什么问题）：源站（hanime1 等）无官方 API，浏览器直连受跨域与防盗链限制，HTML 解析与 m3u8 代理只能在服务端做；同时希望一个进程部署完事。
- 考虑过的方案：① LibreTV 式纯静态前端 + iframe 嵌源站播放页；② LunaTV/MoonTV（Next.js 全栈）；③ OrionTV（React Native tvOS 原生应用）；④ pnpm monorepo：Hono API + React SPA 单进程。
- 决策：方案④，按 node-monorepo 路线落地。
- 为什么选这个：源适配必须服务端（②也满足，但 Next.js 运行时对本项目偏重）；单进程 `node dist/index.js` 自包含部署，SQLite 零配置；前端构建产物直接被 server 托管，无跨域。
- 为什么不选其他：①无法归一化数据、界面不可控；②框架耦合与运维成本高于一个 Hono；③原生应用无法以 Web 形式在电视浏览器/投屏使用。
- 后果：开发期需同时起两个进程（concurrently 已编排）；生产只需一个端口（11408）。
- 何时重新审视：出现多用户/公网部署诉求，或需要 SSR 时。

## ADR-2：源接口化——SourceAdapter 统一契约
- 日期：2026-11-12
- 状态：已采纳
- 背景（遇到了什么问题）：目标是聚合多个异构源站（首个 hanime1.me），各站列表/搜索/详情/播放地址结构完全不同，前端不能为每个源写一套。
- 考虑过的方案：① 每源一套前端页面；② CMS 采集站 JSON 当作唯一源格式（LibreTV/LunaTV 系做法）；③ 自定义 SourceAdapter 契约（list/search/detail），归一化为 VideoSummary/VideoDetail/Page。
- 决策：方案③，契约落在 `packages/shared/src/types.ts`，server 侧维护 adapter 注册表。
- 为什么选这个：hanime1 不是 CMS 采集站，②覆盖不了；契约足够小（三个方法），任何能被抓取的站点都能实现。
- 为什么不选其他：①前端复杂度随源数线性增长；②绑定采集站生态，非采集源接不进来。
- 后果：新增源 = 写一个 adapter + 注册，前端零改动；源站改版只需改对应 adapter。
- 何时重新审视：出现源需要「登录态/付费解锁」或「字幕轨道」等契约未覆盖的能力时。

## ADR-3：tvOS 风格自建（Web）而非复用原生方案
- 日期：2026-11-12
- 状态：已采纳
- 背景（遇到了什么问题）：产品要求 Apple TV 视觉与遥控器/方向键操作；社区只有原生 tvOS 实现（OrionTV，React Native tvOS + Expo），没有可复用的 Web 版。
- 考虑过的方案：① 直接用 OrionTV（原生双端）；② 拿 LunaTV 界面改皮；③ React SPA 自建 tvOS 视觉语言 + 空间导航库（`@norigintech/norigin-spatial-navigation`）。
- 决策：方案③。
- 为什么选这个：部署形态必须是 Web（自托管单进程）；空间导航库解决焦点引擎这个最难的骨架问题，视觉层（大图卡片、顶部 tab、毛玻璃）用 Tailwind + shadcn 自建可控。
- 为什么不选其他：①无法 Web 部署，且其后端假设是 LunaTV 系；②界面结构非焦点优先，改造成本高于自建。
- 后果：tvOS 视觉细节需自行打磨；焦点交互要作为验收标准写进 spec。
- 何时重新审视：若未来需要 tvOS/Android TV 原生端，OrionTV 可作为参考实现重新评估。
