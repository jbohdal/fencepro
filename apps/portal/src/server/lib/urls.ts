/**
 * Frontend-URL helper.
 *
 * Single source of truth for the CRM/portal frontend domain.
 * Every invite, activation, password-reset, and notification link must build
 * its URL through buildFrontendUrl() so they all stay consistent.
 */

const FALLBACK = 'http://localhost:5173'

/** Resolve the frontend base URL. Strips trailing slashes. */
export function getFrontendBase(): string {
  const raw =
    process.env.APP_URL ||
    process.env.CLIENT_URL ||
    process.env.PORTAL_APP_URL ||
    FALLBACK
  return raw.replace(/\/+$/, '')
}

/** Build a full frontend URL for the given path. Path may start with `/` or not. */
export function buildFrontendUrl(path: string): string {
  const base = getFrontendBase()
  if (!path) return base
  return path.startsWith('/') ? `${base}${path}` : `${base}/${path}`
}

/**
 * Production env validator. Returns a list of human-readable problems.
 * Called at server startup — see index.ts.
 */
export function validateProductionEnv(): { critical: string[]; warnings: string[] } {
  const critical: string[] = []
  const warnings: string[] = []

  const appUrl = process.env.APP_URL || process.env.CLIENT_URL
  if (!appUrl) {
    critical.push('APP_URL (or CLIENT_URL) is not set. Activation/invite/reset emails will use http://localhost:5173 and SSL will fail in production.')
  } else if (process.env.NODE_ENV === 'production' && !/^https:\/\//.test(appUrl)) {
    critical.push(`APP_URL must start with https:// in production. Got: ${appUrl}`)
  } else if (/url\d+\./i.test(appUrl)) {
    critical.push(`APP_URL appears to contain a SendGrid click-tracking prefix (${appUrl}). Set APP_URL to your real frontend domain — click tracking is rewritten by SendGrid at send time, never set it as the source.`)
  }

  if (!process.env.DATABASE_URL) {
    critical.push('DATABASE_URL is not set. The application cannot persist any data.')
  } else if (process.env.DATABASE_URL.startsWith('file:')) {
    critical.push('DATABASE_URL points to a SQLite file: ' + process.env.DATABASE_URL + '. SQLite is ephemeral on most hosting platforms (Render/Railway/Fly) and will lose data on every deploy. Migrate to a managed PostgreSQL service.')
  } else if (/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) && process.env.NODE_ENV === 'production') {
    // A self hosted install runs Postgres on the same machine on purpose.
    if (process.env.ALLOW_LOCAL_DATABASE === 'true') {
      warnings.push('DATABASE_URL points to localhost in production (allowed by ALLOW_LOCAL_DATABASE). The database lives on this machine, so its backups are yours to keep.')
    } else critical.push('DATABASE_URL points to localhost in production. This is almost certainly wrong — production must use a managed PostgreSQL host.')
  }

  if (!process.env.JWT_SECRET || /change-me|dev-/i.test(process.env.JWT_SECRET)) {
    critical.push('JWT_SECRET is missing or set to a placeholder. Generate a 64+ character random string and set it in production env.')
  }
  if (!process.env.JWT_REFRESH_SECRET || /change-me|dev-/i.test(process.env.JWT_REFRESH_SECRET)) {
    critical.push('JWT_REFRESH_SECRET is missing or set to a placeholder. Generate a separate 64+ character random string.')
  }

  if (!process.env.SENDGRID_API_KEY && !(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)) {
    warnings.push('No email backend configured (SENDGRID_API_KEY or SMTP_HOST/SMTP_USER/SMTP_PASS). Invite, activation, password-reset, and notification emails will silently log to console instead of being delivered.')
  }

  if (process.env.NODE_ENV === 'production') {
    if (!process.env.AWS_S3_BUCKET) {
      warnings.push('AWS_S3_BUCKET not set. Customer file uploads will go to local disk and may be lost on deploy.')
    }
    if (!process.env.SENDGRID_FROM_EMAIL && !process.env.SMTP_FROM_EMAIL) {
      warnings.push('No verified sender email configured. SendGrid requires SENDGRID_FROM_EMAIL (or SMTP_FROM_EMAIL) to match a verified sender or domain.')
    }
  }

  return { critical, warnings }
}

/** Print env-validation results at startup, and alert by email on critical issues. */
export function printEnvValidation(): void {
  const { critical, warnings } = validateProductionEnv()
  if (critical.length === 0 && warnings.length === 0) {
    console.log('[env] ✅ All required environment variables look good.')
    return
  }
  if (critical.length > 0) {
    console.error('[env] ❌ CRITICAL environment problems:')
    for (const msg of critical) console.error('       ' + msg)
  }
  if (warnings.length > 0) {
    console.warn('[env] ⚠️  Warnings:')
    for (const msg of warnings) console.warn('       ' + msg)
  }
  // Best-effort alert email when critical issues are detected. Wrapped in
  // try/catch and fired-and-forgot — we MUST NOT block startup on email.
  if (critical.length > 0) {
    const adminEmail = process.env.ADMIN_ALERT_EMAIL || process.env.SMTP_FROM_EMAIL
    if (adminEmail && process.env.SENDGRID_API_KEY) {
      // Lazy-load to avoid pulling email service when env validation fails before setup
      import('./emailService.js').then(({ sendEmail, buildEmailHtml }) => {
        sendEmail({
          to: adminEmail,
          subject: 'ALERT — EZBiz API failed env validation at startup',
          body: buildEmailHtml(`
            <p>The EZBiz API process detected critical environment issues at startup:</p>
            <ul>${critical.map(m => `<li>${m}</li>`).join('')}</ul>
            ${warnings.length > 0 ? `<p>Warnings:</p><ul>${warnings.map(m => `<li>${m}</li>`).join('')}</ul>` : ''}
            <p>${process.env.NODE_ENV === 'production' ? 'In production the process refuses to start with critical errors.' : 'In development the process started anyway. Fix before promoting to production.'}</p>
          `),
          disableClickTracking: true,
        }).catch(() => {})
      }).catch(() => {})
    }
  }
  if (critical.length > 0 && process.env.NODE_ENV === 'production' && process.env.STRICT_ENV_VALIDATION !== 'false') {
    console.error('[env] Refusing to start in production with critical env errors. Set STRICT_ENV_VALIDATION=false to bypass (not recommended).')
    process.exit(1)
  }
}
