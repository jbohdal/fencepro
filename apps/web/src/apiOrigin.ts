/**
 * Where the API is when the app is opened on localhost.
 *
 * The live install (~/ezbiz) serves the web app and the API from one port,
 * 4000, so that is the default. The development folder runs its own API on a
 * different port against the dev database and says so with VITE_API_PORT in
 * apps/web/.env.local. That keeps a dev browser from ever talking to the live
 * server. See GO_LIVE.md, "Live and dev are separate".
 */
export const LOCAL_API_ORIGIN = `http://localhost:${import.meta.env.VITE_API_PORT || '4000'}`
