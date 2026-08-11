import type {
  RemoteAgentReadableStorage,
  RemoteAgentWritableStorage,
} from "../agent-core/callback-context";

export class InMemoryDurableObjectStorage
  implements RemoteAgentReadableStorage, RemoteAgentWritableStorage
{
  private readonly expiresAt = new Map<string, number>();
  private readonly records = new Map<string, unknown>();

  compareAndSet<T>(
    key: string,
    expectedValue: T,
    nextValue: T
  ): Promise<boolean> {
    if (
      JSON.stringify(this.records.get(key)) !== JSON.stringify(expectedValue)
    ) {
      return Promise.resolve(false);
    }
    this.records.set(key, nextValue);
    this.expiresAt.delete(key);
    return Promise.resolve(true);
  }

  delete(key: string): Promise<boolean> {
    this.expiresAt.delete(key);
    return Promise.resolve(this.records.delete(key));
  }

  deleteExpired(input: {
    limit: number;
    nowMs: number;
    prefix: string;
  }): Promise<{ deleted: number; nextExpiresAtMs: number | null }> {
    const expired = [...this.expiresAt.entries()]
      .filter(
        ([key, expiresAtMs]) =>
          key.startsWith(input.prefix) && expiresAtMs <= input.nowMs
      )
      .sort(
        ([firstKey, firstExpiry], [secondKey, secondExpiry]) =>
          firstExpiry - secondExpiry || firstKey.localeCompare(secondKey)
      )
      .slice(0, input.limit);
    for (const [key] of expired) {
      this.expiresAt.delete(key);
      this.records.delete(key);
    }
    const remainingExpiries = [...this.expiresAt.entries()]
      .filter(([key]) => key.startsWith(input.prefix))
      .map(([, expiresAtMs]) => expiresAtMs);
    return Promise.resolve({
      deleted: expired.length,
      nextExpiresAtMs:
        remainingExpiries.length === 0 ? null : Math.min(...remainingExpiries),
    });
  }

  get<T = unknown>(key: string): Promise<T | undefined> {
    return Promise.resolve(this.records.get(key) as T | undefined);
  }

  list<T = unknown>(
    options?: DurableObjectListOptions
  ): Promise<Map<string, T>> {
    const prefix = options?.prefix ?? "";
    const entries = [...this.records.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => [key, value as T] as const);
    return Promise.resolve(new Map(entries));
  }

  put<T>(key: string, value: T): Promise<void> {
    this.records.set(key, value);
    this.expiresAt.delete(key);
    return Promise.resolve();
  }

  putExpiring<T>(key: string, value: T, expiresAtMs: number): Promise<void> {
    this.records.set(key, value);
    this.expiresAt.set(key, expiresAtMs);
    return Promise.resolve();
  }

  putIfAbsent<T>(key: string, value: T): Promise<boolean> {
    if (this.records.has(key)) {
      return Promise.resolve(false);
    }
    this.records.set(key, value);
    this.expiresAt.delete(key);
    return Promise.resolve(true);
  }

  putIfAbsentExpiring<T>(
    key: string,
    value: T,
    expiresAtMs: number
  ): Promise<boolean> {
    if (this.records.has(key)) {
      return Promise.resolve(false);
    }
    this.records.set(key, value);
    this.expiresAt.set(key, expiresAtMs);
    return Promise.resolve(true);
  }

  takeUnexpired<T = unknown>(
    key: string,
    nowMs: number
  ): Promise<T | undefined> {
    const value = this.records.get(key) as T | undefined;
    const expiresAtMs = this.expiresAt.get(key);
    const deleted = this.records.delete(key);
    this.expiresAt.delete(key);
    if (!deleted || (expiresAtMs !== undefined && expiresAtMs <= nowMs)) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve(value);
  }
}
