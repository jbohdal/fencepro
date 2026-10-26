/**
 * Every test file starts with the outbound gate shut (lib/outboundGate.ts):
 * no test can push to a phone, email, text, write a Google Calendar or post a
 * webhook to a real person, whatever database or settings it runs with.
 * Held messages go to a dev outbox file of this run's own, not the app's.
 * (Oct 26, 2026: test runs on the dev copy pushed to Jonathan's phone.)
 */
import os from 'os'
import path from 'path'

process.env.OUTBOUND_GATE = 'closed'
if (!process.env.DEV_OUTBOX_FILE) process.env.DEV_OUTBOX_FILE = path.join(os.tmpdir(), `ezbiz-test-outbox-${process.pid}.log`)
