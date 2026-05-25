(function () {
  const config = window.ROULETTE_OBS_CONFIG || {};
  const token = config.token || '';
  const assetBase = config.assetBase || '';
  const assetVersion = config.assetVersion || Date.now();
  const categories = [
    ['action', '리액션'],
    ['tracked', '추적'],
    ['accumulation', '누적'],
  ];
  let activeCategory = 'action';

  injectStyle(`${assetBase}/obs/obs-panel.css?v=${assetVersion}`);

  function api(path, options = {}) {
    const joiner = path.includes('?') ? '&' : '?';
    return fetch(`${path}${joiner}token=${encodeURIComponent(token)}`, {
      ...options,
      cache: 'no-store',
      headers: {
        'content-type': 'application/json',
        ...(options.headers || {}),
      },
    }).then((response) => {
      if (!response.ok) throw new Error(`API ${response.status}`);
      return response.json();
    });
  }

  function injectStyle(href) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
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
    const hourMatch = text.match(/(\d+)\s*(시간|hours?|hrs?|h)/i);
    const minuteMatch = text.match(/(\d+)\s*(분|minutes?|mins?|m)/i);
    const secondMatch = text.match(/(\d+)\s*(초|seconds?|secs?|s)/i);
    if (hourMatch) seconds += Number(hourMatch[1]) * 3600;
    if (minuteMatch) seconds += Number(minuteMatch[1]) * 60;
    if (secondMatch) seconds += Number(secondMatch[1]);
    return seconds > 0 ? seconds : null;
  }

  function labelFor(category) {
    return categories.find(([key]) => key === category)?.[1] || category;
  }

  function renderShell() {
    document.body.innerHTML = `
      <main>
        <header>
          <h1>룰렛 매니저</h1>
          <span id="urlState" class="muted">-</span>
        </header>
        <section id="monitorStatus" class="status stopped">
          <strong id="monitorLabel">상태 확인 중</strong>
          <span id="monitorHelp" class="muted">-</span>
        </section>
        <div class="actions">
          <button id="start" class="start">시작</button>
          <button id="stop" class="secondary">중지</button>
        </div>
        <section class="panel">
          <h2>룰렛 적용 방식</h2>
          <div id="modes" class="modes"></div>
        </section>
        <section class="panel">
          <div class="row">
            <h2 id="selectedTitle">항목</h2>
            <span id="selectedCount" class="muted">0개</span>
          </div>
          <div id="items" class="list"></div>
        </section>
      </main>
    `;
    document.getElementById('start').onclick = () => api('/api/monitor/start', { method: 'POST' }).then(refresh).catch(alert);
    document.getElementById('stop').onclick = () => api('/api/monitor/stop', { method: 'POST' }).then(refresh).catch(alert);
  }

  function renderModes() {
    const root = document.getElementById('modes');
    root.innerHTML = categories.map(([key, label]) =>
      `<button class="mode ${activeCategory === key ? 'selected' : ''}" data-category="${key}">${label}</button>`
    ).join('');
    root.querySelectorAll('button').forEach((button) => {
      button.onclick = async () => {
        activeCategory = button.dataset.category;
        await api('/api/processing/active-category', {
          method: 'POST',
          body: JSON.stringify({ category: activeCategory }),
        });
        await refresh();
      };
    });
  }

  function renderItems(payload) {
    document.getElementById('selectedTitle').textContent = labelFor(activeCategory);
    document.getElementById('selectedCount').textContent = `${payload.count}개`;
    const root = document.getElementById('items');

    if (!payload.events.length) {
      root.innerHTML = '<div class="empty">표시할 항목이 없습니다.</div>';
      return;
    }

    root.innerHTML = payload.events.map((event, index) => {
      const title = escapeHtml(event.roulette_content);
      const meta = `${escapeHtml(event.nickname)} / ${event.value} / ${escapeHtml(event.status)}`;
      const duration = parseDurationSeconds(event.roulette_content);
      let button = `<button data-action="complete" data-id="${event.id}">완료</button>`;
      if (event.status === 'running' && event.duration_seconds) {
        button = `<button class="stop" data-action="complete-timed" data-id="${event.id}">타이머 완료</button>`;
      } else if (duration) {
        button = `<button class="start" data-action="start-timer" data-id="${event.id}">타이머 시작 (${duration}초)</button>`;
      }
      if (payload.category === 'accumulation' && payload.summary?.[index]) {
        const summary = payload.summary[index];
        const canStartTimer = summary.unit === '초' || summary.unit === '분';
        return `
          <article class="item">
            <div>
              <div class="item-title">${escapeHtml(summary.item_name)} ${summary.amount}${escapeHtml(summary.unit)}</div>
              <div class="meta">원본 ${summary.ids.length}개 합산</div>
            </div>
            ${canStartTimer ? `<button class="start" data-action="start-accumulation" data-index="${index}">타이머 시작</button>` : ''}
            <button data-action="complete-group" data-index="${index}">완료</button>
          </article>
        `;
      }
      return `
        <article class="item">
          <div>
            <div class="item-title">${title}</div>
            <div class="meta">${meta}</div>
          </div>
          ${button}
        </article>
      `;
    }).join('');

    root.querySelectorAll('button').forEach((button) => {
      button.onclick = async () => {
        const action = button.dataset.action;
        const id = button.dataset.id;
        if (action === 'complete-timed') {
          await api(`/api/timed/${id}/complete`, { method: 'POST' });
        } else if (action === 'start-timer') {
          await api(`/api/events/${id}/start-timer`, { method: 'POST' });
        } else if (action === 'start-accumulation') {
          const item = payload.summary[Number(button.dataset.index)];
          await api('/api/accumulation/start-timer', {
            method: 'POST',
            body: JSON.stringify({ ids: item.ids }),
          });
        } else if (action === 'complete-group') {
          const item = payload.summary[Number(button.dataset.index)];
          for (const groupId of item.ids) {
            await api(`/api/events/${groupId}/status`, {
              method: 'POST',
              body: JSON.stringify({ status: 'completed' }),
            });
          }
        } else {
          await api(`/api/events/${id}/status`, {
            method: 'POST',
            body: JSON.stringify({ status: 'completed' }),
          });
        }
        await refresh();
      };
    });
  }

  async function refresh() {
    const status = await api('/api/status');
    activeCategory = labelFor(status.activeCategory) === status.activeCategory ? 'action' : status.activeCategory;
    const running = Boolean(status.monitoring);
    const monitor = document.getElementById('monitorStatus');
    monitor.className = `status ${running ? 'running' : 'stopped'}`;
    document.getElementById('monitorLabel').textContent = running ? '모니터링 중' : '모니터링 중지';
    document.getElementById('monitorHelp').textContent = running
      ? `마지막 수신: ${status.lastReceivedAt || '-'}`
      : '시작 버튼을 누르면 룰렛 감지를 시작합니다.';
    document.getElementById('urlState').textContent = status.weflabUrlSaved ? 'URL 등록됨' : 'URL 미등록';
    document.getElementById('start').disabled = running;
    document.getElementById('stop').disabled = !running;
    renderModes();
    renderItems(await api(`/api/processing/items?category=${activeCategory}`));
  }

  renderShell();
  refresh().catch((error) => {
    document.getElementById('items').innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
  });
  setInterval(() => refresh().catch(() => undefined), 3000);
})();
