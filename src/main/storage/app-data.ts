import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

export interface AppDataPaths {
  root: string;
  settings: string;
  mappings: string;
  filters: string;
  logs: string;
  backups: string;
  weflabUrl: string;
}

export function getAppDataPaths(): AppDataPaths {
  const root = path.join(app.getPath('userData'), 'app-data');
  return {
    root,
    settings: path.join(root, 'settings.json'),
    mappings: path.join(root, 'mappings.json'),
    filters: path.join(root, 'filters.json'),
    logs: path.join(root, 'logs'),
    backups: path.join(root, 'backups'),
    weflabUrl: path.join(root, 'weflab-url.local'),
  };
}

export async function ensureAppData(): Promise<AppDataPaths> {
  const paths = getAppDataPaths();
  await fs.mkdir(paths.logs, { recursive: true });
  await fs.mkdir(paths.backups, { recursive: true });
  return paths;
}

export async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
}

export async function writeJsonFileAtomic(filePath: string, value: unknown): Promise<void> {
  const tempPath = `${filePath}.tmp`;
  const backupPath = `${filePath}.bak`;
  const serialized = `${JSON.stringify(value, null, 2)}\n`;

  try {
    await fs.copyFile(filePath, backupPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  await fs.writeFile(tempPath, serialized, 'utf8');
  await fs.rename(tempPath, filePath);
}
