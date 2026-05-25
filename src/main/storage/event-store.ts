import fs from 'node:fs/promises';
import path from 'node:path';
import { formatDateKey } from '../../shared/date';
import type { LogQuery, RouletteCategory, RouletteEvent, RouletteMapping, RouletteStatus } from '../../shared/types';
import { ensureAppData, readJsonFile, writeJsonFileAtomic } from './app-data';

function eventDateKey(event: RouletteEvent): string {
  return event.received_at.slice(0, 10);
}

function matchesQuery(event: RouletteEvent, query: LogQuery): boolean {
  if (query.nickname && !event.nickname.includes(query.nickname)) return false;
  if (query.content && !event.roulette_content.includes(query.content)) return false;
  if (query.category && query.category !== 'all' && event.category !== query.category) return false;
  if (query.status && query.status !== 'all' && event.status !== query.status) return false;
  return true;
}

export class EventStore {
  async append(event: RouletteEvent): Promise<void> {
    const paths = await ensureAppData();
    const filePath = path.join(paths.logs, `${eventDateKey(event)}.json`);
    const events = await readJsonFile<RouletteEvent[]>(filePath, []);
    events.push(event);
    await writeJsonFileAtomic(filePath, events);
  }

  async list(query: LogQuery = {}): Promise<RouletteEvent[]> {
    const paths = await ensureAppData();
    const from = query.dateFrom ?? formatDateKey();
    const to = query.dateTo ?? from;
    const files = await this.filesInRange(from, to);
    const results: RouletteEvent[] = [];

    for (const file of files) {
      const events = await readJsonFile<RouletteEvent[]>(path.join(paths.logs, file), []);
      for (const event of events) {
        if (matchesQuery(event, query)) {
          results.push(event);
        }
      }
    }

    results.sort((a, b) => b.received_at.localeCompare(a.received_at));
    return results.slice(0, query.limit ?? 500);
  }

  async latest(): Promise<RouletteEvent | null> {
    const events = await this.list({ dateFrom: '1970-01-01', dateTo: '9999-12-31', limit: 1 });
    return events[0] ?? null;
  }

  async counts(): Promise<Record<'actionPending' | 'trackedPending' | 'timedPending' | 'timedRunning' | 'unclassified', number>> {
    const events = await this.list({ dateFrom: '1970-01-01', dateTo: '9999-12-31', limit: 100000 });
    return {
      actionPending: events.filter((event) => event.category === 'action' && event.status === 'pending').length,
      trackedPending: events.filter((event) => event.category === 'tracked' && event.status === 'pending').length,
      timedPending: events.filter((event) => event.category === 'timed' && event.status === 'pending').length,
      timedRunning: events.filter((event) => event.category === 'timed' && event.status === 'running').length,
      unclassified: events.filter((event) => event.category === 'unclassified').length,
    };
  }

  async updateStatus(id: string, status: RouletteStatus): Promise<RouletteEvent | null> {
    return this.updateEvent(id, (event) => {
      event.status = status;
      if (status === 'completed') {
        event.ended_at = new Date().toISOString();
      }
    });
  }

  async updateEvent(id: string, mutator: (event: RouletteEvent) => void): Promise<RouletteEvent | null> {
    const paths = await ensureAppData();
    const files = await this.allLogFiles();

    for (const file of files) {
      const filePath = path.join(paths.logs, file);
      const events = await readJsonFile<RouletteEvent[]>(filePath, []);
      const index = events.findIndex((event) => event.id === id);
      if (index >= 0) {
        mutator(events[index]);
        await writeJsonFileAtomic(filePath, events);
        return events[index];
      }
    }

    return null;
  }

  async byCategory(category: RouletteCategory, status?: RouletteStatus): Promise<RouletteEvent[]> {
    return this.list({
      dateFrom: '1970-01-01',
      dateTo: '9999-12-31',
      category,
      status: status ?? 'all',
      limit: 1000,
    });
  }

  async applyMappingToContent(content: string, mapping: RouletteMapping): Promise<number> {
    const paths = await ensureAppData();
    const files = await this.allLogFiles();
    let changed = 0;

    for (const file of files) {
      const filePath = path.join(paths.logs, file);
      const events = await readJsonFile<RouletteEvent[]>(filePath, []);
      let fileChanged = false;

      for (const event of events) {
        if (event.roulette_content !== content || event.category !== 'unclassified') continue;
        applyMapping(event, mapping);
        changed += 1;
        fileChanged = true;
      }

      if (fileChanged) {
        await writeJsonFileAtomic(filePath, events);
      }
    }

    return changed;
  }

  async deleteAll(): Promise<number> {
    const paths = await ensureAppData();
    const files = await this.allLogFiles();
    for (const file of files) {
      await fs.unlink(path.join(paths.logs, file));
    }
    return files.length;
  }

  async allEvents(): Promise<RouletteEvent[]> {
    return this.list({ dateFrom: '1970-01-01', dateTo: '9999-12-31', limit: 100000 });
  }

  async logDateKeys(): Promise<string[]> {
    const files = await this.allLogFiles();
    return files.map((file) => file.replace('.json', ''));
  }

  async findByIds(ids: string[]): Promise<RouletteEvent[]> {
    const idSet = new Set(ids);
    const events = await this.allEvents();
    return events.filter((event) => idSet.has(event.id));
  }

  private async filesInRange(from: string, to: string): Promise<string[]> {
    const files = await this.allLogFiles();
    return files.filter((file) => {
      const dateKey = file.replace('.json', '');
      return dateKey >= from && dateKey <= to;
    });
  }

  private async allLogFiles(): Promise<string[]> {
    const paths = await ensureAppData();
    try {
      const files = await fs.readdir(paths.logs);
      return files.filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file)).sort();
    } catch {
      return [];
    }
  }
}

function applyMapping(event: RouletteEvent, mapping: RouletteMapping): void {
  event.category = mapping.category;
  event.status = 'pending';

  delete event.item_name;
  delete event.amount;
  delete event.unit;
  delete event.period_type;
  delete event.timer_name;
  delete event.duration_seconds;
  delete event.remaining_seconds;
  delete event.started_at;
  delete event.ended_at;

  if (mapping.category === 'excluded') {
    event.status = 'completed';
  }

  if (mapping.category === 'accumulation') {
    event.item_name = mapping.item_name;
    event.amount = mapping.amount;
    event.unit = mapping.unit;
    event.period_type = mapping.period_type;
    event.status = mapping.period_type === 'none' ? 'completed' : 'pending';
  }

  if (mapping.category === 'timed') {
    event.timer_name = mapping.timer_name;
    event.duration_seconds = mapping.duration_seconds;
    event.remaining_seconds = mapping.duration_seconds;
    event.started_at = null;
    event.ended_at = null;
    event.status = mapping.auto_start ? 'running' : 'pending';
    if (mapping.auto_start) {
      event.started_at = event.received_at;
    }
  }
}
