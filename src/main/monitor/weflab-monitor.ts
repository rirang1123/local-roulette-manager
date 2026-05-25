import { BrowserWindow } from 'electron';
import type { EventStore } from '../storage/event-store';
import type { MappingStore } from '../storage/mapping-store';
import type { SettingsStore } from '../storage/settings-store';
import type { SecureUrlStore } from '../storage/secure-url-store';
import type { RouletteEvent, RouletteMapping } from '../../shared/types';
import { parseAccumulationContent } from '../../shared/accumulation';
import { DuplicateGuard } from './duplicate-guard';
import { normalizeEvent, type RawRoulettePayload } from './event-normalizer';

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
    const mapping = explicitMapping ?? createDefaultMapping(
      settings.processing.active_category,
      content,
      settings.processing.accumulation_period,
    );
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

    await this.monitorWindow.webContents.executeJavaScript(`
      (() => {
        if (window.__localRouletteObserverInstalled) return;
        window.__localRouletteObserverInstalled = true;

        const recent = [];
        const prefix = '__LRM_ROULETTE_EVENT__';

        function clean(text) {
          return String(text || '').replace(/\\s+/g, ' ').trim();
        }

        function hasRouletteSignal(text) {
          return /룰렛|당첨|미션|권|스쿼트|팔굽혀펴기|초|분|회|개|세트|벌칙|스택|인증|셀카|방셀/.test(text);
        }

        function extractValue(text) {
          const matches = [...text.matchAll(/([0-9][0-9,]*)\\s*(?:개|원|풍|별풍선|P|p|포인트)/g)];
          if (!matches.length) return 0;

          const nonContentMatch = matches.find((match) => {
            const index = match.index || 0;
            const before = text.slice(Math.max(0, index - 8), index);
            const after = text.slice(index, index + match[0].length + 8);
            return !/스쿼트|팔굽혀펴기|미션|벌칙|스택/.test(before + after);
          });

          const selected = nonContentMatch || matches[0];
          return Number(selected[1].replace(/,/g, ''));
        }

        function extractRouletteContent(lines, normalized) {
          const labeled = normalized.match(/(?:룰렛|당첨|결과)\\s*[:：\\-]?\\s*([^|/]{1,80})/u);
          if (labeled) return clean(labeled[1]);

          const contentLine = lines
            .slice()
            .reverse()
            .find((line) => /미션|권|스쿼트|팔굽혀펴기|초|분|회|개|세트|벌칙|스택|인증|셀카|방셀/.test(line));
          if (contentLine) {
            return contentLine
              .replace(/^.*?(룰렛|당첨|결과)\\s*[:：\\-]?\\s*/u, '')
              .replace(/^[^:：]{1,12}[:：]\\s*/u, '')
              .trim();
          }

          return normalized;
        }

        function extractNickname(lines, rouletteContent) {
          const labeled = lines.join(' ').match(/(?:닉네임|후원자|보낸이|from)\\s*[:：\\-]?\\s*([^|/\\s]{1,30})/i);
          if (labeled) return clean(labeled[1]);

          const candidate = lines.find((line) =>
            line !== rouletteContent &&
            !/룰렛|당첨|결과|후원|개|원|풍|별풍선|초|분|회|미션|권/.test(line) &&
            line.length <= 30
          );
          return candidate || '알 수 없음';
        }

        function parseCandidate(text) {
          const normalized = clean(text);
          if (!normalized || normalized.length < 2 || !hasRouletteSignal(normalized)) return null;

          const lines = String(text || '')
            .split(/\\n+/)
            .map(clean)
            .filter(Boolean);

          const value = extractValue(normalized);
          const rouletteContent = extractRouletteContent(lines, normalized);
          const nickname = extractNickname(lines, rouletteContent);

          if (rouletteContent.length > 80) {
            const compactMatch = normalized.match(/(?:룰렛|당첨|결과)\\s*[:：-]?\\s*([^/|]{1,50})/u);
            if (compactMatch) rouletteContent = compactMatch[1].trim();
          }

          return {
            nickname,
            value,
            roulette_content: rouletteContent,
            raw_payload: { text: normalized }
          };
        }

        function emitFromNode(node) {
          const text = clean(node && (node.innerText || node.textContent));
          if (!text) return;
          const payload = parseCandidate(text);
          if (!payload) return;

          const signature = payload.nickname + '|' + payload.value + '|' + payload.roulette_content;
          const now = Date.now();
          for (let index = recent.length - 1; index >= 0; index -= 1) {
            if (now - recent[index].time > 5000) recent.splice(index, 1);
          }
          if (recent.some((item) => item.signature === signature)) return;
          recent.push({ signature, time: now });
          console.info(prefix + JSON.stringify(payload));
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

function createDefaultMapping(
  category: 'action' | 'accumulation' | 'tracked' | 'timed',
  content: string,
  accumulationPeriod: 'daily' | 'weekly' | 'monthly',
): RouletteMapping {
  if (category === 'accumulation') {
    const parsed = parseAccumulationContent(content);
    return {
      category,
      item_name: parsed.item_name,
      amount: parsed.amount,
      unit: parsed.unit,
      period_type: accumulationPeriod,
    };
  }

  if (category === 'timed') {
    return {
      category,
      timer_name: content,
      duration_seconds: 600,
      auto_start: false,
    };
  }

  return { category };
}
