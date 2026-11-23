// Community links for beech.
//
// DISCORD_INVITE_URL is the ONE place the Discord invite lives: the landing
// page (landingSite.ts), the shore site (shoreSite.ts), and the in-game
// account panel (src/ui/accountPanel.ts) all read it from here, so swapping
// in the real invite is a one-line change.
//
// TODO: the Discord server does not exist yet — 'https://discord.gg/beech'
// is a placeholder, not a working invite. When the server is created, swap
// in its real invite URL here and every surface updates.
//
// Keep this file pure constants with no imports: the web client imports it
// too, so nothing server-only may ever live here.
export const DISCORD_INVITE_URL = 'https://discord.gg/beech';
