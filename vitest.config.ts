import { defineConfig } from 'vitest/config'

// 20 s: the FFDec integration tests (85 core templates) keep every core busy, so the quick tests next to them can pass 5 s on a loaded run
export default defineConfig({ test: { include: ['src/**/*.test.ts'], testTimeout: 20000 } })
