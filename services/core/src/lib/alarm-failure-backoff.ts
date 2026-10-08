const STORAGE_KEY = "alarm-failure-backoff:v1";
const INITIAL_DELAY_MS = 5000;
const MAX_DELAY_MS = 5 * 60_000;

type Failure = { attempts: number; retryAtMs: number };
type Failures = Record<string, Failure>;

/** Only failed background work is delayed. This never changes execution truth. */
export class AlarmFailureBackoff {
  private loaded: Promise<Failures> | undefined;
  private readonly storage: DurableObjectStorage;

  constructor(storage: DurableObjectStorage) {
    this.storage = storage;
  }

  private read(): Promise<Failures> {
    this.loaded ??= this.storage
      .get<Failures>(STORAGE_KEY)
      .then((value) => value ?? {})
      .catch((error: unknown) => {
        this.loaded = undefined;
        throw error;
      });
    return this.loaded;
  }

  async canRun(owner: string, nowMs: number): Promise<boolean> {
    return ((await this.retryAt(owner)) ?? 0) <= nowMs;
  }

  async retryAt(owner: string): Promise<number | null> {
    return (await this.read())[owner]?.retryAtMs ?? null;
  }

  async failed(owner: string, nowMs: number): Promise<number> {
    const failures = await this.read();
    const attempts = Math.min((failures[owner]?.attempts ?? 0) + 1, 7);
    const retryAtMs =
      nowMs + Math.min(INITIAL_DELAY_MS * 2 ** (attempts - 1), MAX_DELAY_MS);
    failures[owner] = { attempts, retryAtMs };
    await this.storage.put(STORAGE_KEY, structuredClone(failures));
    return retryAtMs;
  }

  async succeeded(owner: string): Promise<void> {
    const failures = await this.read();
    if (!(owner in failures)) {
      return;
    }
    delete failures[owner];
    if (Object.keys(failures).length === 0) {
      await this.storage.delete(STORAGE_KEY);
    } else {
      await this.storage.put(STORAGE_KEY, structuredClone(failures));
    }
  }

  async nextAlarmAt(
    deadlines: Record<string, number | null>
  ): Promise<number | null> {
    const failures = await this.read();
    let next: number | null = null;
    for (const owner of Object.keys(deadlines)) {
      const deadline = deadlines[owner] ?? null;
      const failure = failures[owner];
      const at = failure
        ? Math.max(deadline ?? 0, failure.retryAtMs)
        : deadline;
      if (at !== null && (next === null || at < next)) {
        next = at;
      }
    }
    return next;
  }
}
