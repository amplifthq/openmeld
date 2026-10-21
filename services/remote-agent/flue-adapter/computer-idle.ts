// This is an in-isolate activity guard, not execution truth. Durable command
// receipts, Git jobs and synchronization must also be clear before closing.
export class ComputerIdleGuard {
  #active = 0;
  #lastActivityAt = Date.now();
  static readonly graceMs = 120_000;

  touch() {
    this.#lastActivityAt = Date.now();
  }

  acquire(): () => void {
    this.#active++;
    this.touch();
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.#active--;
        this.touch();
      }
    };
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    const release = this.acquire();
    try {
      return await operation();
    } finally {
      release();
    }
  }

  get closeAt(): number {
    return this.#lastActivityAt + ComputerIdleGuard.graceMs;
  }

  get canClose(): boolean {
    return this.#active === 0 && Date.now() >= this.closeAt;
  }
}
