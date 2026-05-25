(function () {
  const config = window.ROULETTE_OBS_CONFIG || {};
  const token = config.token || '';
  const assetBase = config.assetBase || '';
  const assetVersion = config.assetVersion || Date.now();
  let trackedFilter = 'all';

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

  function renderShell() {
    document.body.innerHTML = `
      <main>
        <header>
          <div>
            <h1>룰렛 매니저</h1>
            <span id="urlState" class="muted">-</span>
          </div>
          <button id="sample" class="secondary">샘플</button>
        </header>
        <section id="monitorStatus" class="status stopped">
          <strong id="monitorLabel">상태 확인 중</strong>
          <span id="monitorHelp" class="muted">-</span>
        </section>
        <div class="actions">
          <button id="start" class="start">모니터링 시작</button>
          <button id="stop" class="secondary">모니터링 중지</button>
        </div>
        <section class="panel">
          <h2>자동 분류</h2>
          <p class="muted">당첨룰렛으로 지정한 항목만 당첨 처리하고, 숫자+단위는 누적형, 나머지는 리액션으로 분류됩니다.</p>
          <div class="field">
            <label for="accumulationPeriod">새 누적형 기본 기간</label>
            <select id="accumulationPeriod">
              <option value="daily">일 단위</option>
              <option value="weekly">주 단위</option>
              <option value="monthly">월 단위</option>
            </select>
          </div>
        </section>
        <section class="panel">
          <div class="row"><h2>리액션</h2><span id="actionCount" class="muted">0개</span></div>
          <div id="actionItems" class="list"></div>
        </section>
        <section class="panel">
          <div class="row"><h2>당첨룰렛</h2><span id="trackedCount" class="muted">0개</span></div>
          <div class="field"><select id="trackedFilter"></select></div>
          <div id="trackedItems" class="list"></div>
        </section>
        <section class="panel">
          <div class="row"><h2>누적형</h2><span id="accumulationCount" class="muted">0개</span></div>
          <div id="accumulationItems" class="list"></div>
        </section>
      </main>
    `;
    document.getElementById('start').onclick = () => api('/api/monitor/start', { method: 'POST' }).then(refresh).catch(alert);
    document.getElementById('stop').onclick = () => api('/api/monitor/stop', { method: 'POST' }).then(refresh).catch(alert);
    document.getElementById('sample').onclick = () => api('/api/events/sample', { method: 'POST' }).then(refresh).catch(() => undefined);
    document.getElementById('trackedFilter').onchange = (event) => {
      trackedFilter = event.target.value;
      refresh().catch(() => undefined);
    };
    document.getElementById('accumulationPeriod').onchange = (event) => api('/api/processing/accumulation-period', {
      method: 'POST',
      body: JSON.stringify({ period: event.target.value }),
    }).then(refresh).catch(alert);
  }

  function renderTrackedFilter(events) {
    const select = document.getElementById('trackedFilter');
    const current = trackedFilter;
    const options = [...new Set(events.map((event) => event.roulette_content))].sort((a, b) => a.localeCompare(b));
    if (current !== 'all' && !options.includes(current)) trackedFilter = 'all';
    select.innerHTML = '<option value="all">전체 당첨 항목</option>' + options.map((content) =>
      `<option value="${escapeHtml(content)}" ${trackedFilter === content ? 'selected' : ''}>${escapeHtml(content)}</option>`
    ).join('');
  }

  function renderCards(rootId, events, emptyText) {
    const root = document.getElementById(rootId);
    if (!events.length) {
      root.innerHTML = `<div class="empty">${emptyText}</div>`;
      return;
    }
    root.innerHTML = events.map((event) => {
      const duration = parseDurationSeconds(event.roulette_content);
      let button = `<button class="secondary" data-action="complete" data-id="${event.id}">완료</button>`;
      if (event.category === 'action') {
        button = `<button class="secondary" data-action="complete" data-id="${event.id}">없애기</button>`;
      } else if (event.status === 'running' && event.duration_seconds) {
        button = `<button class="stop" data-action="complete-timed" data-id="${event.id}">타이머 완료</button>`;
      } else if (duration) {
        button = `<button class="start" data-action="start-timer" data-id="${event.id}">타이머 시작 (${duration}초)</button>`;
      }
      return `
        <article class="item">
          <div>
            <div class="item-title">${escapeHtml(event.roulette_content)}</div>
            <div class="meta">${escapeHtml(event.nickname)} / ${event.value} / ${escapeHtml(event.status)}</div>
          </div>
          ${button}
        </article>
      `;
    }).join('');
    root.querySelectorAll('button').forEach((button) => {
      button.onclick = async () => {
        const id = button.dataset.id;
        const action = button.dataset.action;
        if (action === 'complete-timed') {
          await api(`/api/timed/${id}/complete`, { method: 'POST' });
        } else if (action === 'start-timer') {
          await api(`/api/events/${id}/start-timer`, { method: 'POST' });
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

  function renderAccumulation(payload) {
    document.getElementById('accumulationCount').textContent = `${payload.count}개`;
    const root = document.getElementById('accumulationItems');
    const summary = payload.summary || [];
    if (!summary.length) {
      root.innerHTML = '<div class="empty">처리할 누적형이 없습니다.</div>';
      return;
    }
    root.innerHTML = summary.map((item, index) => {
      const canStartTimer = item.unit === '초' || item.unit === '분';
      return `
        <article class="item">
          <div>
            <div class="item-title">${escapeHtml(item.item_name)} ${item.amount}${escapeHtml(item.unit)}</div>
            <div class="meta">원본 ${item.ids.length}개 합산</div>
          </div>
          ${canStartTimer ? `<button class="start" data-action="start-accumulation" data-index="${index}">타이머 시작</button>` : ''}
          <button class="secondary" data-action="complete-group" data-index="${index}">완료</button>
        </article>
      `;
    }).join('');
    root.querySelectorAll('button').forEach((button) => {
      button.onclick = async () => {
        const item = summary[Number(button.dataset.index)];
        if (button.dataset.action === 'start-accumulation') {
          await api('/api/accumulation/start-timer', {
            method: 'POST',
            body: JSON.stringify({ ids: item.ids }),
          });
        } else {
          for (const id of item.ids) {
            await api(`/api/events/${id}/status`, {
              method: 'POST',
              body: JSON.stringify({ status: 'completed' }),
            });
          }
        }
        await refresh();
      };
    });
  }

  async function refresh() {
    const [status, action, tracked, accumulation] = await Promise.all([
      api('/api/status'),
      api('/api/processing/items?category=action'),
      api('/api/processing/items?category=tracked'),
      api('/api/processing/items?category=accumulation'),
    ]);
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
    document.getElementById('accumulationPeriod').value = status.accumulationPeriod || 'weekly';

    renderTrackedFilter(tracked.events);
    const trackedEvents = trackedFilter === 'all'
      ? tracked.events
      : tracked.events.filter((event) => event.roulette_content === trackedFilter);

    document.getElementById('actionCount').textContent = `${action.count}개`;
    document.getElementById('trackedCount').textContent = `${trackedEvents.length}개`;
    renderCards('actionItems', action.events, '처리할 리액션이 없습니다.');
    renderCards('trackedItems', trackedEvents, '처리할 당첨룰렛이 없습니다.');
    renderAccumulation(accumulation);
  }

  renderShell();
  refresh().catch((error) => {
    document.getElementById('actionItems').innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
  });
  setInterval(() => refresh().catch(() => undefined), 3000);
})();
