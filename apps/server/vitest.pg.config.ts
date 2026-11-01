import { defineConfig, mergeConfig } from 'vitest/config'
import base from './vitest.config.js'

/** Same suite against a real PostgreSQL (test/pg-setup.ts) instead of PGlite. */
export default mergeConfig(base, defineConfig({
  test: { globalSetup: ['test/pg-setup.ts'] },
}))
