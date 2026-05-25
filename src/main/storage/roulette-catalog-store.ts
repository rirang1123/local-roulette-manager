import { ensureAppData, readJsonFile, writeJsonFileAtomic } from './app-data';

export interface StoredRouletteCatalogItem {
  content: string;
  chance_text?: string;
}

export class RouletteCatalogStore {
  async get(): Promise<StoredRouletteCatalogItem[]> {
    const paths = await ensureAppData();
    return readJsonFile<StoredRouletteCatalogItem[]>(paths.rouletteCatalog, []);
  }

  async set(items: StoredRouletteCatalogItem[]): Promise<void> {
    const paths = await ensureAppData();
    const unique = [...new Map(items.map((item) => [item.content, item])).values()]
      .sort((a, b) => a.content.localeCompare(b.content));
    await writeJsonFileAtomic(paths.rouletteCatalog, unique);
  }
}
