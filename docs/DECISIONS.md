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

## ADR-4：双播模式——CDN 直放优先，后端下载转本地为兜底
- 日期：2026-11-12
- 状态：已采纳
- 背景（遇到了什么问题）：源站播放地址是带过期时间的签名直链（hanime1 约一天有效），且受防盗链/CORS 与网络可达性影响；电视端不能每次都依赖第三方 CDN。
- 考虑过的方案：① 一律经服务端流代理直放；② 一律先下载再播；③ 双播模式：默认 CDN 直放（经服务端 Range 代理，不落盘），用户可对任意视频「下载到本地」，之后优先本地。
- 决策：方案③。
- 为什么选这个：直放不占磁盘、即点即看，适合「能看就行」；下载适合收藏与离线，且源站删稿后仍可看。两者共用同一个媒体来源解析出口，前端只切一个 mode。
- 为什么不选其他：①所有流量过本机，磁盘虽省但带宽与 CPU 全压在本机，且签名过期后无法重播旧片；②每个视频都要等下载完，违背电视端浏览习惯。
- 后果：需要下载任务队列（单并发）、本地库（SQLite）、磁盘配额与清理策略；离线模式需要全局开关，离线下所有源站请求短路。
- 何时重新审视：若源站开始提供官方 API/下载授权，或本地存储成本成为主要约束。

## ADR-5：上游传输层改用 curl 子进程，绕开 Cloudflare 的 TLS 指纹判定
- 日期：2026-11-12
- 状态：已采纳
- 背景（遇到了什么问题）：hanime1 由 Cloudflare 防护。实测即使携带浏览器中获取的有效 `cf_clearance`，Node/undici fetch 仍返回 WAF ban（`Attention Required`），而同一 IP、同一 Cookie 下系统 curl 返回 200。二分定位到两个判定维度：TLS ClientHello 指纹，以及请求头名的原始大小写（小写的 `user-agent:`/`cookie:` 直接触发 ban）。
- 考虑过的方案：① 用 curl-impersonate 原生库绑定；② 使用 Puppeteer/Playwright 无头浏览器取页面；③ Node 内置 fetch + 自定义 TLS 指纹（Node 无此能力）；④ 系统 curl 子进程 + 头名规范化。
- 决策：方案④。`sources/curl.ts` 封装 curl 调用（`-4 --resolve` 直连 IPv4、`-r` 透传 Range、临时文件收集大响应），`http.ts` 保留缓存/频控/语义映射。
- 为什么选这个：零额外原生依赖、跨平台可用；实测连续请求稳定 200；保留 Node 层对缓存与错误映射的控制。
- 为什么不选其他：①需要在部署机编译原生绑定，跨平台维护成本高；②常驻浏览器实例内存开销大，电视端低配部署机吃不消；③Node 标准 TLS 栈无法伪装 JA3。
- 后果：部署机必须装有 curl（Windows 10+/主流 Linux 自带）；每次请求多一个进程开销（配合 60s HTML 缓存与 400ms 频控可接受）。
- 何时重新审视：若部署环境不保证 curl，可回退为 curl-impersonate 绑定；若源站提供官方 API 则整体删除该模块。

## ADR-6：DNS 污染应对——DoH 自解析 + --resolve 直连 IPv4
- 日期：2026-11-12
- 状态：已采纳
- 背景（遇到了什么问题）：本机系统 DNS 对 hanime1.me 返回被污染的地址（Facebook 段 / 黑洞 IP），IPv6 出口不可达；而 DoH 端点本身在有网时可能被墙或被污染（阿里 DoH 亦返回污染结果）。
- 考虑过的方案：① 依赖系统 hosts；② 全量走代理；③ 可配置多条 DoH 端点 + 可选「DoH 走本机代理、站点直连」拆分；④ 环境变量钉死 IP。
- 决策：方案③+④：`resolveIpv4` 依次尝试 `1.1.1.1` / `doh.pub` / `dns.google`（可经 `HANIME1_DNS_PROXY` 单独代理），结果以 `curl --resolve host:443:ip` 注入；另提供 `HANIME1_RESOLVE` 直接钉死 IP。
- 为什么选这个：站点访问经代理时 CF 会给挑战页（Just a moment），因此必须直连；而解析必须走可信 DoH。两项分离后实测稳定 200。
- 为什么不选其他：①维护手工 hosts 无法跟随 CDN 漂移；②全量代理被 CF 挑战拦截。
- 后果：多一个运行时配置面（DNS 代理）；跨境部署时通常无需任何配置即可直连。
- 何时重新审视：源站迁出 Cloudflare，或本地网络环境变化（如启用透明代理/DoH）。
