import { describe, expect, it } from "vitest";
import { dispatchStorageReadinessSchema } from "../../src/index";

describe("dispatch storage readiness schema", () => {
  it("accepts the frozen readiness payload", () => {
    expect(
      dispatchStorageReadinessSchema.safeParse({
        ready: false,
        detail: "Shared OPENMELD_DB migration is missing required index demo.",
        checkedAt: "2026-04-07T00:00:00.000Z",
      }).success
    ).toBe(true);
  });

  it("rejects payloads without ISO timestamps", () => {
    expect(
      dispatchStorageReadinessSchema.safeParse({
        ready: true,
        detail: null,
        checkedAt: "yesterday",
      }).success
    ).toBe(false);
  });

  it("accepts nullable detail fields", () => {
    expect(
      dispatchStorageReadinessSchema.safeParse({
        ready: true,
        detail: null,
        checkedAt: "2026-04-07T00:00:00.000Z",
      }).success
    ).toBe(true);
  });

  it("rejects unknown properties because the contract is strict", () => {
    expect(
      dispatchStorageReadinessSchema.safeParse({
        ready: true,
        detail: null,
        checkedAt: "2026-04-07T00:00:00.000Z",
        extraProp: "x",
      }).success
    ).toBe(false);
  });
});
