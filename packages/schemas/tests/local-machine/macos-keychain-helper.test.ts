import { describe, expect, it } from "vitest";
import {
  MAC_OS_KEYCHAIN_HELPER_SCHEMA_VERSION,
  macOsKeychainHelperRequestSchema,
} from "../../src";

describe("macOS Keychain helper schema", () => {
  it("requires noninteractive authentication for access-token reads", () => {
    expect(
      macOsKeychainHelperRequestSchema.parse({
        schemaVersion: MAC_OS_KEYCHAIN_HELPER_SCHEMA_VERSION,
        operation: "read",
        service: "sh.openmeld.auth.token",
        account: "openmeld-auth-test",
        authenticationInteraction: "disallow",
      })
    ).toMatchObject({ authenticationInteraction: "disallow" });

    expect(
      macOsKeychainHelperRequestSchema.safeParse({
        schemaVersion: MAC_OS_KEYCHAIN_HELPER_SCHEMA_VERSION,
        operation: "read",
        service: "sh.openmeld.auth.token",
        account: "openmeld-auth-test",
        authenticationInteraction: "allow",
      }).success
    ).toBe(false);
  });

  it("disallows authentication UI for token mutations", () => {
    expect(
      macOsKeychainHelperRequestSchema.parse({
        schemaVersion: MAC_OS_KEYCHAIN_HELPER_SCHEMA_VERSION,
        operation: "store",
        service: "sh.openmeld.auth.token",
        account: "openmeld-auth-test",
        accessToken: "secret-access-token",
        authenticationInteraction: "disallow",
      })
    ).toMatchObject({ authenticationInteraction: "disallow" });

    expect(
      macOsKeychainHelperRequestSchema.safeParse({
        schemaVersion: MAC_OS_KEYCHAIN_HELPER_SCHEMA_VERSION,
        operation: "delete",
        service: "sh.openmeld.auth.token",
        account: "openmeld-auth-test",
        authenticationInteraction: "allow",
      }).success
    ).toBe(false);

    expect(
      macOsKeychainHelperRequestSchema.parse({
        schemaVersion: MAC_OS_KEYCHAIN_HELPER_SCHEMA_VERSION,
        operation: "delete",
        service: "sh.openmeld.auth.token",
        account: "openmeld-auth-test",
        authenticationInteraction: "disallow",
      })
    ).toMatchObject({ authenticationInteraction: "disallow" });
  });
});
