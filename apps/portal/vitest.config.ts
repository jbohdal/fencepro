import 'dotenv/config'
import { defineConfig } from 'vitest/config'

// Database tests (*.db.test.ts) write test records. They are only ever loaded
// with DEV_DB=1 against the dev database (ezbiz_dev). Anywhere else, the live
// install's update.sh included, they are not loaded at all: skipping inside the
// file is not enough, because a skipped group's setup code still runs while
// the tests are being collected (that is how test records reached live on
// Oct 18, 2026).
const onDevDb = !!process.env.DEV_DB && /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', ...(onDevDb ? [] : ['tests/**/*.db.test.ts'])],
    environment: 'node',
    globals: false,
  },
})
