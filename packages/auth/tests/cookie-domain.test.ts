import { describe, expect, it } from "vitest";
import {
  inferCookieDomain,
  isCookieDomainSuffixOfHost,
  normalizeCookieDomain,
} from "../src/utils/cookie-domain";

describe("cookie-domain", () => {
  it("normalizes cookie domain values", () => {
    expect(normalizeCookieDomain(".OpenMeld.invalid")).toBe("openmeld.invalid");
  });

  it("checks cookie-domain suffix matching", () => {
    expect(
      isCookieDomainSuffixOfHost("openmeld.invalid", "auth.openmeld.invalid")
    ).toBe(true);
    expect(
      isCookieDomainSuffixOfHost("openmeld.invalid", "openmeld.invalid")
    ).toBe(true);
    expect(
      isCookieDomainSuffixOfHost("openmeld.invalid", "auth.other.sh")
    ).toBe(false);
  });

  it("prefers explicit cookie domain when valid for the auth host", () => {
    const cookieDomain = inferCookieDomain({
      authUrl: "https://auth.openmeld.invalid",
      appUrl: "https://openmeld.invalid",
      explicitCookieDomain: ".openmeld.invalid",
    });

    expect(cookieDomain).toBe("openmeld.invalid");
  });

  it("returns null when explicit cookie domain is not valid for auth host", () => {
    const cookieDomain = inferCookieDomain({
      authUrl: "https://auth.openmeld.invalid",
      appUrl: "https://openmeld.invalid",
      explicitCookieDomain: "example.com",
    });

    expect(cookieDomain).toBeNull();
  });

  it("infers cookie domain from web/auth hosts when compatible", () => {
    const cookieDomain = inferCookieDomain({
      authUrl: "https://auth.openmeld.invalid",
      appUrl: "https://www.openmeld.invalid",
    });

    expect(cookieDomain).toBe("openmeld.invalid");
  });

  it("returns null when app and auth hosts are not compatible", () => {
    const cookieDomain = inferCookieDomain({
      authUrl: "https://auth.openmeld.invalid",
      appUrl: "https://openmeld.dev",
    });

    expect(cookieDomain).toBeNull();
  });
});
