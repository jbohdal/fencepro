# Team Data Entry Guidelines
**For:** anyone who enters data in EZBiz. Updated 2026-04-29.

EZBiz now writes every save permanently to the database. The most common cause of "lost" data isn't a software bug — it's habits. This page is short on purpose.

---

## 1. Wait for the green checkmark

Every save in EZBiz shows a small notification ("toast") in the top-right corner:

- **Green** ✅ → save succeeded. You can navigate away.
- **Red** ❌ → save failed. Read the error message.

Don't close the browser tab or click away in the half-second between clicking Save and seeing the toast.

---

## 2. If you see a red error, do NOT refresh

Refreshing loses everything you just typed.

Instead:

1. Read the red error.
2. Take a screenshot or copy the values you entered (just in case).
3. Click Save again. Most failures are temporary.
4. If it fails twice in a row, contact your admin. Your typed values are still on screen — don't refresh.

---

## 3. Wait for uploads to complete

When uploading a file or photo:

1. Click upload, choose your file.
2. Wait for the progress bar to finish AND the file to appear in the list.
3. Only then navigate away.

Large photos (over 5 MB) can take up to 30 seconds. Closing the tab early kills the upload.

---

## 4. Don't use the browser back button mid-form

If you're filling out a customer or quote, use the app's **Cancel** button (inside the form) instead of the browser ← arrow. The browser back button doesn't auto-save.

---

## 5. Log out cleanly

Before logging out:
- Confirm you don't have any unsaved forms open.
- If you do, click Save (and wait for green) or Cancel.
- Then click your name in the bottom-left and Sign Out.

---

## 6. Don't edit the same record from two tabs

If you and a teammate both open the same customer in two tabs and both click Save, the second person's save *overwrites* the first one. Coordinate in chat: "I'm editing Smith now, will ping when done."

---

## 7. Report data weirdness immediately

If you ever see something that looks wrong — a customer disappeared, a phone number changed by itself, a file vanished — tell your admin **before** trying to re-enter it.

The audit log records who did what, but only if the original record still exists. Re-creating a record on top of a "missing" one can make the original genuinely unrecoverable.

The first hour matters most. Speed of reporting > speed of fixing.

---

## What to do if you're not sure

Take a screenshot of what you see and send it to your admin. They have access to the Audit Log (Admin → 🛡️ Audit Log) which shows exactly who changed what and when, including the values before and after each change. Most "weird" things have a clear explanation in the audit log.
