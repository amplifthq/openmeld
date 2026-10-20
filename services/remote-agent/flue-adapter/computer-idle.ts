// This is an in-isolate activity guard, not execution truth. Durable command
// receipts, Git jobs and synchronization must also be clear before closing.
export class ComputerIdleGuard {
  #active = 0;
  #lastActivityAt = Date.now();
  static readonly graceMs = 120_000;

  touch() {
    this.#lastActivityAt = Date.now();
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    this.#active++;
    this.touch();
    try {
      return await operation();
    } finally {
      this.#active--;
      this.touch();
    }
  }

  get closeAt(): number {
    return this.#lastActivityAt + ComputerIdleGuard.graceMs;
  }

  get canClose(): boolean {
    return this.#active === 0 && Date.now() >= this.closeAt;
  }
}
