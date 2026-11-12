import { defineConfig } from 'vite-plus'

export default defineConfig({
  fmt: { semi: false, singleQuote: true },
  lint: {
    // 必须显式排除，否则 vp lint 会扫描 node_modules
    ignorePatterns: ['**/node_modules/**', '**/dist/**'],
    // typeCheck 关闭：vp 1.5+ 的 plugins 类型与第三方 Vite 插件不互通，
    // 开着会让各包 vite.config.ts 报 TS2322；业务代码的类型仍由 tsc 覆盖
    options: { typeAware: true, typeCheck: false },
  },
})
