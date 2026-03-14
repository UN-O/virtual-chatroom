export class NudgeCounter {
  private readonly counts = new Map<string, number>();

  advance(chatId: string): number {
    const currentLevel = this.counts.get(chatId) ?? 0;
    this.counts.set(chatId, currentLevel + 1);
    return currentLevel;
  }

  get(chatId: string): number {
    return this.counts.get(chatId) ?? 0;
  }

  reset(chatId: string): void {
    this.counts.delete(chatId);
  }

  clear(): void {
    this.counts.clear();
  }
}