import { describe, expect, it } from "vitest";
import {
  decodeLarkFrame,
  encodeLarkFrame,
  LarkPayloadAssembler,
  larkAckFrame,
  larkPingFrame,
} from "../src/remote-agent/transport/lark/lark-frame";

describe("official Lark persistent protocol", () => {
  it("encodes the protocol heartbeat using the provider field numbers", () => {
    // Independently specified protobuf fields: SeqID=1, LogID=2,
    // service=3, method=4, headers=5; header key=1/value=2.
    const expected = Uint8Array.from([
      8, 0, 16, 0, 24, 7, 32, 0, 42, 12, 10, 4, 116, 121, 112, 101, 18, 4, 112,
      105, 110, 103,
    ]);
    expect(Array.from(encodeLarkFrame(larkPingFrame(7)))).toEqual(
      Array.from(expected)
    );
    expect(decodeLarkFrame(expected).service).toBe(7);
  });

  it("assembles reordered fragments without acknowledging an incomplete event", () => {
    const assembler = new LarkPayloadAssembler();
    const frame = (seq: number, value: string) => ({
      ...larkPingFrame(7),
      method: 1,
      headers: [
        { key: "message_id", value: "event-1" },
        { key: "sum", value: "2" },
        { key: "seq", value: String(seq) },
      ],
      payload: new TextEncoder().encode(value),
    });
    expect(assembler.accept(frame(1, "world"), 0)).toBeNull();
    expect(assembler.accept(frame(1, "world"), 1)).toBeNull();
    expect(
      new TextDecoder().decode(
        assembler.accept(frame(0, "hello "), 2) ?? undefined
      )
    ).toBe("hello world");
  });

  it("retains routing fields and acknowledges accepted events with provider HTTP code 200", () => {
    const frame = { ...larkPingFrame(7), SeqID: 42, LogID: 123, method: 1 };
    const ack = decodeLarkFrame(encodeLarkFrame(larkAckFrame(frame, 5)));
    expect(ack).toMatchObject({ SeqID: 42, LogID: 123, service: 7, method: 1 });
    expect(
      JSON.parse(new TextDecoder().decode(ack.payload ?? undefined))
    ).toEqual({ code: 200 });
  });
});
