import { describe, expect, it } from "vitest";
import { OPENMELD_SCHEMA_VERSION } from "../src/index";

describe("schemas package smoke", () => {
  it("exports schema version", () => {
    expect(OPENMELD_SCHEMA_VERSION).toBe(1);
  });
});
