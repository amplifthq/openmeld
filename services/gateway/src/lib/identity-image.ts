import {
  detectSpaceAttachmentMimeType,
  IDENTITY_IMAGE_MAX_DIMENSION,
  IDENTITY_IMAGE_MAX_PIXELS,
  IDENTITY_IMAGE_MAX_SIZE_BYTES,
  IDENTITY_IMAGE_OUTPUT_MIME_TYPE,
  IDENTITY_IMAGE_OUTPUT_SIZE,
  identityImageMimeTypeSchema,
} from "@openmeld/schemas";

const CONTENT_LENGTH_PATTERN = /^\d+$/u;
const WEBP_RIFF_MAGIC_BYTES = [0x52, 0x49, 0x46, 0x46] as const;
const WEBP_FORMAT_MAGIC_BYTES = [0x57, 0x45, 0x42, 0x50] as const;

export type IdentityImageMimeType = "image/jpeg" | "image/png" | "image/webp";

export type IdentityImageError = {
  kind:
    | "content_length_invalid"
    | "content_length_mismatch"
    | "image_invalid"
    | "read_failed"
    | "too_large"
    | "transform_failed"
    | "type_unsupported";
  message: string;
  status: number;
};

export function parseIdentityImageContentLength(
  rawValue: string | undefined
):
  | { ok: true; value: number | null }
  | { ok: false; error: IdentityImageError } {
  if (rawValue === undefined) {
    return { ok: true, value: null };
  }
  const normalized = rawValue.trim();
  if (!CONTENT_LENGTH_PATTERN.test(normalized)) {
    return { error: invalidContentLengthError(), ok: false };
  }
  const value = Number(normalized);
  if (!(Number.isSafeInteger(value) && value > 0)) {
    return { error: invalidContentLengthError(), ok: false };
  }
  if (value > IDENTITY_IMAGE_MAX_SIZE_BYTES) {
    return { error: tooLargeError(), ok: false };
  }
  return { ok: true, value };
}

export function parseIdentityImageMimeType(
  rawValue: string | undefined
):
  | { ok: true; value: IdentityImageMimeType }
  | { ok: false; error: IdentityImageError } {
  const value = rawValue?.split(";", 1)[0]?.trim().toLowerCase();
  const parsed = identityImageMimeTypeSchema.safeParse(value);
  if (!parsed.success) {
    return {
      error: {
        kind: "type_unsupported",
        message: "Only JPG, PNG, and WebP images are supported.",
        status: 415,
      },
      ok: false,
    };
  }
  return { ok: true, value: parsed.data };
}

export async function readIdentityImageBody(
  request: Request,
  contentLength: number | null
): Promise<
  { ok: true; bytes: ArrayBuffer } | { ok: false; error: IdentityImageError }
> {
  if (!request.body) {
    return { error: invalidBodyError(), ok: false };
  }

  const chunks: Uint8Array[] = [];
  const reader = request.body.getReader();
  let totalBytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        break;
      }
      if (next.value.byteLength === 0) {
        continue;
      }
      totalBytes += next.value.byteLength;
      if (totalBytes > IDENTITY_IMAGE_MAX_SIZE_BYTES) {
        await reader.cancel("Identity image upload exceeded its size limit.");
        return { error: tooLargeError(), ok: false };
      }
      chunks.push(next.value);
    }
  } catch {
    return { error: invalidBodyError(), ok: false };
  } finally {
    reader.releaseLock();
  }

  if (totalBytes === 0) {
    return { error: invalidBodyError(), ok: false };
  }
  if (contentLength !== null && totalBytes !== contentLength) {
    return {
      error: {
        kind: "content_length_mismatch",
        message: "Image upload size does not match Content-Length.",
        status: 400,
      },
      ok: false,
    };
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes: bytes.buffer, ok: true };
}

export function matchesIdentityImageMagicBytes(
  bytes: ArrayBuffer,
  mimeType: IdentityImageMimeType
): boolean {
  if (mimeType !== "image/webp") {
    return detectSpaceAttachmentMimeType(bytes) === mimeType;
  }

  // Space attachments do not accept WebP, so logo validation keeps only the
  // additional WebP signature here instead of widening the attachment contract.
  const actual = new Uint8Array(bytes);
  return (
    matchesAt(actual, WEBP_RIFF_MAGIC_BYTES, 0) &&
    matchesAt(actual, WEBP_FORMAT_MAGIC_BYTES, 8)
  );
}

export async function inspectIdentityImage(
  images: ImagesBinding,
  bytes: ArrayBuffer
): Promise<{ ok: true } | { ok: false; error: IdentityImageError }> {
  let info: ImageInfoResponse;
  try {
    info = await images.info(toStream(bytes));
  } catch {
    return { error: invalidImageError(), ok: false };
  }
  if (!("width" in info)) {
    return { error: invalidImageError(), ok: false };
  }
  if (
    !(Number.isSafeInteger(info.width) && Number.isSafeInteger(info.height)) ||
    info.width <= 0 ||
    info.height <= 0 ||
    info.width > IDENTITY_IMAGE_MAX_DIMENSION ||
    info.height > IDENTITY_IMAGE_MAX_DIMENSION ||
    info.width * info.height > IDENTITY_IMAGE_MAX_PIXELS
  ) {
    return { error: invalidImageError(), ok: false };
  }
  return { ok: true };
}

export async function transformIdentityImage(
  images: ImagesBinding,
  bytes: ArrayBuffer
): Promise<
  | { ok: true; stream: ReadableStream<Uint8Array> }
  | { ok: false; error: IdentityImageError }
> {
  try {
    const output = await images
      .input(toStream(bytes))
      .transform({
        fit: "cover",
        gravity: "center",
        height: IDENTITY_IMAGE_OUTPUT_SIZE,
        width: IDENTITY_IMAGE_OUTPUT_SIZE,
      })
      .output({
        anim: false,
        format: IDENTITY_IMAGE_OUTPUT_MIME_TYPE,
        quality: 88,
      });
    if (output.contentType() !== IDENTITY_IMAGE_OUTPUT_MIME_TYPE) {
      throw new Error("Cloudflare Images returned an unexpected content type.");
    }
    return { ok: true, stream: output.image() };
  } catch {
    return {
      error: {
        kind: "transform_failed",
        message: "The image could not be processed.",
        status: 422,
      },
      ok: false,
    };
  }
}

function invalidContentLengthError(): IdentityImageError {
  return {
    kind: "content_length_invalid",
    message: "Content-Length must be a positive integer.",
    status: 400,
  };
}

function invalidBodyError(): IdentityImageError {
  return {
    kind: "read_failed",
    message: "Image bytes could not be read.",
    status: 400,
  };
}

function tooLargeError(): IdentityImageError {
  return {
    kind: "too_large",
    message: "Images must be 5 MB or smaller.",
    status: 413,
  };
}

function invalidImageError(): IdentityImageError {
  return {
    kind: "image_invalid",
    message: "Choose a valid JPG, PNG, or WebP image.",
    status: 422,
  };
}

function matchesAt(
  actual: Uint8Array,
  expected: readonly number[],
  offset: number
): boolean {
  return expected.every((value, index) => actual[offset + index] === value);
}

function toStream(bytes: ArrayBuffer): ReadableStream<Uint8Array> {
  const stream = new Response(bytes).body;
  if (!stream) {
    throw new Error("Image stream is unavailable.");
  }
  return stream;
}
