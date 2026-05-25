import type { EventStore } from './storage/event-store';
import type { RouletteEvent } from '../shared/types';
import { nowIsoLocal } from '../shared/date';

export class TimerService {
  private readonly intervals = new Map<string, NodeJS.Timeout>();

  constructor(private readonly eventStore: EventStore, private readonly onTick: () => void) {}

  async start(id: string): Promise<RouletteEvent | null> {
    const updated = await this.eventStore.updateEvent(id, (event) => {
      if (!event.duration_seconds) return;
      event.status = 'running';
      event.started_at = event.started_at ?? nowIsoLocal();
      event.remaining_seconds = event.remaining_seconds ?? event.duration_seconds ?? 0;
    });

    if (updated?.duration_seconds) {
      this.runInterval(updated.id);
    }

    return updated;
  }

  async complete(id: string): Promise<RouletteEvent | null> {
    this.clearInterval(id);
    return this.eventStore.updateEvent(id, (event) => {
      if (!event.duration_seconds) return;
      event.status = 'completed';
      event.remaining_seconds = 0;
      event.ended_at = nowIsoLocal();
    });
  }

  private runInterval(id: string): void {
    this.clearInterval(id);
    const interval = setInterval(async () => {
      const updated = await this.eventStore.updateEvent(id, (event) => {
        if (!event.duration_seconds || event.status !== 'running') return;
        event.remaining_seconds = Math.max(0, (event.remaining_seconds ?? event.duration_seconds ?? 0) - 1);
        if (event.remaining_seconds <= 0) {
          event.status = 'completed';
          event.ended_at = nowIsoLocal();
        }
      });

      if (!updated || updated.status === 'completed') {
        this.clearInterval(id);
      }
      this.onTick();
    }, 1000);

    this.intervals.set(id, interval);
  }

  private clearInterval(id: string): void {
    const interval = this.intervals.get(id);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(id);
    }
  }
}
