import crypto from 'node:crypto';
import { DEFAULT_LOCAL_API_PORT, LOCAL_API_HOST } from '../../shared/constants';
import type { AppSettings } from '../../shared/types';
import { ensureAppData, readJsonFile, writeJsonFileAtomic } from './app-data';

export function createDefaultSettings(): AppSettings {
  return {
    monitoring: {
      weflab_url_saved: false,
      auto_start_on_launch: false,
      last_received_at: null,
      running: false,
    },
    processing: {
      active_category: 'action',
      accumulation_period: 'weekly',
    },
    server: {
      host: LOCAL_API_HOST,
      port: DEFAULT_LOCAL_API_PORT,
      token: crypto.randomBytes(24).toString('hex'),
    },
    retention: {
      enabled: true,
      months: 2,
      auto_delete: true,
      last_cleanup_at: null,
    },
    backup: {
      default_format: 'zip',
      last_backup_path: '',
      auto_daily_enabled: true,
      last_daily_backup_at: null,
    },
  };
}

export class SettingsStore {
  async get(): Promise<AppSettings> {
    const paths = await ensureAppData();
    const settings = await readJsonFile(paths.settings, createDefaultSettings());
    if (!settings.processing) {
      settings.processing = createDefaultSettings().processing;
      await this.set(settings);
    }
    if (!settings.processing.accumulation_period) {
      settings.processing.accumulation_period = 'weekly';
      await this.set(settings);
    }
    if (!settings.server?.token) {
      settings.server = createDefaultSettings().server;
      await this.set(settings);
    }
    if (!settings.backup) {
      settings.backup = createDefaultSettings().backup;
      await this.set(settings);
    }
    if (settings.backup.auto_daily_enabled === undefined) {
      settings.backup.auto_daily_enabled = true;
      settings.backup.last_daily_backup_at = settings.backup.last_daily_backup_at ?? null;
      await this.set(settings);
    }
    return settings;
  }

  async set(settings: AppSettings): Promise<void> {
    const paths = await ensureAppData();
    await writeJsonFileAtomic(paths.settings, settings);
  }

  async update(mutator: (settings: AppSettings) => void): Promise<AppSettings> {
    const settings = await this.get();
    mutator(settings);
    await this.set(settings);
    return settings;
  }
}
