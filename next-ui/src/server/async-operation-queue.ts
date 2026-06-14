export class AsyncOperationQueue {
  private tail: Promise<void> = Promise.resolve();

  enqueue(operation: () => void | Promise<void>): void {
    this.tail = this.tail.catch(() => undefined).then(operation);
  }

  async idle(): Promise<void> {
    await this.tail;
  }
}
