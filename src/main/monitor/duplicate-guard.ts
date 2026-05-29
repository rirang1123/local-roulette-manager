import type { RouletteEvent } from '../../shared/types';

interface RecentSignature {
  signature: string;
  receivedAtMs: number;
}

export class DuplicateGuard {
  private readonly recent: RecentSignature[] = [];

  isDuplicate(event: RouletteEvent): boolean {
    const receivedAtMs = Date.parse(event.received_at);
    const rawPayload = event.raw_payload;
    const batchIndex =
      rawPayload &&
      typeof rawPayload === 'object' &&
      'batch_index' in rawPayload &&
      typeof rawPayload.batch_index === 'number'
        ? rawPayload.batch_index
        : '';
    const signature = `${event.nickname}\u0000${event.value}\u0000${event.roulette_content}\u0000${batchIndex}`;
    const duplicate = this.recent.some(
      (item) => item.signature === signature && Math.abs(receivedAtMs - item.receivedAtMs) <= 3000,
    );

    this.recent.push({ signature, receivedAtMs });
    while (this.recent.length > 50) {
      this.recent.shift();
    }

    return duplicate;
  }
}
