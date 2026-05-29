import { BrowserWindow } from 'electron';
import type { EventStore } from '../storage/event-store';
import type { MappingStore } from '../storage/mapping-store';
import type { SettingsStore } from '../storage/settings-store';
import type { SecureUrlStore } from '../storage/secure-url-store';
import type { RouletteEvent, RouletteMapping } from '../../shared/types';
import { hasAccumulationAmount, parseAccumulationContent } from '../../shared/accumulation';
import { DuplicateGuard } from './duplicate-guard';
import { normalizeEvent, type RawRoulettePayload } from './event-normalizer';
import { parseWeflabRoulettePayloads } from './weflab-parser';

export class WeflabMonitor {
  private monitorWindow: BrowserWindow | null = null;
  private running = false;
  private readonly duplicateGuard = new DuplicateGuard();

  constructor(
    private readonly urlStore: SecureUrlStore,
    private readonly settingsStore: SettingsStore,
    private readonly mappingStore: MappingStore,
    private readonly eventStore: EventStore,
    private readonly onEvent: (event: RouletteEvent) => void,
  ) {}

  isRunning(): boolean {
    return this.running;
  }

  async start(): Promise<void> {
    if (this.running) return;

    const url = await this.urlStore.readUrl();
    if (!url) {
      throw new Error('위플랩 URL이 등록되어 있지 않습니다.');
    }

    this.monitorWindow = new BrowserWindow({
      width: 480,
      height: 640,
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    this.monitorWindow.webContents.on('console-message', async (_event, _level, message) => {
      const prefix = '__LRM_ROULETTE_EVENT__';
      if (!message.startsWith(prefix)) return;
      try {
        const payload = JSON.parse(message.slice(prefix.length)) as RawRoulettePayload;
        await this.ingest(payload);
      } catch (error) {
        console.error('Failed to ingest Weflab roulette event', error);
      }
    });

    await this.monitorWindow.loadURL(url);
    this.running = true;
    await this.settingsStore.update((settings) => {
      settings.monitoring.running = true;
    });

    await this.injectDomObserver();
  }

  async stop(): Promise<void> {
    if (this.monitorWindow && !this.monitorWindow.isDestroyed()) {
      this.monitorWindow.close();
    }
    this.monitorWindow = null;
    this.running = false;
    await this.settingsStore.update((settings) => {
      settings.monitoring.running = false;
    });
  }

  async ingest(payload: RawRoulettePayload, overrideMapping?: RouletteMapping): Promise<RouletteEvent | null> {
    const content = payload.roulette_content.trim();
    const explicitMapping = overrideMapping ?? (await this.mappingStore.get(content));
    const settings = await this.settingsStore.get();
    const mapping = explicitMapping ?? createDefaultMapping(content, settings.processing.accumulation_period);
    const event = normalizeEvent(payload, mapping);
    if (this.duplicateGuard.isDuplicate(event)) {
      return null;
    }

    await this.eventStore.append(event);
    await this.settingsStore.update((settings) => {
      settings.monitoring.last_received_at = event.received_at;
    });
    this.onEvent(event);
    return event;
  }

  private async injectDomObserver(): Promise<void> {
    if (!this.monitorWindow) return;

    const parserSource = parseWeflabRoulettePayloads.toString();
    await this.monitorWindow.webContents.executeJavaScript(`
      (() => {
        if (window.__localRouletteObserverInstalled) return;
        window.__localRouletteObserverInstalled = true;

        const recent = [];
        const prefix = '__LRM_ROULETTE_EVENT__';
        const parseCandidates = ${parserSource};

        function emitFromNode(node) {
          const text = node && (node.innerText || node.textContent);
          if (!text) return;
          const payloads = parseCandidates(text);
          if (!payloads.length) return;

          for (const payload of payloads) {
            const signature = payload.nickname + '|' + payload.value + '|' + payload.roulette_content + '|' + (payload.raw_payload && payload.raw_payload.batch_index);
            const now = Date.now();
            for (let index = recent.length - 1; index >= 0; index -= 1) {
              if (now - recent[index].time > 5000) recent.splice(index, 1);
            }
            if (recent.some((item) => item.signature === signature)) continue;
            recent.push({ signature, time: now });
            console.info(prefix + JSON.stringify(payload));
          }
        }

        const observer = new MutationObserver((mutations) => {
          for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
              if (node.nodeType !== Node.ELEMENT_NODE) continue;
              emitFromNode(node);
            }
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
      })();
    `);
  }
}

function createDefaultMapping(content: string, accumulationPeriod: 'daily' | 'weekly' | 'monthly'): RouletteMapping {
  if (hasAccumulationAmount(content)) {
    const parsed = parseAccumulationContent(content);
    return {
      category: 'accumulation',
      item_name: parsed.item_name,
      amount: parsed.amount,
      unit: parsed.unit,
      period_type: accumulationPeriod,
    };
  }

  return { category: 'action' };
}
