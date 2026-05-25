import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { AppServices } from './app-services';
import { LocalApiServer } from './server/local-api';
import type { LogQuery, RouletteMapping, RouletteStatus } from '../shared/types';

const services = new AppServices();
const apiServer = new LocalApiServer(services);
let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 980,
    minHeight: 640,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (!app.isPackaged) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL ?? 'http://127.0.0.1:5173');
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

function registerIpc(): void {
  ipcMain.handle('app:status', () => services.status());
  ipcMain.handle('events:list', (_event, query: LogQuery) => services.listEvents(query));
  ipcMain.handle('events:add-sample', () => services.addSampleEvent());
  ipcMain.handle('events:update-status', (_event, id: string, status: RouletteStatus) =>
    services.updateStatus(id, status),
  );
  ipcMain.handle('events:delete-all', () => services.deleteAllLogs());
  ipcMain.handle('backup:create-now', () => services.backupService.createNow());
  ipcMain.handle('backup:list', () => services.backupService.list());
  ipcMain.handle('mapping:set', (_event, content: string, mapping: RouletteMapping) =>
    services.setMapping(content, mapping),
  );
  ipcMain.handle('processing:set-active-category', (_event, category: 'action' | 'accumulation' | 'tracked' | 'timed') =>
    services.setActiveCategory(category),
  );
  ipcMain.handle('processing:set-accumulation-period', (_event, period: 'daily' | 'weekly' | 'monthly') =>
    services.setAccumulationPeriod(period),
  );
  ipcMain.handle('filters:tracked-include-add', (_event, keyword: string) =>
    services.addTrackedIncludeKeyword(keyword),
  );
  ipcMain.handle('filters:tracked-include-remove', (_event, keyword: string) =>
    services.removeTrackedIncludeKeyword(keyword),
  );
  ipcMain.handle('filters:tracked-exclude-add', (_event, keyword: string) =>
    services.addTrackedExcludeKeyword(keyword),
  );
  ipcMain.handle('filters:tracked-exclude-remove', (_event, keyword: string) =>
    services.removeTrackedExcludeKeyword(keyword),
  );
  ipcMain.handle('weflab:save-url', (_event, url: string) => services.saveWeflabUrl(url));
  ipcMain.handle('weflab:delete-url', () => services.deleteWeflabUrl());
  ipcMain.handle('monitor:start', () => services.monitor.start());
  ipcMain.handle('monitor:stop', () => services.monitor.stop());
  ipcMain.handle('timed:start', (_event, id: string) => services.timerService.start(id));
  ipcMain.handle('timed:complete', (_event, id: string) => services.timerService.complete(id));
  ipcMain.handle('events:start-timer', (_event, id: string) => services.startTimerFromEvent(id));
  ipcMain.handle('accumulation:start-timer', (_event, ids: string[]) =>
    services.startTimerFromAccumulationGroup(ids),
  );
  ipcMain.handle('accumulation:summary', (_event, period: 'daily' | 'weekly' | 'monthly', anchorDate: string) =>
    services.accumulationSummary(period, anchorDate),
  );

  services.events.on('change', () => {
    mainWindow?.webContents.send('app:changed');
  });
}

app.whenReady().then(async () => {
  registerIpc();
  await services.settingsStore.get();
  await services.startBackgroundJobs();
  await apiServer.start();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  services.stopBackgroundJobs();
  await services.monitor.stop();
  await apiServer.stop();
});
