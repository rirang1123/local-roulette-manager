import http from 'node:http';
import { URL } from 'node:url';
import { parseDurationSeconds, type AppServices } from '../app-services';
import { OBS_REMOTE_ASSET_BASE } from '../../shared/constants';
import type { RouletteCategory, RouletteEvent, RouletteStatus } from '../../shared/types';

function sendJson(response: http.ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

function readBody(request: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = '';
    request.on('data', (chunk) => {
      data += chunk;
    });
    request.on('end', () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

function isAuthorized(request: http.IncomingMessage, token: string, url: URL): boolean {
  const authorization = request.headers.authorization;
  return authorization === `Bearer ${token}` || url.searchParams.get('token') === token;
}

export class LocalApiServer {
  private server: http.Server | null = null;

  constructor(private readonly services: AppServices) {}

  async start(): Promise<void> {
    if (this.server) return;
    const settings = await this.services.settingsStore.get();

    this.server = http.createServer(async (request, response) => {
      try {
        if (!request.url) {
          sendJson(response, 404, { error: 'not found' });
          return;
        }

        const url = new URL(request.url, `http://${settings.server.host}:${settings.server.port}`);

        if (request.method === 'GET' && url.pathname === '/obs-panel') {
          if (!isAuthorized(request, settings.server.token, url)) {
            response.writeHead(401);
            response.end('Unauthorized');
            return;
          }
          response.writeHead(200, {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
            pragma: 'no-cache',
            expires: '0',
          });
          response.end(renderRemoteObsShell(settings.server.token, 'obs-panel.js', 'OBS Panel'));
          return;
        }

        if (request.method === 'GET' && url.pathname === '/obs-overlay') {
          if (!isAuthorized(request, settings.server.token, url)) {
            response.writeHead(401);
            response.end('Unauthorized');
            return;
          }
          response.writeHead(200, {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
          });
          response.end(renderRemoteObsShell(settings.server.token, 'obs-overlay.js', 'OBS Overlay'));
          return;
        }

        if (url.pathname.startsWith('/api/') && !isAuthorized(request, settings.server.token, url)) {
          sendJson(response, 401, { error: 'unauthorized' });
          return;
        }

        await this.route(request, response, url);
      } catch (error) {
        sendJson(response, 500, { error: error instanceof Error ? error.message : 'internal error' });
      }
    });

    await new Promise<void>((resolve) => {
      this.server?.listen(settings.server.port, settings.server.host, resolve);
    });
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.server?.close(() => resolve());
      this.server = null;
    });
  }

  private async route(request: http.IncomingMessage, response: http.ServerResponse, url: URL): Promise<void> {
    if (request.method === 'GET' && url.pathname === '/api/status') {
      sendJson(response, 200, await this.services.status());
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/monitor/start') {
      await this.services.monitor.start();
      sendJson(response, 200, await this.services.status());
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/monitor/stop') {
      await this.services.monitor.stop();
      sendJson(response, 200, await this.services.status());
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/events/latest') {
      sendJson(response, 200, { event: await this.services.eventStore.latest() });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/action/pending') {
      sendJson(response, 200, { events: await this.services.eventStore.byCategory('action', 'pending') });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/tracked/pending') {
      sendJson(response, 200, { events: await this.services.eventStore.byCategory('tracked', 'pending') });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/timed/pending') {
      sendJson(response, 200, { events: await this.services.eventStore.byCategory('timed', 'pending') });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/timed/running') {
      sendJson(response, 200, { events: await this.services.eventStore.byCategory('timed', 'running') });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/unclassified/count') {
      const counts = await this.services.eventStore.counts();
      sendJson(response, 200, { count: counts.unclassified });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/timers/running') {
      const events = await this.services.eventStore.list({
        dateFrom: '1970-01-01',
        dateTo: '9999-12-31',
        status: 'running',
        limit: 1000,
      });
      sendJson(response, 200, {
        events: events.filter((event) => event.duration_seconds && event.remaining_seconds !== undefined),
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/processing/active-category') {
      const body = (await readBody(request)) as { category?: RouletteCategory };
      if (!isObsManagedCategory(body.category)) throw new Error('valid category is required');
      await this.services.setActiveCategory(body.category);
      sendJson(response, 200, await this.services.status());
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/processing/accumulation-period') {
      const body = (await readBody(request)) as { period?: 'daily' | 'weekly' | 'monthly' };
      if (body.period !== 'daily' && body.period !== 'weekly' && body.period !== 'monthly') {
        throw new Error('valid period is required');
      }
      await this.services.setAccumulationPeriod(body.period);
      sendJson(response, 200, await this.services.status());
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/events/sample') {
      sendJson(response, 200, { event: await this.services.addSampleEvent() });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/processing/items') {
      const category = url.searchParams.get('category');
      if (!isObsManagedCategory(category)) throw new Error('valid category is required');
      sendJson(response, 200, await this.processingItems(category));
      return;
    }

    const statusMatch = url.pathname.match(/^\/api\/events\/([^/]+)\/status$/);
    if (request.method === 'POST' && statusMatch) {
      const body = (await readBody(request)) as { status?: RouletteStatus };
      if (!body.status) throw new Error('status is required');
      sendJson(response, 200, { event: await this.services.updateStatus(statusMatch[1], body.status) });
      return;
    }

    const timedStartMatch = url.pathname.match(/^\/api\/timed\/([^/]+)\/start$/);
    if (request.method === 'POST' && timedStartMatch) {
      sendJson(response, 200, { event: await this.services.timerService.start(timedStartMatch[1]) });
      return;
    }

    const eventTimerStartMatch = url.pathname.match(/^\/api\/events\/([^/]+)\/start-timer$/);
    if (request.method === 'POST' && eventTimerStartMatch) {
      sendJson(response, 200, { event: await this.services.startTimerFromEvent(eventTimerStartMatch[1]) });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/accumulation/start-timer') {
      const body = (await readBody(request)) as { ids?: string[] };
      if (!Array.isArray(body.ids)) throw new Error('ids is required');
      sendJson(response, 200, { event: await this.services.startTimerFromAccumulationGroup(body.ids) });
      return;
    }

    const timedCompleteMatch = url.pathname.match(/^\/api\/timed\/([^/]+)\/complete$/);
    if (request.method === 'POST' && timedCompleteMatch) {
      sendJson(response, 200, { event: await this.services.timerService.complete(timedCompleteMatch[1]) });
      return;
    }

    sendJson(response, 404, { error: 'not found' });
  }

  private async processingItems(category: ObsManagedCategory): Promise<{
    category: ObsManagedCategory;
    count: number;
    events: RouletteEvent[];
    summary?: Array<{ item_name: string; amount: number; unit: string; ids: string[] }>;
  }> {
    if (category === 'action') {
      await this.services.expireActionEvents();
    }

    const events =
      category === 'tracked'
        ? [
            ...(await this.services.eventStore.byCategory('tracked', 'running')),
            ...(await this.services.eventStore.byCategory('tracked', 'pending')),
          ]
        : category === 'accumulation'
          ? [
              ...(await this.services.eventStore.byCategory('accumulation', 'running')),
              ...(await this.services.eventStore.byCategory('accumulation', 'pending')),
            ]
        : await this.services.eventStore.byCategory(category, 'pending');
    if (category !== 'accumulation') {
      return { category, count: events.length, events };
    }

    const summaryMap = new Map<string, { item_name: string; amount: number; unit: string; ids: string[] }>();
    for (const event of events) {
      const itemName = event.item_name ?? event.roulette_content;
      const unit = event.unit ?? '';
      const key = `${itemName}\u0000${unit}`;
      const current = summaryMap.get(key) ?? { item_name: itemName, amount: 0, unit, ids: [] };
      current.amount += event.amount ?? 0;
      current.ids.push(event.id);
      summaryMap.set(key, current);
    }

    const summary = [...summaryMap.values()].sort((a, b) => a.item_name.localeCompare(b.item_name));
    const summaryEvents = summary.map((item, index) => ({
      id: `summary_${index}`,
      nickname: '합산',
      value: item.ids.length,
      roulette_content: `${item.item_name} ${item.amount}${item.unit}`,
      category: 'accumulation' as const,
      status: 'pending' as const,
      received_at: new Date().toISOString(),
      item_name: item.item_name,
      amount: item.amount,
      unit: item.unit,
      raw_payload: { summary_ids: item.ids },
    }));

    return { category, count: summary.length, events: summaryEvents, summary };
  }
}

type ObsManagedCategory = Extract<RouletteCategory, 'action' | 'accumulation' | 'tracked'>;

function isObsManagedCategory(category: unknown): category is ObsManagedCategory {
  return category === 'action' || category === 'accumulation' || category === 'tracked';
}

function renderRemoteObsShell(token: string, entryFile: string, title: string): string {
  const assetVersion = Date.now().toString();
  const entryUrl = `${OBS_REMOTE_ASSET_BASE}/obs/${entryFile}?v=${assetVersion}`;
  const config = {
    token,
    assetBase: OBS_REMOTE_ASSET_BASE,
    assetVersion,
  };

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <script>window.ROULETTE_OBS_CONFIG = ${JSON.stringify(config)};</script>
  <script defer src="${entryUrl}"></script>
</head>
<body>
  <div id="root">Loading OBS UI...</div>
</body>
</html>`;
}

function renderObsPanel(token: string): string {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>룰렛 매니저</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", system-ui, sans-serif;
      background: #f3f5f7;
      color: #1d2329;
    }
    main {
      min-width: 320px;
      padding: 14px;
      display: grid;
      gap: 12px;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    h1 {
      margin: 0;
      font-size: 19px;
      line-height: 1.2;
    }
    h2 {
      margin: 0 0 8px;
      font-size: 14px;
    }
    button {
      min-height: 36px;
      border: 0;
      border-radius: 6px;
      padding: 0 12px;
      background: #1769e0;
      color: white;
      font-weight: 700;
      cursor: pointer;
    }
    button:disabled {
      cursor: default;
      opacity: 0.55;
    }
    .secondary {
      background: #e3e8ef;
      color: #1d2329;
    }
    .start {
      background: #15803d;
    }
    .stop {
      background: #c2410c;
    }
    .panel, .metric {
      background: white;
      border: 1px solid #dce2e8;
      border-radius: 8px;
      padding: 12px;
    }
    .monitor-strip {
      display: grid;
      gap: 5px;
      padding: 12px;
      border: 1px solid;
      border-radius: 8px;
    }
    .monitor-strip strong {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 15px;
    }
    .monitor-strip.running {
      background: #ecfdf3;
      border-color: #b7e4c7;
      color: #14532d;
    }
    .monitor-strip.stopped {
      background: #fff7ed;
      border-color: #fed7aa;
      color: #7c2d12;
    }
    .dot {
      width: 10px;
      height: 10px;
      border-radius: 999px;
      background: currentColor;
      display: inline-block;
    }
    .actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    .mode-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
    }
    .mode {
      display: flex;
      align-items: center;
      gap: 6px;
      min-height: 34px;
      padding: 0 9px;
      border: 1px solid #dce2e8;
      border-radius: 6px;
      background: #f8fafc;
      font-weight: 700;
      font-size: 12px;
    }
    .mode.selected {
      border-color: #1769e0;
      background: #eff6ff;
      color: #123f8c;
    }
    input[type="radio"] {
      width: 14px;
      height: 14px;
      margin: 0;
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    .metric span, .muted {
      color: #6a7480;
      font-size: 12px;
    }
    .metric strong {
      display: block;
      margin-top: 5px;
      font-size: 18px;
    }
    .event {
      margin: 0;
      line-height: 1.45;
      overflow-wrap: anywhere;
    }
    .item-list {
      display: grid;
      gap: 8px;
    }
    .item {
      display: grid;
      gap: 8px;
      padding: 10px;
      border: 1px solid #e6ebf0;
      border-radius: 6px;
      background: #fbfcfd;
    }
    .item-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .item-title {
      font-weight: 800;
      overflow-wrap: anywhere;
    }
    .item-meta {
      color: #6a7480;
      font-size: 12px;
    }
    .item button {
      width: 100%;
      min-height: 32px;
    }
    .summary {
      display: grid;
      gap: 5px;
      margin-bottom: 8px;
      color: #1d2329;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>로컬 룰렛 매니저</h1>
      <span id="urlState" class="muted">-</span>
    </header>
    <section id="monitorStrip" class="monitor-strip stopped">
      <strong><span class="dot"></span><span id="monitorLabel">불러오는 중</span></strong>
      <span id="monitorHelp" class="muted">상태 확인 중</span>
    </section>
    <div class="actions">
      <button id="start" class="start">시작</button>
      <button id="stop" class="secondary">중지</button>
    </div>
    <section class="panel">
      <h2>새 룰렛 적용 방식</h2>
      <div id="modeGrid" class="mode-grid"></div>
    </section>
    <section class="panel">
      <h2><span id="selectedTitle">선택 항목</span> <span id="selectedCount" class="muted">0개</span></h2>
      <div id="summary" class="summary"></div>
      <div id="items" class="item-list muted">없음</div>
    </section>
  </main>
  <script>
    const token = ${JSON.stringify(token)};
    let activeCategory = 'action';
    const labels = {
      action: '리액션',
      accumulation: '누적형',
      tracked: '당첨형'
    };
    async function api(path, options = {}) {
      const joiner = path.includes('?') ? '&' : '?';
      const response = await fetch(path + joiner + 'token=' + token, {
        ...options,
        headers: { 'content-type': 'application/json', ...(options.headers || {}) }
      });
      return response.json();
    }
    function renderModes() {
      const grid = document.getElementById('modeGrid');
      grid.innerHTML = Object.entries(labels).map(([key, label]) =>
        '<label class="mode ' + (activeCategory === key ? 'selected' : '') + '">' +
        '<input type="radio" name="category" value="' + key + '"' + (activeCategory === key ? ' checked' : '') + ' />' +
        '<span>' + label + '</span></label>'
      ).join('');
      grid.querySelectorAll('input').forEach((input) => {
        input.onchange = async () => {
          activeCategory = input.value;
          await api('/api/processing/active-category', {
            method: 'POST',
            body: JSON.stringify({ category: activeCategory })
          });
          await refresh();
        };
      });
    }
    function renderItems(payload) {
      document.getElementById('selectedTitle').textContent = labels[activeCategory];
      document.getElementById('selectedCount').textContent = payload.count + '개';
      const summary = document.getElementById('summary');
      summary.innerHTML = '';
      if (payload.summary && payload.summary.length) {
        summary.innerHTML = payload.summary.map((item, index) =>
          '<div class="item">' +
          '<div class="item-row"><div><div class="item-title">' + escapeHtml(item.item_name) + ' ' + item.amount + escapeHtml(item.unit) + '</div>' +
          '<div class="item-meta">원본 ' + item.ids.length + '개 합산</div></div></div>' +
          (item.unit === '초' || item.unit === '분'
            ? '<button data-action="start-accumulation-timer" data-index="' + index + '" class="start">타이머 시작</button>'
            : '') +
          '<button data-action="complete-group" data-index="' + index + '">완료</button>' +
          '</div>'
        ).join('');
        summary.querySelectorAll('button').forEach((button) => {
          button.onclick = async () => {
            const item = payload.summary[Number(button.getAttribute('data-index'))];
            if (button.getAttribute('data-action') === 'start-accumulation-timer') {
              await api('/api/accumulation/start-timer', {
                method: 'POST',
                body: JSON.stringify({ ids: item.ids })
              });
              await refresh();
              return;
            }
            for (const id of item.ids) {
              await api('/api/events/' + id + '/status', {
                method: 'POST',
                body: JSON.stringify({ status: 'completed' })
              });
            }
            await refresh();
          };
        });
      }

      const items = document.getElementById('items');
      if (payload.category === 'accumulation') {
        items.className = 'item-list muted';
        items.style.display = payload.summary && payload.summary.length ? 'none' : 'grid';
        items.textContent = payload.summary && payload.summary.length ? '' : '표시할 항목이 없습니다.';
        return;
      }
      items.style.display = 'grid';
      if (!payload.events.length) {
        items.className = 'item-list muted';
        items.textContent = '표시할 항목이 없습니다.';
        return;
      }

      items.className = 'item-list';
      items.innerHTML = payload.events.map((event) => {
        const meta = escapeHtml(event.nickname) + ' / ' + event.value + ' / ' + escapeHtml(event.status);
        const parsedDuration = parseDurationSeconds(event.roulette_content);
        const timer = event.status === 'running' && event.duration_seconds
          ? '<div class="item-meta">남은 시간: ' + (event.remaining_seconds ?? event.duration_seconds ?? 0) + '초</div>'
          : '';
        const button = event.status === 'running' && event.duration_seconds
            ? '<button data-action="complete-timed" data-id="' + event.id + '" class="stop">완료</button>'
            : parsedDuration
              ? '<button data-action="start-event-timer" data-id="' + event.id + '" class="start">타이머 시작 (' + parsedDuration + '초)</button>'
              : '<button data-action="complete" data-id="' + event.id + '">확인 완료</button>';
        return '<div class="item">' +
          '<div class="item-row"><div><div class="item-title">' + escapeHtml(event.roulette_content) + '</div>' +
          '<div class="item-meta">' + meta + '</div>' + timer + '</div></div>' +
          button +
          '</div>';
      }).join('');

      items.querySelectorAll('button').forEach((button) => {
        button.onclick = async () => {
          const id = button.getAttribute('data-id');
          const action = button.getAttribute('data-action');
          if (action === 'complete-timed') {
            await api('/api/timed/' + id + '/complete', { method: 'POST' });
          } else if (action === 'start-event-timer') {
            await api('/api/events/' + id + '/start-timer', { method: 'POST' });
          } else {
            await api('/api/events/' + id + '/status', {
              method: 'POST',
              body: JSON.stringify({ status: 'completed' })
            });
          }
          await refresh();
        };
      });
    }
    function escapeHtml(value) {
      return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
    }
    function parseDurationSeconds(text) {
      let seconds = 0;
      const hourMatch = text.match(/(\\d+)\\s*(시간|hours?|hrs?|h)/i);
      const minuteMatch = text.match(/(\\d+)\\s*(분|minutes?|mins?|m)/i);
      const secondMatch = text.match(/(\\d+)\\s*(초|seconds?|secs?|s)/i);
      if (hourMatch) seconds += Number(hourMatch[1]) * 3600;
      if (minuteMatch) seconds += Number(minuteMatch[1]) * 60;
      if (secondMatch) seconds += Number(secondMatch[1]);
      return seconds > 0 ? seconds : null;
    }
    async function refresh() {
      const status = await api('/api/status');
      activeCategory = labels[status.activeCategory] ? status.activeCategory : 'accumulation';
      renderModes();
      const running = Boolean(status.monitoring);
      const strip = document.getElementById('monitorStrip');
      strip.className = 'monitor-strip ' + (running ? 'running' : 'stopped');
      document.getElementById('monitorLabel').textContent = running ? '모니터링 중' : '모니터링 중지됨';
      document.getElementById('monitorHelp').textContent = running
        ? '마지막 수신: ' + (status.lastReceivedAt || '-')
        : '시작 버튼을 누르면 룰렛 감지를 시작합니다.';
      document.getElementById('urlState').textContent = status.weflabUrlSaved ? 'URL 등록됨' : 'URL 미등록';
      document.getElementById('start').disabled = running;
      document.getElementById('stop').disabled = !running;
      document.getElementById('start').className = running ? 'secondary' : 'start';
      document.getElementById('stop').className = running ? 'stop' : 'secondary';
      const items = await api('/api/processing/items?category=' + activeCategory);
      renderItems(items);
    }
    document.getElementById('start').onclick = () => api('/api/monitor/start', { method: 'POST' }).then(refresh).catch(alert);
    document.getElementById('stop').onclick = () => api('/api/monitor/stop', { method: 'POST' }).then(refresh).catch(alert);
    refresh();
    setInterval(refresh, 3000);
  </script>
</body>
</html>`;
}

function renderObsOverlay(token: string): string {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>룰렛 타이머 오버레이</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: transparent;
      font-family: "Segoe UI", system-ui, sans-serif;
      color: #ffffff;
      overflow: hidden;
    }
    main {
      display: grid;
      gap: 10px;
      padding: 16px;
      width: 100vw;
      min-height: 100vh;
      align-content: center;
      justify-content: center;
    }
    .timer {
      width: min(92vw, 1100px);
      min-width: 360px;
      padding: clamp(18px, 3vw, 42px);
      border-radius: 8px;
      background: rgba(18, 23, 29, 0.82);
      border: 1px solid rgba(255, 255, 255, 0.18);
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
      text-align: center;
    }
    .title {
      font-size: clamp(26px, 5vw, 64px);
      font-weight: 800;
      line-height: 1.25;
      overflow-wrap: anywhere;
    }
    .meta {
      margin-top: 10px;
      color: rgba(255, 255, 255, 0.78);
      font-size: clamp(16px, 2.4vw, 30px);
    }
    .time {
      margin-top: 16px;
      font-size: clamp(64px, 16vw, 190px);
      line-height: 1;
      font-weight: 900;
      font-variant-numeric: tabular-nums;
    }
  </style>
</head>
<body>
  <main id="root"></main>
  <script>
    const token = ${JSON.stringify(token)};
    async function api(path) {
      const joiner = path.includes('?') ? '&' : '?';
      const response = await fetch(path + joiner + 'token=' + token, { cache: 'no-store' });
      if (!response.ok) throw new Error('API ' + response.status);
      return response.json();
    }
    function formatSeconds(total) {
      const safe = Math.max(0, Number(total || 0));
      const minutes = Math.floor(safe / 60);
      const seconds = safe % 60;
      return minutes + ':' + String(seconds).padStart(2, '0');
    }
    function escapeHtml(value) {
      return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
    }
    async function refresh() {
      try {
        const payload = await api('/api/timers/running');
        const root = document.getElementById('root');
        root.innerHTML = payload.events.map((event) =>
          '<section class="timer">' +
            '<div class="title">' + escapeHtml(event.timer_name || event.roulette_content) + '</div>' +
            '<div class="meta">' + escapeHtml(event.nickname) + ' / ' + event.value + '</div>' +
            '<div class="time">' + formatSeconds(event.remaining_seconds) + '</div>' +
          '</section>'
        ).join('');
      } catch (error) {
        document.getElementById('root').innerHTML = '';
      }
    }
    refresh();
    setInterval(refresh, 1000);
  </script>
</body>
</html>`;
}
