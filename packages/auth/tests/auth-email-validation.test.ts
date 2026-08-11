import { describe, expect, it } from "vitest";
import { validateAuthEmailAddress } from "../src/utils/auth-email-validation";

describe("validateAuthEmailAddress", () => {
  it("accepts syntactically valid addresses without blocking disposable domains", () => {
    expect(validateAuthEmailAddress("person@example.com")).toBe(true);
    expect(validateAuthEmailAddress("openmeld-e2e-20260514@maildrop.cc")).toBe(
      true
    );
    expect(validateAuthEmailAddress("first.last+test@mailinator.com")).toBe(
      true
    );
  });

  it("rejects addresses that are not valid email syntax", () => {
    expect(validateAuthEmailAddress("not-an-email")).toBe(false);
    expect(validateAuthEmailAddress("person@localhost")).toBe(false);
    expect(validateAuthEmailAddress("person@example")).toBe(false);
    expect(validateAuthEmailAddress("person@-example.com")).toBe(false);
    expect(validateAuthEmailAddress("person@example-.com")).toBe(false);
    expect(validateAuthEmailAddress(" person@example.com")).toBe(false);
    expect(validateAuthEmailAddress("person@example.com ")).toBe(false);
  });
});
