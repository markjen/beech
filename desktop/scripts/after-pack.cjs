// electron-builder afterPack hook (see electron-builder.yml).
// Writes steam_appid.txt next to the packaged executable so steamworks.js
// can init when the game is launched directly instead of through Steam.
// When launched through Steam, Steam sets the SteamAppId env var and the
// file is only a fallback. No-op when STEAM_APP_ID is not set (e.g. a local
// dev pack), so local builds keep degrading gracefully to no-Steam.
const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = async function afterPack(context) {
  const appId = (process.env.STEAM_APP_ID ?? '').trim();
  if (!appId) return;
  await fs.mkdir(context.appOutDir, { recursive: true });
  await fs.writeFile(path.join(context.appOutDir, 'steam_appid.txt'), `${appId}\n`, 'utf8');
};
