import { describe, expect, it } from "vitest";
import { getRemovedCcCliInputMessage } from "../src/space/removed-addressing";

describe("removed Space Addressing inputs", () => {
  it("rejects the removed --cc flag with Reference guidance", () => {
    expect(
      getRemovedCcCliInputMessage([
        "node",
        "openmeld",
        "space",
        "action",
        "reply",
        "--cc",
        "@Mira",
        "message",
      ])
    ).toBe(
      "CC has been removed from Space Message Addressing. Use --reference instead."
    );
  });

  it("rejects the removed --cc flag only on its former Space action command", () => {
    expect(
      getRemovedCcCliInputMessage([
        "node",
        "openmeld",
        "--view",
        "agent",
        "spaces",
        "action",
        "reply",
        "message",
        "--cc=@Mira",
      ])
    ).toBe(
      "CC has been removed from Space Message Addressing. Use --reference instead."
    );
  });

  it("recognizes the former command when parent or global options are interleaved", () => {
    const message =
      "CC has been removed from Space Message Addressing. Use --reference instead.";
    expect(
      getRemovedCcCliInputMessage([
        "node",
        "openmeld",
        "space",
        "--profile",
        "profile-id",
        "action",
        "reply",
        "message",
        "--cc",
        "@Mira",
      ])
    ).toBe(message);
    expect(
      getRemovedCcCliInputMessage([
        "node",
        "openmeld",
        "space",
        "action",
        "--view",
        "agent",
        "reply",
        "message",
        "--cc",
        "@Mira",
      ])
    ).toBe(message);
  });

  it("does not intercept --cc in Space message text", () => {
    expect(
      getRemovedCcCliInputMessage([
        "node",
        "openmeld",
        "space",
        "send",
        "space-id",
        "--",
        "--cc",
      ])
    ).toBeNull();
    expect(
      getRemovedCcCliInputMessage([
        "node",
        "openmeld",
        "space",
        "send",
        "space-id",
        "--text",
        "--cc",
      ])
    ).toBeNull();
  });

  it("does not intercept --cc after the option terminator or as an option value", () => {
    expect(
      getRemovedCcCliInputMessage([
        "node",
        "openmeld",
        "space",
        "action",
        "reply",
        "--",
        "--cc",
      ])
    ).toBeNull();
    expect(
      getRemovedCcCliInputMessage([
        "node",
        "openmeld",
        "space",
        "action",
        "reply",
        "--reference",
        "--cc",
        "message",
      ])
    ).toBeNull();
  });

  it("does not intercept --cc after a root option terminator", () => {
    expect(
      getRemovedCcCliInputMessage([
        "node",
        "openmeld",
        "--",
        "space",
        "action",
        "reply",
        "--cc",
      ])
    ).toBeNull();
  });

  it("does not intercept --cc for non-Space commands", () => {
    expect(
      getRemovedCcCliInputMessage([
        "node",
        "openmeld",
        "feedback",
        "message",
        "--details",
        "--cc",
      ])
    ).toBeNull();
  });

  it("does not intercept current Wake or Reference inputs", () => {
    expect(
      getRemovedCcCliInputMessage([
        "node",
        "openmeld",
        "space",
        "action",
        "reply",
        "--reference",
        "@Mira",
        "message",
      ])
    ).toBeNull();
  });
});
