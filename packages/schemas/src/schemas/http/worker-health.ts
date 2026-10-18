import * as z from "zod/v4";

const RELEASE_SHA_PATTERN = /^[0-9a-f]{40}$/u;

// Public Worker /health. `releaseSha` is the exact main commit the running
// version was deployed from (the RELEASE_SHA Worker variable); null means the
// version was deployed without one, for example a local or staging deploy.
export const workerHealthResponseSchema = z.strictObject({
  ok: z.literal(true),
  service: z.string().min(1),
  releaseSha: z.string().regex(RELEASE_SHA_PATTERN).nullable(),
});

export function resolveWorkerReleaseSha(
  value: string | undefined
): string | null {
  return value && RELEASE_SHA_PATTERN.test(value) ? value : null;
}
