import type { FilterSettings } from '../../shared/types';
import { ensureAppData, readJsonFile, writeJsonFileAtomic } from './app-data';

export const defaultFilters: FilterSettings = {
  tracked_include_keywords: ['방셀', '셀카', '사진', '인증'],
  tracked_exclude_keywords: ['꽝', '실패', '면제'],
};

export class FilterStore {
  async get(): Promise<FilterSettings> {
    const paths = await ensureAppData();
    const filters = await readJsonFile<FilterSettings>(paths.filters, defaultFilters);
    return {
      tracked_include_keywords: filters.tracked_include_keywords ?? [],
      tracked_exclude_keywords: filters.tracked_exclude_keywords ?? [],
    };
  }

  async set(filters: FilterSettings): Promise<void> {
    const paths = await ensureAppData();
    await writeJsonFileAtomic(paths.filters, normalizeFilters(filters));
  }

  async addTrackedIncludeKeyword(keyword: string): Promise<FilterSettings> {
    const filters = await this.get();
    const normalized = keyword.trim();
    if (normalized && !filters.tracked_include_keywords.includes(normalized)) {
      filters.tracked_include_keywords.push(normalized);
    }
    await this.set(filters);
    return this.get();
  }

  async removeTrackedIncludeKeyword(keyword: string): Promise<FilterSettings> {
    const filters = await this.get();
    filters.tracked_include_keywords = filters.tracked_include_keywords.filter((item) => item !== keyword);
    await this.set(filters);
    return this.get();
  }

  async addTrackedExcludeKeyword(keyword: string): Promise<FilterSettings> {
    const filters = await this.get();
    const normalized = keyword.trim();
    if (normalized && !filters.tracked_exclude_keywords.includes(normalized)) {
      filters.tracked_exclude_keywords.push(normalized);
    }
    await this.set(filters);
    return this.get();
  }

  async removeTrackedExcludeKeyword(keyword: string): Promise<FilterSettings> {
    const filters = await this.get();
    filters.tracked_exclude_keywords = filters.tracked_exclude_keywords.filter((item) => item !== keyword);
    await this.set(filters);
    return this.get();
  }
}

function normalizeFilters(filters: FilterSettings): FilterSettings {
  return {
    tracked_include_keywords: uniqueTrimmed(filters.tracked_include_keywords),
    tracked_exclude_keywords: uniqueTrimmed(filters.tracked_exclude_keywords),
  };
}

function uniqueTrimmed(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
