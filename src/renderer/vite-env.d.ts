/// <reference types="vite/client" />

import type { RouletteApi } from '../preload';

declare global {
  interface Window {
    rouletteApi: RouletteApi;
  }
}
