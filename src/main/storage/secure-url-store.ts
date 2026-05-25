import fs from 'node:fs/promises';
import { ensureAppData } from './app-data';

export class SecureUrlStore {
  async hasUrl(): Promise<boolean> {
    const paths = await ensureAppData();
    try {
      const content = await fs.readFile(paths.weflabUrl, 'utf8');
      return content.trim().length > 0;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }
      throw error;
    }
  }

  async saveUrl(url: string): Promise<void> {
    const paths = await ensureAppData();
    await fs.writeFile(paths.weflabUrl, url, { encoding: 'utf8', mode: 0o600 });
  }

  async readUrl(): Promise<string | null> {
    const paths = await ensureAppData();
    try {
      const content = await fs.readFile(paths.weflabUrl, 'utf8');
      return content.trim() || null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async deleteUrl(): Promise<void> {
    const paths = await ensureAppData();
    try {
      await fs.unlink(paths.weflabUrl);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  async hasRouletteShareUrl(): Promise<boolean> {
    const paths = await ensureAppData();
    try {
      const content = await fs.readFile(paths.rouletteShareUrl, 'utf8');
      return content.trim().length > 0;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }
      throw error;
    }
  }

  async saveRouletteShareUrl(url: string): Promise<void> {
    const paths = await ensureAppData();
    await fs.writeFile(paths.rouletteShareUrl, url, { encoding: 'utf8', mode: 0o600 });
  }

  async readRouletteShareUrl(): Promise<string | null> {
    const paths = await ensureAppData();
    try {
      const content = await fs.readFile(paths.rouletteShareUrl, 'utf8');
      return content.trim() || null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async deleteRouletteShareUrl(): Promise<void> {
    const paths = await ensureAppData();
    try {
      await fs.unlink(paths.rouletteShareUrl);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }
}
