import { describe, expect, it } from "vitest";
import { maskEmailForDisplay } from "../src/utils/mask-email";

describe("maskEmailForDisplay", () => {
  it("keeps only the first local character and the full domain", () => {
    expect(maskEmailForDisplay("beatrice@gmail.com")).toBe("b***@gmail.com");
    expect(maskEmailForDisplay("teammate@acme.io")).toBe("t***@acme.io");
  });

  it("never reveals a single-character local part", () => {
    expect(maskEmailForDisplay("a@example.com")).toBe("***@example.com");
  });

  it("trims surrounding whitespace before masking", () => {
    expect(maskEmailForDisplay("  beatrice@gmail.com  ")).toBe(
      "b***@gmail.com"
    );
  });

  it("masks on the last @ so plus-addressing and subdomains survive", () => {
    expect(maskEmailForDisplay("bob+invite@mail.corp.example")).toBe(
      "b***@mail.corp.example"
    );
  });

  it("fails closed for malformed or missing addresses", () => {
    expect(maskEmailForDisplay("not-an-email")).toBe("***");
    expect(maskEmailForDisplay("@example.com")).toBe("***");
    expect(maskEmailForDisplay("beatrice@")).toBe("***");
    expect(maskEmailForDisplay("")).toBe("***");
    expect(maskEmailForDisplay("   ")).toBe("***");
  });

  it("does not leak the raw local part in any masked output", () => {
    const masked = maskEmailForDisplay("beatrice@gmail.com");
    expect(masked.includes("eatrice")).toBe(false);
  });
});
