import type { EventStore } from './storage/event-store';
import type { RouletteEvent } from '../shared/types';
import { nowIsoLocal } from '../shared/date';

export class TimerService {
  private readonly intervals = new Map<string, NodeJS.Timeout>();

  constructor(private readonly eventStore: EventStore, private readonly onTick: () => void) {}

  async restoreRunning(): Promise<void> {
    const timers = await this.eventStore.runningTimers();
    for (const timer of timers) {
      await this.syncTimer(timer.id);
      this.runInterval(timer.id);
    }
  }

  async start(id: string): Promise<RouletteEvent | null> {
    const updated = await this.eventStore.updateEvent(id, (event) => {
      if (!event.duration_seconds) return;
      event.status = 'running';
      event.started_at = nowIsoLocal();
      event.remaining_seconds = event.remaining_seconds ?? event.duration_seconds;
      event.ended_at = null;
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

  async runningTimers(): Promise<RouletteEvent[]> {
    const timers = await this.eventStore.runningTimers();
    const synced = await Promise.all(timers.map((timer) => this.syncTimer(timer.id)));
    return synced.filter((event): event is RouletteEvent =>
      Boolean(event?.duration_seconds && event.status === 'running' && event.remaining_seconds !== undefined),
    );
  }

  private runInterval(id: string): void {
    this.clearInterval(id);
    const interval = setInterval(async () => {
      const updated = await this.syncTimer(id);

      if (!updated || updated.status === 'completed') {
        this.clearInterval(id);
      }
      this.onTick();
    }, 1000);

    this.intervals.set(id, interval);
  }

  private async syncTimer(id: string): Promise<RouletteEvent | null> {
    return this.eventStore.updateEvent(id, (event) => {
      if (!event.duration_seconds || event.status !== 'running') return;
      const startedAt = event.started_at ? Date.parse(event.started_at) : Date.now();
      if (!event.started_at || Number.isNaN(startedAt)) {
        event.started_at = nowIsoLocal();
        event.remaining_seconds = event.remaining_seconds ?? event.duration_seconds;
        return;
      }

      const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
      event.remaining_seconds = Math.max(0, event.duration_seconds - elapsedSeconds);
      if (event.remaining_seconds <= 0) {
        event.status = 'completed';
        event.ended_at = nowIsoLocal();
      }
    });
  }

  private clearInterval(id: string): void {
    const interval = this.intervals.get(id);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(id);
    }
  }
}
