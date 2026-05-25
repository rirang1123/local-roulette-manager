(function () {
  const config = window.ROULETTE_OBS_CONFIG || {};
  const token = config.token || '';
  const assetBase = config.assetBase || '';
  const assetVersion = config.assetVersion || Date.now();

  injectStyle(`${assetBase}/obs/obs-overlay.css?v=${assetVersion}`);

  function injectStyle(href) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  }

  function api(path) {
    const joiner = path.includes('?') ? '&' : '?';
    return fetch(`${path}${joiner}token=${encodeURIComponent(token)}`, { cache: 'no-store' }).then((response) => {
      if (!response.ok) throw new Error(`API ${response.status}`);
      return response.json();
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

  function formatSeconds(total) {
    const safe = Math.max(0, Number(total || 0));
    const minutes = Math.floor(safe / 60);
    const seconds = safe % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  async function refresh() {
    const payload = await api('/api/timers/running');
    document.body.innerHTML = `<main>${payload.events.map((event) => `
      <section class="timer">
        <div class="title">${escapeHtml(event.timer_name || event.roulette_content)}</div>
        <div class="meta">${escapeHtml(event.nickname)} / ${event.value}</div>
        <div class="time">${formatSeconds(event.remaining_seconds)}</div>
      </section>
    `).join('')}</main>`;
  }

  refresh().catch(() => {
    document.body.innerHTML = '<main></main>';
  });
  setInterval(() => refresh().catch(() => undefined), 1000);
})();
