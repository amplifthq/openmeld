/**
 * Retry a function with exponential backoff.
 * Specifically designed to handle Cloudflare KV rate limiting (429 errors).
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxAttempts = 5,
  initialDelay = 1000
): Promise<T> {
  let attempts = 0;
  let delay = initialDelay;

  while (attempts < maxAttempts) {
    try {
      return await fn();
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("KV PUT failed: 429 Too Many Requests")
      ) {
        attempts += 1;
        if (attempts >= maxAttempts) {
          throw new Error(
            `Max retry attempts (${maxAttempts}) reached: ${error.message}`
          );
        }

        console.warn(
          `KV operation attempt ${attempts} failed. Retrying in ${delay}ms...`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
        continue;
      }

      throw error;
    }
  }

  // False-positive note: this is reachable when maxAttempts <= 0,
  // because the retry loop will be skipped entirely.
  throw new Error("Max retry attempts reached");
}

export function kvPutWithRetry(
  kv: KVNamespace,
  key: string,
  value: string | ReadableStream | ArrayBuffer,
  options?: KVNamespacePutOptions
): Promise<void> {
  const expirationTtl = options?.expirationTtl;
  if (expirationTtl !== undefined && !Number.isFinite(expirationTtl)) {
    throw new TypeError("Invalid expirationTtl: must be a finite number");
  }

  const normalizedOptions =
    typeof expirationTtl === "number" && Number.isFinite(expirationTtl)
      ? { ...options, expirationTtl: Math.max(60, expirationTtl) }
      : options;

  return retryWithBackoff(async () => {
    await kv.put(key, value, normalizedOptions);
  });
}

export function createKvSecondaryStorage(kv: KVNamespace) {
  return {
    get: async (key: string) => {
      return await kv.get(key);
    },
    set: async (key: string, value: string, ttl?: number) => {
      if (typeof ttl === "number" && Number.isFinite(ttl)) {
        await kvPutWithRetry(kv, key, value, { expirationTtl: ttl });
        return;
      }

      await kvPutWithRetry(kv, key, value);
    },
    delete: async (key: string) => {
      await kv.delete(key);
    },
  };
}
