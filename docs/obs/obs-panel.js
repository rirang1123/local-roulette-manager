(function () {
  const config = window.ROULETTE_OBS_CONFIG || {};
  const token = config.token || '';
  const assetBase = config.assetBase || '';
  const assetVersion = config.assetVersion || Date.now();
  let activeTab = 'all';
  let period = 'daily';
  let fromDate = new Date().toISOString().slice(0, 10);
  let toDate = fromDate;

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

  function formatSeconds(total) {
    const safe = Math.max(0, Number(total || 0));
    const minutes = Math.floor(safe / 60);
    const seconds = safe % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  function formatDateKeyLocal(date) {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-');
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
        <section class="panel toolbar">
          <div class="tabs">
            <button data-tab="all">전체</button>
            <button data-tab="action">리액션</button>
            <button data-tab="tracked">당첨</button>
            <button data-tab="accumulation">누적</button>
          </div>
          <div class="period-bar">
            <select id="period">
              <option value="daily">일</option>
              <option value="weekly">주</option>
              <option value="monthly">월</option>
            </select>
            <input id="fromDate" type="date" />
            <input id="toDate" type="date" />
          </div>
        </section>
        <section class="panel">
          <div class="row">
            <h2 id="listTitle">전체</h2>
            <span id="listCount" class="muted">0개</span>
          </div>
          <div id="rangeText" class="muted"></div>
          <div id="items" class="list"></div>
        </section>
      </main>
    `;
    document.getElementById('start').onclick = () => api('/api/monitor/start', { method: 'POST' }).then(refresh).catch(alert);
    document.getElementById('stop').onclick = () => api('/api/monitor/stop', { method: 'POST' }).then(refresh).catch(alert);
    document.getElementById('sample').onclick = () => api('/api/events/sample', { method: 'POST' }).then(refresh).catch(() => undefined);
    document.querySelectorAll('[data-tab]').forEach((button) => {
      button.onclick = () => {
        activeTab = button.dataset.tab;
        refresh().catch(() => undefined);
      };
    });
    document.getElementById('period').value = period;
    document.getElementById('period').onchange = (event) => {
      period = event.target.value;
      applyQuickRange();
      refresh().catch(() => undefined);
    };
    document.getElementById('fromDate').value = fromDate;
    document.getElementById('fromDate').onchange = (event) => {
      fromDate = event.target.value || new Date().toISOString().slice(0, 10);
      if (toDate < fromDate) toDate = fromDate;
      document.getElementById('toDate').value = toDate;
      refresh().catch(() => undefined);
    };
    document.getElementById('toDate').value = toDate;
    document.getElementById('toDate').onchange = (event) => {
      toDate = event.target.value || fromDate;
      if (toDate < fromDate) fromDate = toDate;
      document.getElementById('fromDate').value = fromDate;
      refresh().catch(() => undefined);
    };
  }

  function applyQuickRange() {
    const anchor = new Date(`${fromDate}T00:00:00`);
    if (period === 'daily') {
      toDate = fromDate;
    } else if (period === 'monthly') {
      fromDate = `${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, '0')}-01`;
      toDate = formatDateKeyLocal(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0));
    } else {
      const day = anchor.getDay();
      const mondayOffset = day === 0 ? -6 : 1 - day;
      const start = new Date(anchor);
      start.setDate(anchor.getDate() + mondayOffset);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      fromDate = formatDateKeyLocal(start);
      toDate = formatDateKeyLocal(end);
    }
    document.getElementById('fromDate').value = fromDate;
    document.getElementById('toDate').value = toDate;
  }

  function updateTabs() {
    document.querySelectorAll('[data-tab]').forEach((button) => {
      button.className = button.dataset.tab === activeTab ? 'selected' : '';
    });
    document.querySelector('.period-bar').className = activeTab === 'action' ? 'period-bar hidden' : 'period-bar';
  }

  function actionSecondsLeft(event) {
    const receivedAt = Date.parse(event.received_at);
    if (Number.isNaN(receivedAt)) return null;
    return Math.max(0, Math.ceil((receivedAt + 60 * 1000 - Date.now()) / 1000));
  }

  function renderCards(root, events, emptyText, category, options = {}) {
    if (!events.length) {
      root.innerHTML = options.hideEmpty ? '' : `<div class="empty">${emptyText}</div>`;
      return;
    }
    root.innerHTML = events.map((event) => {
      const duration = parseDurationSeconds(event.roulette_content);
      let button = `<button class="secondary" data-action="complete" data-id="${event.id}">완료</button>`;
      if (category === 'action') {
        button = `<button class="secondary" data-action="complete" data-id="${event.id}">없애기</button>`;
      } else if (event.status === 'running' && event.duration_seconds) {
        button = `
          <button class="start timer-running" disabled>타이머 실행 중 (${formatSeconds(event.remaining_seconds ?? event.duration_seconds)})</button>
          <button class="stop" data-action="complete-timed" data-id="${event.id}">타이머 완료</button>
        `;
      } else if (duration) {
        button = `<button class="start" data-action="start-timer" data-id="${event.id}">타이머 시작 (${duration}초)</button>`;
      }
      return `
        <article class="item">
          <div>
            <div class="item-title">${escapeHtml(event.roulette_content)}</div>
            <div class="meta">${escapeHtml(event.nickname)} / ${event.value} / ${escapeHtml(event.status)}</div>
            ${category === 'action' ? `<div class="meta">자동 삭제까지 ${actionSecondsLeft(event) ?? '-'}초</div>` : ''}
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

  function renderAccumulation(root, payload, options = {}) {
    const summary = payload.summary || [];
    if (!summary.length) {
      root.innerHTML = options.hideEmpty ? '' : '<div class="empty">해당 기간에 처리할 누적형이 없습니다.</div>';
      return;
    }
    root.innerHTML = summary.map((item, index) => {
      const canStartTimer = item.unit === '초' || item.unit === '분';
      const timerButton = item.running
        ? `<button class="start timer-running" disabled>타이머 실행 중 (${formatSeconds(item.remaining_seconds ?? item.duration_seconds)})</button>`
        : canStartTimer
          ? `<button class="start" data-action="start-accumulation" data-index="${index}">타이머 시작</button>`
          : '';
      return `
        <article class="item">
          <div>
            <div class="item-title">${escapeHtml(item.item_name)} ${item.amount}${escapeHtml(item.unit)}</div>
            <div class="meta">미완료 ${item.ids.length}개 합산</div>
          </div>
          ${timerButton}
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

  function renderAll(action, tracked, accumulation) {
    const root = document.getElementById('items');
    root.innerHTML = `
      <div id="allAccumulationItems" class="list"></div>
      <div id="allActionItems" class="list"></div>
      <div id="allTrackedItems" class="list"></div>
    `;
    renderAccumulation(document.getElementById('allAccumulationItems'), accumulation, { hideEmpty: true });
    renderCards(document.getElementById('allActionItems'), action.events, '처리할 리액션이 없습니다.', 'action', { hideEmpty: true });
    renderCards(document.getElementById('allTrackedItems'), tracked.events, '해당 기간에 처리할 당첨 항목이 없습니다.', 'tracked', { hideEmpty: true });
    if (!root.textContent.trim()) {
      root.innerHTML = '<div class="empty">표시할 항목이 없습니다.</div>';
    }
  }

  async function refresh() {
    const status = await api('/api/status');
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
    updateTabs();

    const query = `&from=${fromDate}&to=${toDate}`;
    if (activeTab === 'all') {
      const [action, tracked, accumulation] = await Promise.all([
        api('/api/processing/items?category=action'),
        api(`/api/processing/items?category=tracked${query}`),
        api(`/api/processing/items?category=accumulation${query}`),
      ]);
      document.getElementById('listTitle').textContent = '전체';
      document.getElementById('listCount').textContent = `${action.count + tracked.count + accumulation.count}개`;
      document.getElementById('rangeText').textContent = `${tracked.from} ~ ${tracked.to}`;
      renderAll(action, tracked, accumulation);
      return;
    }

    const categoryQuery = activeTab === 'action' ? '' : query;
    const payload = await api(`/api/processing/items?category=${activeTab}${categoryQuery}`);
    const titles = { action: '리액션', tracked: '당첨', accumulation: '누적', all: '전체' };
    document.getElementById('listTitle').textContent = titles[activeTab];
    document.getElementById('listCount').textContent = `${payload.count}개`;
    document.getElementById('rangeText').textContent = activeTab === 'action' ? '' : `${payload.from} ~ ${payload.to}`;

    if (activeTab === 'accumulation') {
      renderAccumulation(document.getElementById('items'), payload);
    } else {
      renderCards(document.getElementById('items'), payload.events, activeTab === 'action' ? '처리할 리액션이 없습니다.' : '해당 기간에 처리할 당첨 항목이 없습니다.', activeTab);
    }
  }

  renderShell();
  refresh().catch((error) => {
    document.getElementById('items').innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
  });
  setInterval(() => refresh().catch(() => undefined), 3000);
})();
