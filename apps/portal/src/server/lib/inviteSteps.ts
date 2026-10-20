/**
 * What a new staff member does before opening their invite link. EZ Biz is
 * reached over Tailscale; a phone without it gets "This site can't be
 * reached" (the public door hangs up on the app), so the Tailscale steps come
 * first, in the invite email and in the text the owner copies on the Team
 * page (apps/web/src/TeamManagementPage.tsx imports this file).
 */

export const TAILSCALE_PLAY_STORE = 'https://play.google.com/store/apps/details?id=com.tailscale.ipn'
export const TAILSCALE_APP_STORE = 'https://apps.apple.com/app/tailscale/id1470499037'

/** Step 1, as plain lines (for a text message). */
export const INVITE_STEP_1_LINES = [
  'Step 1: Install Tailscale on your phone:',
  `Android (Play Store): ${TAILSCALE_PLAY_STORE}`,
  `iPhone (App Store): ${TAILSCALE_APP_STORE}`,
  'Open the Tailscale invite email and accept it, sign in to Tailscale with the same email, and turn Tailscale on.',
]

/** The whole message to text a new staff member: the steps, then the link. */
export function inviteStepsText(inviteUrl: string, hours: number): string {
  return [
    ...INVITE_STEP_1_LINES,
    '',
    `Step 2: Open this link, choose a password (8 characters or more), and you are signed in. It works for ${hours} hours, once:`,
    inviteUrl,
  ].join('\n')
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The same steps for the invite email: Step 1, then Step 2 with the button and the link. */
export function inviteStepsHtml(inviteUrl: string, buttonText: string): string {
  const link = esc(inviteUrl)
  return `
        <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:14px 16px;margin:16px 0;">
          <p style="margin:0 0 8px;font-weight:600;">Step 1: Install Tailscale</p>
          <p style="margin:0 0 8px;">Install Tailscale on your phone:
            <a href="${TAILSCALE_PLAY_STORE}">Android (Play Store)</a> or
            <a href="${TAILSCALE_APP_STORE}">iPhone (App Store)</a>.</p>
          <p style="margin:0;">Open the Tailscale invite email and accept it, sign in to Tailscale with the same email, and turn Tailscale on.</p>
        </div>
        <p style="margin:16px 0 8px;font-weight:600;">Step 2: Open this link</p>
        <p style="margin:0 0 8px;">Only after Step 1: without Tailscale on, the link says "This site can't be reached".</p>
        <p style="margin: 16px 0 24px;"><a href="${link}" style="display:inline-block;background:#f97316;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px;">${esc(buttonText)}</a></p>
        <p style="color:#64748b;font-size:13px;">If the button doesn't work, copy this link into your browser:<br><span style="color:#475569;word-break:break-all;">${link}</span></p>`
}
