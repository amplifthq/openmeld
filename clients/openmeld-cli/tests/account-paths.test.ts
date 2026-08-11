import { describe, expect, it } from "vitest";
import {
  normalizeAccountHostKey,
  normalizeAccountUserKey,
  normalizeOpenMeldProfileId,
} from "../src/config/paths";

describe("account path normalization", () => {
  it("falls back for dot-only path segments", () => {
    expect(normalizeAccountHostKey(".")).toBe("unauthenticated");
    expect(normalizeAccountHostKey("..")).toBe("unauthenticated");
    expect(normalizeAccountUserKey(".")).toBe("local");
    expect(normalizeAccountUserKey("..")).toBe("local");
  });

  it("normalizes host and user identifiers safely", () => {
    expect(normalizeAccountHostKey("AUTH.OpenMeld.SH:8788")).toBe(
      "auth.openmeld.sh_8788"
    );
    expect(normalizeAccountUserKey("User-01@example.com")).toBe(
      "user-01_example.com"
    );
  });

  it("rejects invalid profile inputs", () => {
    expect(() => normalizeOpenMeldProfileId(".")).toThrow(
      "openMeldProfileId is invalid"
    );
    expect(() => normalizeOpenMeldProfileId("..")).toThrow(
      "openMeldProfileId is invalid"
    );
    expect(() => normalizeOpenMeldProfileId("")).toThrow(
      "openMeldProfileId is required"
    );
    expect(() => normalizeOpenMeldProfileId("a".repeat(129))).toThrow(
      "openMeldProfileId is too long"
    );
  });

  it("normalizes profile identifiers safely", () => {
    expect(normalizeOpenMeldProfileId("Agt-Session_01")).toBe("agt-session_01");
  });
});
