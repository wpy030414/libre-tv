import { defineConfig } from 'vite-plus'

export default defineConfig({
  pack: {
    entry: ['src/index.ts'],
    format: ['esm'],
    outDir: 'dist',
    clean: true,
    dts: false,
    platform: 'node',
    // tsdown 的 ESM 默认产物是 .mjs；这里固定为 .js，与 start 脚本一致
    outExtensions: () => ({ js: '.js' }),
    deps: {
      // 内联 @libre-tv/shared，使 dist/ 自包含。
      // 注意：写字符串 '@libre-tv/shared' 只匹配顶层包名，匹配不到
      // '@libre-tv/shared/constants' 这类子路径导入，必须用函数或正则。
      alwaysBundle: (id: string) => id.startsWith('@libre-tv/shared'),
    },
  },
})
