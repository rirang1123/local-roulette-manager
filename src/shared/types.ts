export type RouletteCategory =
  | 'action'
  | 'accumulation'
  | 'tracked'
  | 'timed'
  | 'excluded'
  | 'unclassified';

export type RouletteStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'held'
  | 'canceled';

export type AccumulationPeriodType = 'none' | 'daily' | 'weekly' | 'monthly';

export interface RouletteEvent {
  id: string;
  nickname: string;
  value: number;
  roulette_content: string;
  category: RouletteCategory;
  status: RouletteStatus;
  received_at: string;
  memo?: string;
  raw_payload?: unknown;
  item_name?: string;
  amount?: number;
  unit?: string;
  period_type?: AccumulationPeriodType;
  timer_name?: string;
  duration_seconds?: number;
  remaining_seconds?: number;
  started_at?: string | null;
  ended_at?: string | null;
}

export type RouletteMapping =
  | { category: 'action' }
  | { category: 'tracked' }
  | { category: 'excluded' }
  | {
      category: 'accumulation';
      item_name: string;
      amount: number;
      unit: string;
      period_type: AccumulationPeriodType;
    }
  | {
      category: 'timed';
      timer_name: string;
      duration_seconds: number;
      auto_start: boolean;
    };

export type RouletteMappings = Record<string, RouletteMapping>;

export interface FilterSettings {
  tracked_include_keywords: string[];
  tracked_exclude_keywords: string[];
}

export interface AppSettings {
  monitoring: {
    weflab_url_saved: boolean;
    auto_start_on_launch: boolean;
    last_received_at: string | null;
    running: boolean;
  };
  processing: {
    active_category: Extract<RouletteCategory, 'action' | 'accumulation' | 'tracked' | 'timed'>;
    accumulation_period: Extract<AccumulationPeriodType, 'daily' | 'weekly' | 'monthly'>;
  };
  server: {
    host: '127.0.0.1';
    port: number;
    token: string;
  };
  retention: {
    enabled: boolean;
    months: number;
    auto_delete: boolean;
    last_cleanup_at: string | null;
  };
  backup: {
    default_format: 'zip' | 'csv' | 'json';
    last_backup_path: string;
    auto_daily_enabled: boolean;
    last_daily_backup_at: string | null;
  };
}

export interface AppStatus {
  monitoring: boolean;
  weflabUrlSaved: boolean;
  lastReceivedAt: string | null;
  serverUrl: string;
  obsPanelUrl: string;
  obsOverlayUrl: string;
  latestEvent: RouletteEvent | null;
  counts: {
    actionPending: number;
    trackedPending: number;
    timedPending: number;
    timedRunning: number;
    unclassified: number;
  };
  activeCategory: Extract<RouletteCategory, 'action' | 'accumulation' | 'tracked' | 'timed'>;
  accumulationPeriod: Extract<AccumulationPeriodType, 'daily' | 'weekly' | 'monthly'>;
  filters: FilterSettings;
}

export interface AccumulationSummaryItem {
  item_name: string;
  amount: number;
  unit: string;
  ids: string[];
}

export interface LogQuery {
  dateFrom?: string;
  dateTo?: string;
  nickname?: string;
  content?: string;
  category?: RouletteCategory | 'all';
  status?: RouletteStatus | 'all';
  limit?: number;
}
