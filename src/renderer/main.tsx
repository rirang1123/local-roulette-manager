import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { AppStatus, RouletteCategory, RouletteEvent, RouletteMapping, RouletteStatus } from '../shared/types';
import { CATEGORY_LABELS, STATUS_LABELS } from '../shared/constants';
import { formatDateKey, formatDateTime } from '../shared/date';
import './styles.css';

type Page = 'dashboard' | 'logs' | 'backup-view' | 'unclassified' | 'settings';

const pages: Array<{ id: Page; label: string }> = [
  { id: 'dashboard', label: '대시보드' },
  { id: 'logs', label: '전체 로그' },
  { id: 'backup-view', label: '백업 확인' },
  { id: 'unclassified', label: '미분류' },
  { id: 'settings', label: '설정' },
];

function App() {
  const [page, setPage] = useState<Page>('dashboard');
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [events, setEvents] = useState<RouletteEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const [nextStatus, nextEvents] = await Promise.all([
      window.rouletteApi.getStatus(),
      window.rouletteApi.listEvents({ dateFrom: '1970-01-01', dateTo: '9999-12-31', limit: 500 }),
    ]);
    setStatus(nextStatus);
    setEvents(nextEvents);
  }

  async function run(action: () => Promise<unknown>) {
    try {
      setError(null);
      await action();
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  useEffect(() => {
    void refresh();
    return window.rouletteApi.onChanged(() => {
      void refresh();
    });
  }, []);

  const visibleEvents = useMemo(() => {
    if (page === 'unclassified') return events.filter((event) => event.category === 'unclassified');
    return events;
  }, [events, page]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h1>로컬 룰렛 매니저</h1>
        <nav>
          {pages.map((item) => (
            <button className={page === item.id ? 'active' : ''} key={item.id} onClick={() => setPage(item.id)}>
              {item.label}
            </button>
          ))}
        </nav>
      </aside>
      <main className="content">
        {error && <div className="error">{error}</div>}
        {page === 'dashboard' && <Dashboard status={status} events={events} run={run} />}
        {page === 'settings' && <Settings status={status} run={run} />}
        {page === 'unclassified' && <Unclassified events={visibleEvents} run={run} />}
        {page === 'logs' && <LogsPage events={visibleEvents} run={run} />}
        {page === 'backup-view' && <BackupViewPage />}
      </main>
    </div>
  );
}

interface BackupInfo {
  filename: string;
  path: string;
  size: number;
  created_at: string;
}

function LogsPage({ events, run }: { events: RouletteEvent[]; run: (action: () => Promise<unknown>) => void }) {
  return (
    <>
      <header className="page-header">
        <div>
          <h2>전체 로그</h2>
          <p>저장된 원본 로그를 확인하고 백업하거나 삭제합니다.</p>
        </div>
      </header>
      <section className="panel actions wrap">
        <button onClick={() => run(async () => {
          await window.rouletteApi.createBackupNow();
        })}>바로 백업</button>
        <button className="stop-button" onClick={() => {
          if (!window.confirm('전체 로그를 삭제할까요? 삭제 전 백업을 권장합니다.')) return;
          run(() => window.rouletteApi.deleteAllLogs());
        }}>로그 지우기</button>
      </section>
      <EventTable events={events} run={run} />
    </>
  );
}

function BackupViewPage() {
  const [backups, setBackups] = useState<BackupInfo[]>([]);

  async function refreshBackups() {
    setBackups(await window.rouletteApi.listBackups());
  }

  useEffect(() => {
    void refreshBackups();
  }, []);

  return (
    <>
      <header className="page-header">
        <div>
          <h2>백업 확인</h2>
          <p>저장된 백업 파일을 확인합니다.</p>
        </div>
        <button onClick={() => void refreshBackups()}>새로고침</button>
      </header>
      <section className="panel">
        <h3>저장된 백업</h3>
        {backups.length === 0 ? (
          <p className="muted">저장된 백업이 없습니다.</p>
        ) : (
          <div className="backup-list">
            {backups.map((backup) => (
              <div className="backup-item" key={backup.path}>
                <strong>{backup.filename}</strong>
                <span>{formatBytes(backup.size)} / {new Date(backup.created_at).toLocaleString()}</span>
                <code>{backup.path}</code>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function Manage({
  status,
  events,
  run,
}: {
  status: AppStatus | null;
  events: RouletteEvent[];
  run: (action: () => Promise<unknown>) => void;
}) {
  const [trackedContentFilter, setTrackedContentFilter] = useState('all');
  const categories: Array<{ id: ManagedCategory; label: string }> = [
    { id: 'action', label: CATEGORY_LABELS.action },
    { id: 'tracked', label: CATEGORY_LABELS.tracked },
    { id: 'accumulation', label: CATEGORY_LABELS.accumulation },
  ];

  const activeCategory =
    status?.activeCategory === 'timed'
      ? 'accumulation'
      : status?.activeCategory ?? 'tracked';
  const trackedOptions = [...new Set(events
    .filter((event) => event.category === 'tracked' && event.status !== 'completed' && event.status !== 'canceled')
    .map((event) => event.roulette_content))]
    .sort((a, b) => a.localeCompare(b));
  const filtered = events.filter((event) => {
    if (event.status === 'completed' || event.status === 'canceled') return false;
    if (activeCategory === 'accumulation') {
      return event.category === 'accumulation' || event.category === 'timed';
    }
    if (event.category !== activeCategory) return false;
    if (activeCategory === 'tracked' && trackedContentFilter !== 'all') {
      return event.roulette_content === trackedContentFilter;
    }
    return true;
  });
  const accumulationEvents = filtered.filter((event) => event.category === 'accumulation');
  const actionEvents = filtered.filter((event) => event.category === 'action');
  const tableEvents = filtered.filter((event) => event.category !== 'accumulation');

  return (
    <>
      <section className="section-heading">
        <div>
          <h2>처리 관리</h2>
          <p>선택한 방식으로 새 룰렛 결과가 저장됩니다.</p>
        </div>
      </section>
      <section className="panel filter-panel">
        <strong>새 룰렛 적용 방식</strong>
        <div className="radio-row">
          {categories.map((category) => (
            <label className={`radio-card ${activeCategory === category.id ? 'selected' : ''}`} key={category.id}>
              <input
                type="radio"
                name="active-category"
                checked={activeCategory === category.id}
                onChange={() => run(() => window.rouletteApi.setActiveCategory(category.id))}
              />
              {category.label}
            </label>
          ))}
        </div>
        <p className="muted">
          현재 선택: {CATEGORY_LABELS[activeCategory]}. 매핑이 없는 새 룰렛은 이 방식으로 저장됩니다.
        </p>
        {activeCategory === 'accumulation' && (
          <label>
            새 누적형 기본 기간
            <select
              value={status?.accumulationPeriod ?? 'weekly'}
              onChange={(event) => run(() =>
                window.rouletteApi.setAccumulationPeriod(event.target.value as 'daily' | 'weekly' | 'monthly')
              )}
            >
              <option value="daily">일 단위</option>
              <option value="weekly">주 단위</option>
              <option value="monthly">월 단위</option>
            </select>
          </label>
        )}
      </section>
      {activeCategory === 'tracked' && (
        <section className="panel filter-panel">
          <strong>당첨룰렛 항목 필터</strong>
          <select value={trackedContentFilter} onChange={(event) => setTrackedContentFilter(event.target.value)}>
            <option value="all">전체 후처리 항목</option>
            {trackedOptions.map((content) => (
              <option value={content} key={content}>{content}</option>
            ))}
          </select>
          <p className="muted">당첨룰렛으로 들어온 룰렛 내용이 자동으로 드롭다운 항목에 추가됩니다.</p>
        </section>
      )}
      {activeCategory === 'action' && actionEvents.length > 0 && <ActionQueue events={actionEvents} run={run} />}
      {activeCategory !== 'action' && tableEvents.length > 0 && <EventTable events={tableEvents} run={run} showCategory={false} />}
      {activeCategory === 'accumulation' && accumulationEvents.length > 0 && <Accumulation events={accumulationEvents} run={run} />}
      {filtered.length === 0 && <section className="panel muted">선택한 처리 방식에 해당하는 룰렛이 없습니다.</section>}
    </>
  );
}

type ManagedCategory = Extract<RouletteCategory, 'action' | 'accumulation' | 'tracked'>;

function ActionQueue({
  events,
  run,
}: {
  events: RouletteEvent[];
  run: (action: () => Promise<unknown>) => void;
}) {
  return (
    <section className="panel">
      <div className="row-heading">
        <h3>리액션 대기열</h3>
        <span className="muted">최근 항목이 위에 표시되고 1분 뒤 자동으로 사라집니다.</span>
      </div>
      <div className="action-list">
        {events.map((event) => (
          <article className="action-item" key={event.id}>
            <div>
              <strong>{event.roulette_content}</strong>
              <span>{formatDateTime(event.received_at)} / {event.nickname} / {event.value}</span>
            </div>
            <button className="small secondary" onClick={() => run(() => window.rouletteApi.updateStatus(event.id, 'completed'))}>
              없애기
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

function Dashboard({
  status,
  events,
  run,
}: {
  status: AppStatus | null;
  events: RouletteEvent[];
  run: (action: () => Promise<unknown>) => void;
}) {
  const isMonitoring = Boolean(status?.monitoring);

  return (
    <>
      <header className="page-header">
        <div>
          <h2>대시보드</h2>
          <p>로컬 저장과 OBS 브라우저 독 제어 상태를 확인합니다.</p>
        </div>
        <button onClick={() => run(() => window.rouletteApi.addSampleEvent())}>샘플 룰렛 추가</button>
      </header>
      <section className={`monitor-strip ${isMonitoring ? 'running' : 'stopped'}`}>
        <div>
          <span className="status-dot" />
          <strong>{isMonitoring ? '모니터링 중' : '모니터링 중지됨'}</strong>
        </div>
        <span>{isMonitoring ? '새 룰렛 결과를 감지하고 저장합니다.' : '시작 버튼을 누르면 등록된 위플랩 URL을 감시합니다.'}</span>
      </section>
      <section className="panel actions">
        <button
          className={isMonitoring ? 'secondary' : 'start-button'}
          disabled={isMonitoring}
          onClick={() => run(() => window.rouletteApi.startMonitor())}
        >
          모니터링 시작
        </button>
        <button
          className={isMonitoring ? 'stop-button' : 'secondary'}
          disabled={!isMonitoring}
          onClick={() => run(() => window.rouletteApi.stopMonitor())}
        >
          모니터링 중지
        </button>
      </section>
      <Manage status={status} events={events} run={run} />
    </>
  );
}

function Settings({ status, run }: { status: AppStatus | null; run: (action: () => Promise<unknown>) => void }) {
  const [url, setUrl] = useState('');
  return (
    <>
      <header className="page-header">
        <div>
          <h2>설정</h2>
          <p>위플랩 URL은 저장 후 원문을 다시 표시하지 않습니다.</p>
        </div>
      </header>
      <section className="panel form">
        <label>
          위플랩 후원알림 URL
          <input type="password" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://weflab.com/page/..." />
        </label>
        <div className="actions">
          <button onClick={() => run(() => window.rouletteApi.saveWeflabUrl(url))}>등록</button>
          <button className="secondary" onClick={() => run(() => window.rouletteApi.deleteWeflabUrl())}>삭제</button>
        </div>
      </section>
      <section className="panel">
        <h3>OBS 브라우저 독 URL</h3>
        <code>{status?.obsPanelUrl ?? '-'}</code>
      </section>
      <section className="panel">
        <h3>OBS 화면 오버레이 URL</h3>
        <code>{status?.obsOverlayUrl ?? '-'}</code>
      </section>
      <section className="panel">
        <h3>보관 정책</h3>
        <p>룰렛 로그는 기본적으로 최근 2개월간 보관됩니다. 2개월이 지난 원본 로그는 앱 실행 시 자동으로 삭제됩니다.</p>
      </section>
    </>
  );
}

function Unclassified({ events, run }: { events: RouletteEvent[]; run: (action: () => Promise<unknown>) => void }) {
  const unique = [...new Map(events.map((event) => [event.roulette_content, event])).values()];
  return (
    <>
      <header className="page-header"><h2>미분류</h2></header>
      <div className="stack">
        {unique.map((event) => (
          <section className="panel classify" key={event.roulette_content}>
            <h3>{event.roulette_content}</h3>
            <div className="actions wrap">
              <ClassifyButton event={event} category="action" run={run} />
              <ClassifyButton event={event} category="tracked" run={run} />
              <ClassifyButton event={event} category="excluded" run={run} />
              <AccumulationClassifyButtons event={event} run={run} />
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

function AccumulationClassifyButtons({
  event,
  run,
}: {
  event: RouletteEvent;
  run: (action: () => Promise<unknown>) => void;
}) {
  const base = event.roulette_content.replace(/\s*\d+.*/, '') || event.roulette_content;
  const periods = [
    { id: 'daily' as const, label: '일 누적' },
    { id: 'weekly' as const, label: '주 누적' },
    { id: 'monthly' as const, label: '월 누적' },
  ];
  return (
    <>
      {periods.map((period) => (
        <button key={period.id} onClick={() => run(() => window.rouletteApi.setMapping(event.roulette_content, {
          category: 'accumulation',
          item_name: base,
          amount: 1,
          unit: '개',
          period_type: period.id,
        }))}>{period.label}</button>
      ))}
    </>
  );
}

function ClassifyButton({
  event,
  category,
  run,
}: {
  event: RouletteEvent;
  category: Extract<RouletteCategory, 'action' | 'tracked' | 'excluded'>;
  run: (action: () => Promise<unknown>) => void;
}) {
  const mapping: RouletteMapping = { category } as RouletteMapping;
  return <button onClick={() => run(() => window.rouletteApi.setMapping(event.roulette_content, mapping))}>{CATEGORY_LABELS[category]}</button>;
}

function Accumulation({ events, run }: { events: RouletteEvent[]; run?: (action: () => Promise<unknown>) => void }) {
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly'>('weekly');
  const [anchorDate, setAnchorDate] = useState(formatDateKey());
  const [periodSummary, setPeriodSummary] = useState<{
    from: string;
    to: string;
    items: Array<{ item_name: string; amount: number; unit: string; ids: string[] }>;
  } | null>(null);
  const summary = new Map<string, { itemName: string; amount: number; unit: string; ids: string[] }>();
  for (const event of events) {
    const itemName = event.item_name ?? event.roulette_content;
    const unit = event.unit ?? '';
    const key = `${itemName}|${unit}`;
    const current = summary.get(key) ?? { itemName, amount: 0, unit, ids: [] };
    current.amount += event.amount ?? 0;
    current.ids.push(event.id);
    summary.set(key, current);
  }

  useEffect(() => {
    void window.rouletteApi.getAccumulationSummary(period, anchorDate).then(setPeriodSummary);
  }, [period, anchorDate, events.length]);

  return (
    <>
      <header className="page-header"><h2>누적형</h2></header>
      <section className="panel filter-panel">
        <strong>기간별 누적 확인</strong>
        <div className="period-tools">
          <select value={period} onChange={(event) => setPeriod(event.target.value as 'daily' | 'weekly' | 'monthly')}>
            <option value="daily">일 단위</option>
            <option value="weekly">주 단위</option>
            <option value="monthly">월 단위</option>
          </select>
          <input type="date" value={anchorDate} onChange={(event) => setAnchorDate(event.target.value)} />
        </div>
        <p className="muted">{periodSummary ? `${periodSummary.from} ~ ${periodSummary.to}` : '계산 중'}</p>
        <div className="summary-list">
          {periodSummary && periodSummary.items.length === 0 && <p className="muted">해당 기간 누적 항목이 없습니다.</p>}
          {periodSummary?.items.map((value) => (
            <div className="summary-item" key={`${value.item_name}|${value.unit}`}>
              <strong>{value.item_name}</strong>
              <span>{value.amount}{value.unit}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <h3>미처리 합산</h3>
        <div className="summary-list">
          {[...summary.values()].map((value) => (
            <div className="summary-item" key={`${value.itemName}|${value.unit}`}>
              <strong>{value.itemName}</strong>
              <span>{value.amount}{value.unit}</span>
              {run && (
                <>
                  {(value.unit === '초' || value.unit === '분') && (
                    <button className="small start-button" onClick={() => run(() =>
                      window.rouletteApi.startTimerFromAccumulationGroup(value.ids)
                    )}>타이머 시작</button>
                  )}
                  <button className="small secondary" onClick={() => run(async () => {
                    for (const id of value.ids) {
                      await window.rouletteApi.updateStatus(id, 'completed');
                    }
                  })}>완료</button>
                </>
              )}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function Timed({ events, run }: { events: RouletteEvent[]; run: (action: () => Promise<unknown>) => void }) {
  return (
    <>
      <header className="page-header"><h2>타이머</h2></header>
      <div className="stack">
        {events.map((event) => (
          <section className="panel row" key={event.id}>
            <EventLine event={event} />
            <span>{event.remaining_seconds ?? event.duration_seconds ?? 0}초</span>
            <button onClick={() => run(() => window.rouletteApi.startTimed(event.id))}>시작</button>
            <button className="secondary" onClick={() => run(() => window.rouletteApi.completeTimed(event.id))}>완료</button>
          </section>
        ))}
      </div>
    </>
  );
}

function EventTable({
  events,
  run,
  showCategory = true,
}: {
  events: RouletteEvent[];
  run?: (action: () => Promise<unknown>) => void;
  showCategory?: boolean;
}) {
  return (
    <section className="panel">
      <table>
        <thead>
          <tr>
            <th>날짜/시간</th><th>닉네임</th><th>값</th><th>룰렛 내용</th>{showCategory && <th>분류</th>}<th>상태</th><th></th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id}>
              <td>{formatDateTime(event.received_at)}</td>
              <td>{event.nickname}</td>
              <td>{event.value}</td>
              <td>
                <div>{event.roulette_content}</div>
                {event.duration_seconds && (
                  <div className="timer-inline">
                    {event.status === 'running' ? '남은 시간' : '타이머'}: {formatSeconds(event.remaining_seconds ?? event.duration_seconds)}
                  </div>
                )}
              </td>
              {showCategory && <td>{CATEGORY_LABELS[event.category]}</td>}
              <td>{STATUS_LABELS[event.status]}</td>
              <td>{run && <StatusButtons event={event} run={run} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function StatusButtons({ event, run }: { event: RouletteEvent; run: (action: () => Promise<unknown>) => void }) {
  const statuses: RouletteStatus[] = ['pending', 'completed', 'held', 'canceled'];
  const duration = parseDurationFromContent(event.roulette_content);
  return (
    <div className="table-actions">
      {duration && event.status !== 'running' && event.status !== 'completed' && event.status !== 'canceled' && (
        <button className="small start-button" onClick={() => run(() => window.rouletteApi.startTimerFromEvent(event.id))}>
          타이머 시작
        </button>
      )}
      {event.status === 'running' && event.duration_seconds && (
        <button className="small stop-button" onClick={() => run(() => window.rouletteApi.completeTimed(event.id))}>
          타이머 완료
        </button>
      )}
      {statuses.map((status) => (
        <button key={status} className="small secondary" onClick={() => run(() => window.rouletteApi.updateStatus(event.id, status))}>
          {STATUS_LABELS[status]}
        </button>
      ))}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <section className="metric"><span>{label}</span><strong>{value}</strong></section>;
}

function EventLine({ event }: { event: RouletteEvent }) {
  return <p>{event.nickname} / {event.value} / {event.roulette_content}</p>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatSeconds(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${`${seconds}`.padStart(2, '0')}`;
}

function parseDurationFromContent(content: string): number | null {
  let seconds = 0;
  const minuteMatch = content.match(/(\d+)\s*분/);
  const secondMatch = content.match(/(\d+)\s*초/);
  if (minuteMatch) seconds += Number(minuteMatch[1]) * 60;
  if (secondMatch) seconds += Number(secondMatch[1]);
  return seconds > 0 ? seconds : null;
}

createRoot(document.getElementById('root')!).render(<App />);
