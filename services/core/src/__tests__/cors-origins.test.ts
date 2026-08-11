import { describe, expect, it } from "vitest";
import { resolveCorsOrigins } from "../app";

describe("resolveCorsOrigins", () => {
  it("keeps wildcard as string", () => {
    expect(resolveCorsOrigins("*")).toBe("*");
  });

  it("treats mixed wildcard entries as wildcard", () => {
    expect(resolveCorsOrigins("*,https://preview.openmeld.invalid")).toBe("*");
  });

  it("returns explicit origin list", () => {
    expect(resolveCorsOrigins("https://a.example, https://b.example")).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
  });

  it("falls back to default origins when empty", () => {
    expect(resolveCorsOrigins(" , ")).toEqual(["https://gateway.openmeld.ai"]);
    expect(resolveCorsOrigins(undefined)).toEqual([
      "https://gateway.openmeld.ai",
    ]);
  });
});
