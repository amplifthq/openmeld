import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { toSpaceSignalReadWireValue } from "../src/compatibility/space-signal-read-wire";
import { postNormalMessageBodySchema } from "../src/schemas/http/space-signals";
import {
  signalTextDataSchema,
  signalTextSchema,
} from "../src/schemas/protocol/signal";

const deviceWait = {
  bindingId: "binding-1",
  openMeldServiceRuntimeId: "runtime-1",
  targetProfileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  deadlineAtMs: 1_900_000_000_000,
};

describe("device-wait signal authority", () => {
  it("rejects meta-authored waiting on both HTTP and signal writes", () => {
    for (const topLevel of [undefined, deviceWait]) {
      const data = {
        text: "Check the report",
        ...(topLevel ? { deviceWait: topLevel } : {}),
        meta: { clientMessageId: "client-1", deviceWait },
      };
      expect(postNormalMessageBodySchema.safeParse(data).success).toBe(false);
      expect(
        signalTextSchema.safeParse({ type: "signal.text", data }).success
      ).toBe(false);
    }
    expect(
      postNormalMessageBodySchema.safeParse({
        text: "Check the report",
        deviceWait,
        meta: { clientMessageId: "client-1" },
      }).success
    ).toBe(true);
  });

  it("projects canonical waiting into read-only legacy metadata without altering stored authority", () => {
    const signal = {
      type: "signal.text",
      data: {
        text: "Check the report",
        deviceWait,
        meta: {
          clientMessageId: "client-1",
          deviceWait: { ...deviceWait, bindingId: "untrusted-mirror" },
        },
      },
    };
    const projected = toSpaceSignalReadWireValue({ signals: [signal] });
    expect(projected.signals[0]?.data).not.toHaveProperty("deviceWait");
    expect(projected.signals[0]?.data.meta.deviceWait).toEqual(deviceWait);
    expect(signal.data.deviceWait).toBe(deviceWait);
    expect(signal.data.meta.deviceWait.bindingId).toBe("untrusted-mirror");
    expect(
      z
        .strictObject(signalTextDataSchema.shape)
        .omit({ deviceWait: true })
        .safeParse(projected.signals[0]?.data).success
    ).toBe(true);
    // A history projection is never a new authoring request.
    expect(signalTextSchema.safeParse(projected.signals[0]).success).toBe(
      false
    );
  });
});
