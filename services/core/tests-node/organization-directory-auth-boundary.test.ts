import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { describe, expect, it } from "vitest";

const AUTH_PRIVATE_DIRECTORY_SQL_PATTERN =
  /\b(?:FROM|JOIN)\s+(?:members|users|openmeld_profiles)\b/;
const RPC_METHODS_SOURCE = readFileSync(
  fileURLToPath(new URL("../src/rpc/methods.ts", import.meta.url)),
  "utf8"
);
const DIRECTORY_PROJECTION_SOURCE = readFileSync(
  fileURLToPath(
    new URL("../src/organizations/organization-directory.ts", import.meta.url)
  ),
  "utf8"
);

describe("Organization Directory Auth ownership boundary", () => {
  it("does not rebuild member identity from Auth private tables in Core", () => {
    expect(RPC_METHODS_SOURCE).not.toContain(
      "function readOrganizationDirectoryMemberRows"
    );
  });

  it("does not rebuild Agent Profile identity from Auth private tables in Core", () => {
    expect(RPC_METHODS_SOURCE).not.toContain(
      "function readOrganizationDirectoryAgentRows"
    );
  });

  it("keeps the centralized Core Directory consumer free of Auth private SQL", () => {
    expect(DIRECTORY_PROJECTION_SOURCE).not.toMatch(
      AUTH_PRIVATE_DIRECTORY_SQL_PATTERN
    );
  });
});
