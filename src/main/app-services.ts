import { BrowserWindow } from 'electron';
import { EventEmitter } from 'node:events';
import type { AccumulationSummaryItem, AccumulationPeriodType, AppStatus, LogQuery, RouletteCatalogItem, RouletteEvent, RouletteMapping, RouletteStatus } from '../shared/types';
import { dateRangeForPeriod, nowIsoLocal } from '../shared/date';
import { hasAccumulationAmount, parseAccumulationContent } from '../shared/accumulation';
import { BackupService } from './backup/backup-service';
import { EventStore } from './storage/event-store';
import { FilterStore } from './storage/filter-store';
import { MappingStore } from './storage/mapping-store';
import { RouletteCatalogStore } from './storage/roulette-catalog-store';
import { SecureUrlStore } from './storage/secure-url-store';
import { SettingsStore } from './storage/settings-store';
import { WeflabMonitor } from './monitor/weflab-monitor';
import { TimerService } from './timer-service';

export class AppServices {
  readonly events = new EventEmitter();
  readonly settingsStore = new SettingsStore();
  readonly eventStore = new EventStore();
  readonly backupService = new BackupService(this.eventStore);
  readonly mappingStore = new MappingStore();
  readonly rouletteCatalogStore = new RouletteCatalogStore();
  readonly filterStore = new FilterStore();
  readonly urlStore = new SecureUrlStore();
  readonly timerService = new TimerService(this.eventStore, () => this.emitChange());
  readonly monitor = new WeflabMonitor(
    this.urlStore,
    this.settingsStore,
    this.mappingStore,
    this.eventStore,
    (event) => this.emitChange(event),
  );
  private dailyBackupTimer: NodeJS.Timeout | null = null;
  private actionExpiryTimer: NodeJS.Timeout | null = null;

  async startBackgroundJobs(): Promise<void> {
    await this.backupService.runDailyAutoBackup(this.settingsStore);
    await this.expireActionEvents();
    await this.timerService.restoreRunning();
    this.dailyBackupTimer = setInterval(() => {
      this.backupService.runDailyAutoBackup(this.settingsStore)
        .then((created) => {
          if (created.length) this.emitChange();
        })
        .catch(() => undefined);
    }, 60 * 60 * 1000);
    this.actionExpiryTimer = setInterval(() => {
      this.expireActionEvents().catch(() => undefined);
    }, 10 * 1000);
  }

  stopBackgroundJobs(): void {
    if (this.dailyBackupTimer) {
      clearInterval(this.dailyBackupTimer);
      this.dailyBackupTimer = null;
    }
    if (this.actionExpiryTimer) {
      clearInterval(this.actionExpiryTimer);
      this.actionExpiryTimer = null;
    }
  }

  async status(): Promise<AppStatus> {
    const settings = await this.settingsStore.get();
    if (settings.processing.active_category === 'timed') {
      settings.processing.active_category = 'accumulation';
      await this.settingsStore.set(settings);
    }
    const [weflabUrlSaved, rouletteShareUrlSaved, latestEvent, counts, filters] = await Promise.all([
      this.urlStore.hasUrl(),
      this.urlStore.hasRouletteShareUrl(),
      this.eventStore.latest(),
      this.eventStore.counts(),
      this.filterStore.get(),
    ]);

    const baseUrl = `http://${settings.server.host}:${settings.server.port}`;
    const uiVersion = '20260525-0324';
    return {
      monitoring: this.monitor.isRunning(),
      weflabUrlSaved,
      rouletteShareUrlSaved,
      lastReceivedAt: settings.monitoring.last_received_at,
      serverUrl: baseUrl,
      obsPanelUrl: `${baseUrl}/obs-panel?token=${settings.server.token}&v=${uiVersion}`,
      obsOverlayUrl: `${baseUrl}/obs-overlay?token=${settings.server.token}&v=${uiVersion}`,
      latestEvent,
      counts,
      activeCategory: settings.processing.active_category,
      accumulationPeriod: settings.processing.accumulation_period,
      filters,
    };
  }

  async saveWeflabUrl(url: string): Promise<void> {
    if (!/^https:\/\/weflab\.com\/page\/.+/.test(url.trim())) {
      throw new Error('위플랩 후원알림 URL 형식이 아닙니다.');
    }
    await this.urlStore.saveUrl(url.trim());
    await this.settingsStore.update((settings) => {
      settings.monitoring.weflab_url_saved = true;
    });
    this.emitChange();
  }

  async saveRouletteShareUrl(url: string): Promise<RouletteCatalogItem[]> {
    if (!/^https:\/\/.+/i.test(url.trim())) {
      throw new Error('룰렛 확률 공유 URL은 https:// 로 시작해야 합니다.');
    }
    await this.urlStore.saveRouletteShareUrl(url.trim());
    const items = await this.refreshRouletteCatalog();
    this.emitChange();
    return items;
  }

  async refreshRouletteCatalog(): Promise<RouletteCatalogItem[]> {
    const url = await this.urlStore.readRouletteShareUrl();
    if (!url) {
      throw new Error('시청자 룰렛 확률 공유 URL이 등록되어 있지 않습니다.');
    }
    const scraped = await scrapeRouletteCatalog(url);
    await this.rouletteCatalogStore.set(scraped);
    return this.listRouletteCatalog();
  }

  async listRouletteCatalog(): Promise<RouletteCatalogItem[]> {
    const [items, mappings] = await Promise.all([
      this.rouletteCatalogStore.get(),
      this.mappingStore.getAll(),
    ]);
    const period = await this.currentAccumulationPeriod();
    return items.map((item) => ({
      ...item,
      mapped_category: mappings[item.content]?.category ?? this.defaultMappingForContent(item.content, period).category,
    }));
  }

  async deleteWeflabUrl(): Promise<void> {
    await this.monitor.stop();
    await this.urlStore.deleteUrl();
    await this.settingsStore.update((settings) => {
      settings.monitoring.weflab_url_saved = false;
      settings.monitoring.running = false;
    });
    this.emitChange();
  }

  async listEvents(query: LogQuery): Promise<RouletteEvent[]> {
    return this.eventStore.list(query);
  }

  async setMapping(content: string, mapping: RouletteMapping): Promise<void> {
    await this.mappingStore.set(content, mapping);
    await this.eventStore.applyMappingToAnyContent(content, mapping);
    this.emitChange();
  }

  async markTrackedRoulette(content: string): Promise<void> {
    await this.setMapping(content, { category: 'tracked' });
  }

  async useAutoClassification(content: string): Promise<void> {
    await this.mappingStore.delete(content);
    await this.eventStore.applyAutoClassificationToContent(content, await this.currentAccumulationPeriod());
    this.emitChange();
  }

  async updateStatus(id: string, status: RouletteStatus): Promise<RouletteEvent | null> {
    const event = await this.eventStore.updateStatus(id, status);
    this.emitChange();
    return event;
  }

  async expireActionEvents(): Promise<number> {
    const changed = await this.eventStore.completeExpiredActionEvents(60 * 1000);
    if (changed) this.emitChange();
    return changed;
  }

  async deleteAllLogs(): Promise<number> {
    const deleted = await this.eventStore.deleteAll();
    this.emitChange();
    return deleted;
  }

  async setActiveCategory(category: 'action' | 'accumulation' | 'tracked' | 'timed'): Promise<void> {
    await this.settingsStore.update((settings) => {
      settings.processing.active_category =
        category === 'timed' ? 'accumulation' : category;
    });
    this.emitChange();
  }

  async setAccumulationPeriod(period: 'daily' | 'weekly' | 'monthly'): Promise<void> {
    await this.settingsStore.update((settings) => {
      settings.processing.accumulation_period = period;
    });
    this.emitChange();
  }

  async accumulationSummary(
    period: Extract<AccumulationPeriodType, 'daily' | 'weekly' | 'monthly'>,
    anchorDate: string,
  ): Promise<{ period: string; from: string; to: string; items: AccumulationSummaryItem[] }> {
    const range = dateRangeForPeriod(period, anchorDate);
    const events = await this.eventStore.list({
      dateFrom: range.from,
      dateTo: range.to,
      category: 'accumulation',
      status: 'all',
      limit: 100000,
    });
    const activeEvents = events.filter((event) => event.period_type === period && event.status !== 'canceled');
    const summary = new Map<string, AccumulationSummaryItem>();

    for (const event of activeEvents) {
      const itemName = event.item_name ?? event.roulette_content;
      const unit = event.unit ?? '';
      const key = `${itemName}\u0000${unit}`;
      const current = summary.get(key) ?? { item_name: itemName, amount: 0, unit, ids: [] };
      current.amount += event.amount ?? 0;
      current.ids.push(event.id);
      summary.set(key, current);
    }

    return {
      period,
      ...range,
      items: [...summary.values()].sort((a, b) => a.item_name.localeCompare(b.item_name)),
    };
  }

  async startTimerFromEvent(id: string): Promise<RouletteEvent | null> {
    let canStart = false;
    await this.eventStore.updateEvent(id, (event) => {
      const duration = parseDurationSeconds(event.roulette_content);
      if (!duration) return;
      canStart = true;
      event.status = 'pending';
      event.timer_name = event.roulette_content;
      event.duration_seconds = duration;
      event.remaining_seconds = duration;
      event.started_at = event.started_at ?? null;
      event.ended_at = null;
    });

    if (!canStart) {
      return null;
    }

    const event = await this.timerService.start(id);
    this.emitChange();
    return event;
  }

  async startTimerFromAccumulationGroup(ids: string[]): Promise<RouletteEvent | null> {
    const events = await this.eventStore.findByIds(ids);
    const activeEvents = events.filter((event) => event.status !== 'completed' && event.status !== 'canceled');
    if (!activeEvents.length) return null;

    const first = activeEvents[0];
    const unit = first.unit;
    if (unit !== '초' && unit !== '분') return null;

    const totalSeconds = activeEvents.reduce((sum, event) => {
      const amount = event.amount ?? 0;
      return sum + (unit === '분' ? amount * 60 : amount);
    }, 0);
    if (totalSeconds <= 0) return null;

    await this.eventStore.updateEvent(first.id, (event) => {
      event.status = 'pending';
      event.timer_name = `${first.item_name ?? first.roulette_content} ${unit === '분' ? totalSeconds / 60 : totalSeconds}${unit}`;
      event.duration_seconds = totalSeconds;
      event.remaining_seconds = totalSeconds;
      event.started_at = null;
      event.ended_at = null;
    });

    for (const event of activeEvents.slice(1)) {
      await this.eventStore.updateStatus(event.id, 'completed');
    }

    const timer = await this.timerService.start(first.id);
    this.emitChange();
    return timer;
  }

  async addTrackedIncludeKeyword(keyword: string): Promise<void> {
    await this.filterStore.addTrackedIncludeKeyword(keyword);
    this.emitChange();
  }

  async removeTrackedIncludeKeyword(keyword: string): Promise<void> {
    await this.filterStore.removeTrackedIncludeKeyword(keyword);
    this.emitChange();
  }

  async addTrackedExcludeKeyword(keyword: string): Promise<void> {
    await this.filterStore.addTrackedExcludeKeyword(keyword);
    this.emitChange();
  }

  async removeTrackedExcludeKeyword(keyword: string): Promise<void> {
    await this.filterStore.removeTrackedExcludeKeyword(keyword);
    this.emitChange();
  }

  async addSampleEvent(): Promise<RouletteEvent | null> {
    const settings = await this.settingsStore.get();
    const suffix = `${Math.floor(Math.random() * 90) + 10}`;
    const samples = [
      { nickname: `팬${suffix}`, value: 700, roulette_content: '스쿼트 10회' },
      { nickname: `팬${suffix}`, value: 700, roulette_content: '30초 미션' },
      { nickname: `팬${suffix}`, value: 700, roulette_content: '10분 미션권' },
      { nickname: `팬${suffix}`, value: 700, roulette_content: '팔굽혀펴기 5개' },
      { nickname: `팬${suffix}`, value: 1000, roulette_content: '방셀권' },
      { nickname: `팬${suffix}`, value: 1000, roulette_content: '셀카 업로드' },
      { nickname: `팬${suffix}`, value: 1000, roulette_content: '사진 인증' },
      { nickname: `팬${suffix}`, value: 1000, roulette_content: '방송 후 업로드' },
      { nickname: `팬${suffix}`, value: 500, roulette_content: '샘플 리액션' },
    ];
    const sample = samples[Math.floor(Math.random() * samples.length)];
    const explicitMapping = await this.mappingStore.get(sample.roulette_content);
    const mapping = explicitMapping ?? this.defaultMappingForContent(sample.roulette_content, settings.processing.accumulation_period);
    return this.monitor.ingest(sample, mapping);
  }

  private defaultMappingForContent(content: string, period: 'daily' | 'weekly' | 'monthly'): RouletteMapping {
    if (hasAccumulationAmount(content)) {
      const parsedAccumulation = parseAccumulationContent(content);
      return {
        category: 'accumulation' as const,
        ...parsedAccumulation,
        period_type: period,
      };
    }
    return { category: 'action' };
  }

  private async currentAccumulationPeriod(): Promise<'daily' | 'weekly' | 'monthly'> {
    const settings = await this.settingsStore.get();
    return settings.processing.accumulation_period;
  }

  private emitChange(event?: RouletteEvent): void {
    this.events.emit('change', event ?? null);
  }
}

export function parseDurationSeconds(text: string): number | null {
  let seconds = 0;
  const hourMatch = text.match(/(\d+)\s*(시간|hours?|hrs?|h)/i);
  const minuteMatch = text.match(/(\d+)\s*(분|minutes?|mins?|m)/i);
  const secondMatch = text.match(/(\d+)\s*(초|seconds?|secs?|s)/i);

  if (hourMatch) seconds += Number(hourMatch[1]) * 3600;
  if (minuteMatch) seconds += Number(minuteMatch[1]) * 60;
  if (secondMatch) seconds += Number(secondMatch[1]);

  return seconds > 0 ? seconds : null;
}

async function scrapeRouletteCatalog(url: string): Promise<Array<{ content: string; chance_text?: string }>> {
  const window = new BrowserWindow({
    width: 900,
    height: 700,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  try {
    await window.loadURL(url);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const items = await window.webContents.executeJavaScript(`
      (() => {
        function clean(value) {
          return String(value || '').replace(/\\s+/g, ' ').trim();
        }
        function normalizeName(text) {
          return clean(text)
            .replace(/\\b\\d+(?:\\.\\d+)?\\s*%\\b/g, '')
            .replace(/확률|당첨|룰렛|목록|시청자|공유/g, '')
            .replace(/^[#\\-•·*\\s]+/, '')
            .replace(/[|/]+$/, '')
            .trim();
        }
        const directItems = [];
        for (const row of document.querySelectorAll('.roulette_box')) {
          const name = clean(row.querySelector('.input_roulette_name')?.value || '');
          const percent = clean(row.querySelector('.input_roulette_percent')?.value || '');
          if (name) {
            directItems.push({
              content: name,
              chance_text: percent ? percent + '%' : undefined
            });
          }
        }
        if (directItems.length) {
          const seen = new Set();
          return directItems.filter((item) => {
            if (seen.has(item.content)) return false;
            seen.add(item.content);
            return true;
          });
        }

        const candidates = [];
        const selectors = ['tr', 'li', '[role="row"]', '[class*="item"]', '[class*="roulette"]', '[class*="reward"]'];
        for (const selector of selectors) {
          for (const node of document.querySelectorAll(selector)) {
            const text = clean(node.innerText || node.textContent);
            if (!text || text.length > 160) continue;
            if (!/(\\d+(?:\\.\\d+)?\\s*%|확률|룰렛|당첨|초|분|회|개|권|미션|인증|셀카|방셀)/.test(text)) continue;
            const chance = text.match(/\\d+(?:\\.\\d+)?\\s*%/)?.[0];
            const parts = text.split(/\\n|\\t| {2,}|\\|/).map(clean).filter(Boolean);
            const likely = parts.find((part) => !/^\\d+(?:\\.\\d+)?\\s*%$/.test(part) && !/확률|당첨|룰렛|목록|시청자|공유/.test(part)) || text;
            const content = normalizeName(likely);
            if (content && content.length <= 60) candidates.push({ content, chance_text: chance });
          }
        }
        if (!candidates.length) {
          const lines = clean(document.body.innerText).split(/(?=\\d+(?:\\.\\d+)?\\s*%)|\\n/).map(clean).filter(Boolean);
          for (const line of lines) {
            if (line.length > 120 || !/(\\d+(?:\\.\\d+)?\\s*%|초|분|회|개|권|미션|인증|셀카|방셀)/.test(line)) continue;
            const chance = line.match(/\\d+(?:\\.\\d+)?\\s*%/)?.[0];
            const content = normalizeName(line);
            if (content && content.length <= 60) candidates.push({ content, chance_text: chance });
          }
        }
        const seen = new Set();
        return candidates.filter((item) => {
          const key = item.content;
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      })();
    `) as Array<{ content: string; chance_text?: string }>;

    if (!items.length) {
      throw new Error('룰렛 확률 공유 페이지에서 항목을 찾지 못했습니다.');
    }
    return items;
  } finally {
    if (!window.isDestroyed()) {
      window.close();
    }
  }
}
