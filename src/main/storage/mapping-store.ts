import type { RouletteMapping, RouletteMappings } from '../../shared/types';
import { ensureAppData, readJsonFile, writeJsonFileAtomic } from './app-data';

export class MappingStore {
  async getAll(): Promise<RouletteMappings> {
    const paths = await ensureAppData();
    return readJsonFile<RouletteMappings>(paths.mappings, {});
  }

  async get(content: string): Promise<RouletteMapping | undefined> {
    const mappings = await this.getAll();
    return mappings[content];
  }

  async set(content: string, mapping: RouletteMapping): Promise<void> {
    const paths = await ensureAppData();
    const mappings = await this.getAll();
    mappings[content] = mapping;
    await writeJsonFileAtomic(paths.mappings, mappings);
  }
}
