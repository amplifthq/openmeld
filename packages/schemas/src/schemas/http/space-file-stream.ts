import type { z as Zod } from "zod/v4";
import * as z from "../../lazy-zod";

/** Opt-in transport metadata; legacy full-file RPC callers keep their shape. */
export const spaceFileStreamOptionsSchema = z
  .object({
    range: z.string().max(256).optional(),
    ifRange: z.string().max(256).optional(),
    head: z.boolean().optional(),
  })
  .strict();

export const spaceFileStreamMetadataSchema = z.discriminatedUnion("status", [
  z
    .object({ status: z.literal(200), etag: z.string().min(2).max(1024) })
    .strict(),
  z
    .object({
      status: z.literal(206),
      etag: z.string().min(2).max(1024),
      offset: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      length: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    })
    .strict(),
  z
    .object({ status: z.literal(416), etag: z.string().min(2).max(1024) })
    .strict(),
]);

export type SpaceFileStreamOptions = Zod.infer<
  typeof spaceFileStreamOptionsSchema
>;
export type SpaceFileStreamMetadata = Zod.infer<
  typeof spaceFileStreamMetadataSchema
>;

const SINGLE_BYTE_RANGE = /^bytes=(\d*)-(\d*)$/u;

function isSafeByteOffset(value: number | null): boolean {
  return value === null || Number.isSafeInteger(value);
}

/** Call only after authorizing the immutable revision; its size is private. */
export function resolveSpaceFileStreamMetadata(input: {
  options: SpaceFileStreamOptions;
  revisionId: string;
  sizeBytes: number;
}): SpaceFileStreamMetadata {
  const etag = `"${encodeURIComponent(input.revisionId)}"`;
  const full = { status: 200, etag } as const;
  const unsatisfiable = { status: 416, etag } as const;
  const { head, range, ifRange } = input.options;
  // Revisions are immutable. An unsupported date or a stale/weak If-Range
  // validator correctly selects a full representation, never a stale slice.
  if (head || !range || (ifRange !== undefined && ifRange !== etag)) {
    return full;
  }
  const match = SINGLE_BYTE_RANGE.exec(range.trim());
  if (!(match && (match[1] || match[2])) || input.sizeBytes === 0) {
    return unsatisfiable;
  }
  const start = match[1] ? Number(match[1]) : null;
  const end = match[2] ? Number(match[2]) : null;
  if (!(isSafeByteOffset(start) && isSafeByteOffset(end))) {
    return unsatisfiable;
  }
  if (start === null) {
    const suffixLength = end ?? 0;
    if (suffixLength <= 0) {
      return unsatisfiable;
    }
    const length = Math.min(suffixLength, input.sizeBytes);
    return { status: 206, etag, offset: input.sizeBytes - length, length };
  }
  if (start >= input.sizeBytes || (end !== null && end < start)) {
    return unsatisfiable;
  }
  return {
    status: 206,
    etag,
    offset: start,
    length:
      Math.min(end ?? input.sizeBytes - 1, input.sizeBytes - 1) - start + 1,
  };
}
