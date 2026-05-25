export function formatDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function nowIsoLocal(): string {
  const date = new Date();
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absolute = Math.abs(offsetMinutes);
  const hours = `${Math.floor(absolute / 60)}`.padStart(2, '0');
  const minutes = `${absolute % 60}`.padStart(2, '0');
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 19);
  return `${local}${sign}${hours}:${minutes}`;
}

export type DatePeriod = 'daily' | 'weekly' | 'monthly';

export function dateRangeForPeriod(period: DatePeriod, anchorKey = formatDateKey()): { from: string; to: string } {
  const anchor = new Date(`${anchorKey}T00:00:00`);
  if (period === 'daily') {
    return { from: formatDateKey(anchor), to: formatDateKey(anchor) };
  }

  if (period === 'monthly') {
    const from = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const to = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    return { from: formatDateKey(from), to: formatDateKey(to) };
  }

  const day = anchor.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const from = new Date(anchor);
  from.setDate(anchor.getDate() + mondayOffset);
  const to = new Date(from);
  to.setDate(from.getDate() + 6);
  return { from: formatDateKey(from), to: formatDateKey(to) };
}

export function formatDateTime(value: string): string {
  return value.replace('T', ' ').slice(0, 19);
}
