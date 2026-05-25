import { contextBridge, ipcRenderer } from 'electron';
import type { AccumulationSummaryItem, AppStatus, LogQuery, RouletteMapping, RouletteStatus } from '../shared/types';

const api = {
  getStatus: (): Promise<AppStatus> => ipcRenderer.invoke('app:status'),
  listEvents: (query: LogQuery) => ipcRenderer.invoke('events:list', query),
  addSampleEvent: () => ipcRenderer.invoke('events:add-sample'),
  updateStatus: (id: string, status: RouletteStatus) => ipcRenderer.invoke('events:update-status', id, status),
  deleteAllLogs: () => ipcRenderer.invoke('events:delete-all'),
  createBackupNow: () => ipcRenderer.invoke('backup:create-now'),
  listBackups: () => ipcRenderer.invoke('backup:list'),
  setMapping: (content: string, mapping: RouletteMapping) => ipcRenderer.invoke('mapping:set', content, mapping),
  useAutoClassification: (content: string) => ipcRenderer.invoke('mapping:auto', content),
  setActiveCategory: (category: 'action' | 'accumulation' | 'tracked') =>
    ipcRenderer.invoke('processing:set-active-category', category),
  setAccumulationPeriod: (period: 'daily' | 'weekly' | 'monthly') =>
    ipcRenderer.invoke('processing:set-accumulation-period', period),
  addTrackedIncludeKeyword: (keyword: string) => ipcRenderer.invoke('filters:tracked-include-add', keyword),
  removeTrackedIncludeKeyword: (keyword: string) => ipcRenderer.invoke('filters:tracked-include-remove', keyword),
  addTrackedExcludeKeyword: (keyword: string) => ipcRenderer.invoke('filters:tracked-exclude-add', keyword),
  removeTrackedExcludeKeyword: (keyword: string) => ipcRenderer.invoke('filters:tracked-exclude-remove', keyword),
  saveWeflabUrl: (url: string) => ipcRenderer.invoke('weflab:save-url', url),
  deleteWeflabUrl: () => ipcRenderer.invoke('weflab:delete-url'),
  startMonitor: () => ipcRenderer.invoke('monitor:start'),
  stopMonitor: () => ipcRenderer.invoke('monitor:stop'),
  startTimed: (id: string) => ipcRenderer.invoke('timed:start', id),
  completeTimed: (id: string) => ipcRenderer.invoke('timed:complete', id),
  startTimerFromEvent: (id: string) => ipcRenderer.invoke('events:start-timer', id),
  startTimerFromAccumulationGroup: (ids: string[]) => ipcRenderer.invoke('accumulation:start-timer', ids),
  getAccumulationSummary: (period: 'daily' | 'weekly' | 'monthly', anchorDate: string): Promise<{
    period: string;
    from: string;
    to: string;
    items: AccumulationSummaryItem[];
  }> => ipcRenderer.invoke('accumulation:summary', period, anchorDate),
  onChanged: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('app:changed', listener);
    return () => {
      ipcRenderer.off('app:changed', listener);
    };
  },
};

contextBridge.exposeInMainWorld('rouletteApi', api);

export type RouletteApi = typeof api;
