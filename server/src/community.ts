// Community links for beech.
//
// DISCORD_INVITE_URL is the ONE place the Discord invite lives: the landing
// page (landingSite.ts), the shore site (shoreSite.ts), and the in-game
// account panel (src/ui/accountPanel.ts) all read it from here, so swapping
// the invite is a one-line change. This is the server's permanent invite
// (https://discord.gg/y7EGw2yg2d).
//
// Keep this file pure constants with no imports: the web client imports it
// too, so nothing server-only may ever live here. The production image
// build also depends on it: the Dockerfile's web stage copies this file in
// explicitly (it otherwise has no server/ files), so if this file moves,
// that COPY line must move with it.
export const DISCORD_INVITE_URL = 'https://discord.gg/y7EGw2yg2d';
