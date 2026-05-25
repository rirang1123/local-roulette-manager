import type { RouletteEvent } from '../../shared/types';

interface RecentSignature {
  signature: string;
  receivedAtMs: number;
}

export class DuplicateGuard {
  private readonly recent: RecentSignature[] = [];

  isDuplicate(event: RouletteEvent): boolean {
    const receivedAtMs = Date.parse(event.received_at);
    const signature = `${event.nickname}\u0000${event.value}\u0000${event.roulette_content}`;
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
