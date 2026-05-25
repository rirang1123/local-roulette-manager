import { nowIsoLocal } from '../../shared/date';
import type { RouletteEvent, RouletteMapping } from '../../shared/types';

let sequence = 0;

function nextId(receivedAt: string): string {
  sequence += 1;
  const compact = receivedAt.replace(/[-:TZ+]/g, '').slice(0, 14);
  return `evt_${compact}_${`${sequence}`.padStart(3, '0')}`;
}

export interface RawRoulettePayload {
  nickname: string;
  value: number;
  roulette_content: string;
  raw_payload?: unknown;
}

export function normalizeEvent(payload: RawRoulettePayload, mapping?: RouletteMapping): RouletteEvent {
  const receivedAt = nowIsoLocal();
  const base: RouletteEvent = {
    id: nextId(receivedAt),
    nickname: payload.nickname.trim(),
    value: payload.value,
    roulette_content: payload.roulette_content.trim(),
    category: mapping?.category ?? 'unclassified',
    status: 'pending',
    received_at: receivedAt,
    raw_payload: payload.raw_payload,
  };

  if (!mapping) {
    return base;
  }

  if (mapping.category === 'excluded') {
    base.status = 'completed';
  }

  if (mapping.category === 'accumulation') {
    base.item_name = mapping.item_name;
    base.amount = mapping.amount;
    base.unit = mapping.unit;
    base.period_type = mapping.period_type;
    base.status = mapping.period_type === 'none' ? 'completed' : 'pending';
  }

  if (mapping.category === 'timed') {
    base.timer_name = mapping.timer_name;
    base.duration_seconds = mapping.duration_seconds;
    base.remaining_seconds = mapping.duration_seconds;
    base.started_at = null;
    base.ended_at = null;
    base.status = mapping.auto_start ? 'running' : 'pending';
    if (mapping.auto_start) {
      base.started_at = receivedAt;
    }
  }

  return base;
}
