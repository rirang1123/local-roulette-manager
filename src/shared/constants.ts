export const LOCAL_API_HOST = '127.0.0.1' as const;
export const DEFAULT_LOCAL_API_PORT = 17777;
export const OBS_REMOTE_ASSET_BASE = 'https://rirang1123.github.io/local-roulette-manager';

export const CATEGORY_LABELS = {
  action: '리액션',
  accumulation: '누적형',
  tracked: '당첨형',
  timed: '타이머',
  excluded: '제외',
  unclassified: '미분류',
} as const;

export const STATUS_LABELS = {
  pending: '대기',
  running: '진행 중',
  paused: '일시정지',
  completed: '완료',
  held: '보류',
  canceled: '취소',
} as const;
