# Spec — 源适配层（Source Adapter）

## 要构建什么
- 目标：server 内的源适配层——每个源一个 adapter，实现 `@libre-tv/shared` 的 `SourceAdapter` 契约（list/search/detail），归一化输出经 `/api` 暴露；首个实现 hanime1.me。

## 架构与代码对应
- 对应 ARCHITECTURE 模块职责：「源适配层（规划）：server 内子模块，每源一个 adapter，实现 shared 契约，首个为 hanime1」。
- 对应源码入口（文件 / 路径）：
  - 契约（已实现）：`packages/shared/src/types.ts`（`SourceAdapter`/`VideoSummary`/`VideoDetail`/`Page`）
  - 适配器目录（待实现）：`apps/server/src/sources/`（规划 `sources/hanime1/` 与注册表 `sources/index.ts`）
  - 路由挂载（待实现）：`apps/server/src/index.ts` 的 `/api` 段

## 行为
- 预期行为：路由按 `source` 参数从注册表分发；adapter 抓取源站并解析 HTML，输出归一化分页结构；单源失败返回该源错误，不影响其他源与 `/api/health`。

## 输入 / 输出
- 输入：`GET /api/sources/:id/list?page=&category=`、`GET /api/sources/:id/search?kw=&page=`、`GET /api/sources/:id/detail/:vid`
- 输出：`Page<VideoSummary>` / `VideoDetail` JSON（结构见 shared 契约）

## 约束
- 解析逻辑只允许出现在 `sources/<id>/` 内，不得散落到路由或前端。
- 对源站的请求必须带合理 UA 与频控，避免把源站打挂。
- 播放地址若受防盗链限制，须经 server 代理流，不得把源站直链长期缓存。

## 边界条件
- 源站改版导致解析失败 → 该源接口返回 5xx + 错误来源标识，前端显示单源不可用。
- 空结果 / 翻页越界 → 返回空 `items` 与 `hasMore: false`，不报错。
- hanime1 分区与标签参数映射到 `category`，以 adapter 内常量表维护。

## 验收标准
- [ ] `packages/shared/src/types.ts` 导出 `SourceAdapter`/`VideoSummary`/`VideoDetail`/`Page`（已达成）
- [ ] `apps/server/src/sources/hanime1/` 实现 list/search/detail 三方法并有真实抓取
- [ ] `/api/sources/:id/*` 三路由按注册表分发，未注册 source 返回 404
- [ ] 单源抛错不拖垮进程与其他路由（有测试或可复现验证）
- [ ] 归一化字段覆盖：id/source/title/coverUrl 至少必填，streamUrl 在 detail 可解析

## 完成定义
- 如何判定已完成：上述验收标准全部勾选，`pnpm check`/`pnpm test`/`pnpm build` 全绿。
- 双向对齐自检：上对齐——本 spec 职责与 ARCHITECTURE「源适配层」行一致；下对齐——每条验收标准均可指到 shared 契约源码、`sources/` 目录或对应测试。
