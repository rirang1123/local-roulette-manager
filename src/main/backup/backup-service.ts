import archiver from 'archiver';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { RouletteEvent } from '../../shared/types';
import { formatDateKey } from '../../shared/date';
import { ensureAppData } from '../storage/app-data';
import type { EventStore } from '../storage/event-store';
import type { SettingsStore } from '../storage/settings-store';

export interface BackupInfo {
  filename: string;
  path: string;
  size: number;
  created_at: string;
}

export class BackupService {
  constructor(private readonly eventStore: EventStore) {}

  async createNow(): Promise<BackupInfo> {
    const info = await this.createBackup({
      filenamePrefix: `roulette_backup_${formatDateKey(new Date())}`,
      dateFrom: '1970-01-01',
      dateTo: '9999-12-31',
      reason: 'manual',
    });
    return info;
  }

  async createDailyBackup(dateKey: string): Promise<BackupInfo | null> {
    const paths = await ensureAppData();
    const existing = (await fsp.readdir(paths.backups))
      .find((file) => file.startsWith(`roulette_daily_${dateKey}_`) && file.endsWith('.zip'));
    if (existing) {
      return this.info(path.join(paths.backups, existing));
    }

    const events = await this.eventStore.list({ dateFrom: dateKey, dateTo: dateKey, limit: 100000 });
    if (!events.length) return null;

    return this.createBackup({
      filenamePrefix: `roulette_daily_${dateKey}`,
      dateFrom: dateKey,
      dateTo: dateKey,
      reason: 'daily-auto',
    });
  }

  async runDailyAutoBackup(settingsStore: SettingsStore): Promise<BackupInfo[]> {
    const settings = await settingsStore.get();
    if (!settings.backup.auto_daily_enabled) return [];

    const today = formatDateKey();
    const dateKeys = (await this.eventStore.logDateKeys()).filter((dateKey) => dateKey < today);
    const created: BackupInfo[] = [];
    for (const dateKey of dateKeys) {
      const backup = await this.createDailyBackup(dateKey);
      if (backup) created.push(backup);
    }

    await settingsStore.update((next) => {
      next.backup.last_daily_backup_at = new Date().toISOString();
      next.backup.last_backup_path = created[0]?.path ?? next.backup.last_backup_path;
    });

    return created;
  }

  private async createBackup(options: {
    filenamePrefix: string;
    dateFrom: string;
    dateTo: string;
    reason: 'manual' | 'daily-auto';
  }): Promise<BackupInfo> {
    const paths = await ensureAppData();
    const events = await this.eventStore.list({
      dateFrom: options.dateFrom,
      dateTo: options.dateTo,
      limit: 100000,
    });
    const now = new Date();
    const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `${options.filenamePrefix}_${stamp}.zip`;
    const outputPath = path.join(paths.backups, filename);

    await new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(outputPath);
      const archive = archiver('zip', { zlib: { level: 3 } });
      output.on('close', resolve);
      output.on('error', reject);
      archive.on('error', reject);
      archive.pipe(output);
      archive.append(JSON.stringify(events, null, 2), { name: 'raw_logs.json' });
      archive.append(toCsv(events), { name: 'all_events.csv' });
      archive.append(JSON.stringify({
        created_at: now.toISOString(),
        date_from: options.dateFrom,
        date_to: options.dateTo,
        reason: options.reason,
        event_count: events.length,
        local_only: true,
      }, null, 2), { name: 'backup_info.json' });
      void archive.finalize();
    });

    return this.info(outputPath);
  }

  async list(): Promise<BackupInfo[]> {
    const paths = await ensureAppData();
    const files = await fsp.readdir(paths.backups);
    const infos = await Promise.all(
      files
        .filter((file) => file.toLowerCase().endsWith('.zip'))
        .map((file) => this.info(path.join(paths.backups, file))),
    );
    return infos.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  private async info(filePath: string): Promise<BackupInfo> {
    const stat = await fsp.stat(filePath);
    return {
      filename: path.basename(filePath),
      path: filePath,
      size: stat.size,
      created_at: stat.birthtime.toISOString(),
    };
  }
}

function toCsv(events: RouletteEvent[]): string {
  const headers = ['received_at', 'nickname', 'value', 'roulette_content', 'category', 'status'];
  const rows = events.map((event) => [
    event.received_at,
    event.nickname,
    String(event.value),
    event.roulette_content,
    event.category,
    event.status,
  ]);
  return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
