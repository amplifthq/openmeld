import { createHash } from "node:crypto";

const MAX_IDEMPOTENCY_RESULTS = 512;

export type LocalProjectControlIdempotencyResolution<T> =
  | { status: "conflict" }
  | { status: "fresh" | "replayed"; value: T };

export class LocalProjectControlIdempotencyCache<T> {
  private readonly results = new Map<
    string,
    { requestSignature: string; value: Promise<T> }
  >();

  async resolve(input: {
    execute: () => Promise<T>;
    idempotencyKey: string;
    operationCode: string;
    organizationId: string;
    projectId: string;
    request: unknown;
  }): Promise<LocalProjectControlIdempotencyResolution<T>> {
    const cacheKey = [
      input.operationCode,
      input.organizationId,
      input.projectId,
      input.idempotencyKey,
    ].join("\0");
    const requestSignature = stableHash(input.request);
    const cached = this.results.get(cacheKey);
    if (cached) {
      if (cached.requestSignature !== requestSignature) {
        return { status: "conflict" };
      }
      return { status: "replayed", value: await cached.value };
    }

    const value = input.execute();
    if (this.results.size >= MAX_IDEMPOTENCY_RESULTS) {
      const oldestKey = this.results.keys().next().value;
      if (oldestKey !== undefined) {
        this.results.delete(oldestKey);
      }
    }
    this.results.set(cacheKey, { requestSignature, value });
    return { status: "fresh", value: await value };
  }
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
