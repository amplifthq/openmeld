import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { describe, expect, it } from "vitest";

const AUTH_PRIVATE_TABLE_READ_PATTERN =
  /\b(?:FROM|JOIN)\s+(?:members|users)\b/iu;
const MEMBER_TABLE_READ_PATTERN = /\bFROM\s+members\b/iu;

describe("connector Auth ownership boundary", () => {
  it("keeps connector storage independent of Auth private tables", () => {
    const repositorySource = readFileSync(
      fileURLToPath(
        new URL(
          "../src/connectors/connector-connection-repository.ts",
          import.meta.url
        )
      ),
      "utf8"
    );

    expect(repositorySource).not.toMatch(AUTH_PRIVATE_TABLE_READ_PATTERN);
  });

  it("routes requester membership through the centralized owner boundary", () => {
    const methodsSource = readFileSync(
      fileURLToPath(new URL("../src/rpc/methods.ts", import.meta.url)),
      "utf8"
    );
    const start = methodsSource.indexOf(
      "async function requireConnectorRequesterMembership"
    );
    const end = methodsSource.indexOf(
      "\nfunction requireOrganizationId",
      start
    );
    const membershipBoundarySource = methodsSource.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(membershipBoundarySource).toContain(
      "resolveOrganizationMembershipById"
    );
    expect(membershipBoundarySource).not.toMatch(MEMBER_TABLE_READ_PATTERN);
  });
});
