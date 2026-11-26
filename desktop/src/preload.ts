import { contextBridge, ipcRenderer } from 'electron';

interface SteamMicroTxnEvent {
  appId: number;
  orderId: string;
  authorized: boolean;
}

const info = {
  platform: process.platform,
  steamDeck: process.env.SteamDeck === '1',
  steamReady: false,
};

// Synchronously expose the bridge; update steamDeck/steamReady once main responds.
const bridge = {
  get platform() {
    return info.platform;
  },
  get steamDeck() {
    return info.steamDeck;
  },
  get steamReady() {
    return info.steamReady;
  },
  getAuthTicket: () => ipcRenderer.invoke('steam:getAuthTicket'),
  onMicroTxnResponse: (cb: (res: SteamMicroTxnEvent) => void) => {
    const handler = (_ev: Electron.IpcRendererEvent, data: SteamMicroTxnEvent) => cb(data);
    ipcRenderer.on('steam:microTxnResponse', handler);
    return () => {
      ipcRenderer.removeListener('steam:microTxnResponse', handler);
    };
  },
  unlockAchievement: (id: string) => ipcRenderer.send('steam:unlockAchievement', id),
  setRichPresence: (key: string, value: string) => ipcRenderer.send('steam:setRichPresence', key, value),
  openExternal: (url: string) => ipcRenderer.send('steam:openExternal', url),
  toggleFullscreen: () => ipcRenderer.invoke('window:toggleFullscreen'),
  isFullscreen: () => ipcRenderer.invoke('window:isFullscreen'),
  quit: () => ipcRenderer.send('app:quit'),
  saveBeachFile: (suggestedName: string, text: string) => ipcRenderer.invoke('file:saveBeach', suggestedName, text),
  notify: (title: string, body: string) => ipcRenderer.send('notify:show', title, body),
  onNotifyClick: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('notify:clicked', handler);
    return () => {
      ipcRenderer.removeListener('notify:clicked', handler);
    };
  },
};

void ipcRenderer.invoke('steam:info').then((res: typeof info) => {
  if (!res) return;
  info.platform = res.platform;
  info.steamDeck = res.steamDeck;
  info.steamReady = res.steamReady;
});

contextBridge.exposeInMainWorld('beechSteam', bridge);
