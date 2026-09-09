import type { pbbp2 } from "./protocol/pbbp2";
import protocol from "./protocol/pbbp2.js";

export type LarkFrame = pbbp2.IFrame;
const MAX_PAYLOAD_BYTES = 1024 * 1024;
const MAX_PENDING_MESSAGES = 32;

export const decodeLarkFrame = (bytes: Uint8Array): LarkFrame => {
  if (bytes.byteLength > MAX_PAYLOAD_BYTES) {
    throw new Error("lark.frame_too_large");
  }
  return protocol.pbbp2.Frame.decode(bytes);
};

export const encodeLarkFrame = (frame: LarkFrame): Uint8Array =>
  protocol.pbbp2.Frame.encode(frame).finish();

export function larkFrameHeader(
  frame: LarkFrame,
  key: string
): string | undefined {
  return frame.headers?.find((header) => header.key === key)?.value;
}

export function larkPingFrame(service: number): LarkFrame {
  return {
    SeqID: 0,
    LogID: 0,
    service,
    method: 0,
    headers: [{ key: "type", value: "ping" }],
  };
}

export function larkAckFrame(frame: LarkFrame, elapsedMs: number): LarkFrame {
  return {
    ...frame,
    headers: [
      ...(frame.headers ?? []),
      { key: "biz_rt", value: String(elapsedMs) },
    ],
    payload: new TextEncoder().encode(JSON.stringify({ code: 200 })),
  };
}

// Partial frames are not acknowledged. A lost connection makes the provider
// redeliver them; only complete events may enter durable local acceptance.
export class LarkPayloadAssembler {
  private readonly pending = new Map<
    string,
    {
      expiresAt: number;
      parts: Map<number, Uint8Array>;
      sum: number;
      bytes: number;
    }
  >();

  accept(frame: LarkFrame, nowMs: number): Uint8Array | null {
    const sum = Number(larkFrameHeader(frame, "sum") ?? 1);
    const seq = Number(larkFrameHeader(frame, "seq") ?? 0);
    if (
      !Number.isInteger(sum) ||
      sum < 1 ||
      sum > 256 ||
      !Number.isInteger(seq) ||
      seq < 0 ||
      seq >= sum
    ) {
      throw new Error("lark.fragment_header_invalid");
    }
    const payload = frame.payload ?? new Uint8Array();
    if (sum === 1) {
      return payload;
    }
    const id = larkFrameHeader(frame, "message_id");
    if (!id) {
      throw new Error("lark.fragment_id_missing");
    }
    for (const [key, value] of this.pending) {
      if (value.expiresAt <= nowMs) {
        this.pending.delete(key);
      }
    }
    const entry = this.pending.get(id) ?? {
      expiresAt: nowMs + 30_000,
      parts: new Map<number, Uint8Array>(),
      sum,
      bytes: 0,
    };
    if (
      entry.sum !== sum ||
      (!this.pending.has(id) && this.pending.size >= MAX_PENDING_MESSAGES)
    ) {
      throw new Error("lark.fragment_buffer_invalid");
    }
    if (!entry.parts.has(seq)) {
      entry.parts.set(seq, payload);
      entry.bytes += payload.byteLength;
    }
    if (entry.bytes > MAX_PAYLOAD_BYTES) {
      throw new Error("lark.frame_too_large");
    }
    this.pending.set(id, entry);
    if (entry.parts.size !== sum) {
      return null;
    }
    const result = new Uint8Array(entry.bytes);
    let offset = 0;
    for (let index = 0; index < sum; index++) {
      const part = entry.parts.get(index);
      if (!part) {
        throw new Error("lark.fragment_missing");
      }
      result.set(part, offset);
      offset += part.byteLength;
    }
    this.pending.delete(id);
    return result;
  }
}
