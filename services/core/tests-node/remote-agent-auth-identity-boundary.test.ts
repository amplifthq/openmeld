import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { describe, expect, it } from "vitest";

const AUTH_PRIVATE_IDENTITY_READ_PATTERN =
  /\b(?:FROM|JOIN)\s+(?:members|organizations|users|openmeld_profiles)\b/iu;

function readSource(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../src/${relativePath}`, import.meta.url)),
    "utf8"
  );
}

function readFunctionRange(
  source: string,
  startMarker: string,
  endMarker: string
): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end <= start) {
    throw new Error(`Could not resolve source range: ${startMarker}`);
  }
  return source.slice(start, end);
}

describe("Remote Agent Auth identity ownership boundary", () => {
  it("routes linked Slack event member identity through the Auth projection", () => {
    const source = readSource(
      "remote-agent/application/slack-signal-service.ts"
    );
    const identityBoundary = readFunctionRange(
      source,
      "async function resolveSlackMemberIdentity",
      "async function readSlackCenterAgentTarget"
    );

    expect(identityBoundary).toContain(
      "readOrganizationAccountIdentityProjection"
    );
    expect(identityBoundary).not.toMatch(AUTH_PRIVATE_IDENTITY_READ_PATTERN);
  });

  it("routes Slack continuation identity through the same Auth projection", () => {
    const source = readSource(
      "remote-agent/application/native-delivery-service.ts"
    );
    const continuationBoundary = readFunctionRange(
      source,
      "export async function continueSlackIdentityOnboardingRequest",
      "function buildSlackIdentityContinuationKey"
    );

    expect(continuationBoundary).toContain(
      "readOrganizationAccountIdentityProjection"
    );
    expect(continuationBoundary).not.toMatch(
      AUTH_PRIVATE_IDENTITY_READ_PATTERN
    );
  });

  it("routes delegated members and delivery-memory speakers through the Auth projection", () => {
    const source = readSource(
      "remote-agent/application/native-delivery-service.ts"
    );
    for (const [startMarker, endMarker] of [
      [
        "async function readDelegatedNativeDeliveryMember",
        "async function failRemoteAgentRoutineDelivery",
      ],
      [
        "async function resolveDeliveryMemorySpeaker",
        "async function resolveCenterAgentMemorySource",
      ],
    ] as const) {
      const identityBoundary = readFunctionRange(
        source,
        startMarker,
        endMarker
      );
      expect(identityBoundary).toContain(
        "readOrganizationAccountIdentityProjection"
      );
      expect(identityBoundary).not.toMatch(AUTH_PRIVATE_IDENTITY_READ_PATTERN);
    }
  });

  it("routes Slack identity-link Organization copy through the Auth projection", () => {
    const source = readSource(
      "remote-agent/application/native-delivery-service.ts"
    );
    const navigationBoundary = readFunctionRange(
      source,
      "async function issueRemoteAgentSlackIdentityNavigationAction",
      "function requireRemoteAgentNavigationWebAppUrl"
    );

    expect(navigationBoundary).toContain(
      "readOrganizationAccountIdentityProjection"
    );
    expect(navigationBoundary).not.toMatch(AUTH_PRIVATE_IDENTITY_READ_PATTERN);
  });

  it("routes Message Channel member identity through the Auth projection", () => {
    const source = readSource(
      "remote-agent/application/message-channel-turn-resolution.ts"
    );
    const identityBoundary = readFunctionRange(
      source,
      "async function readMessageChannelOrganizationIdentity",
      "async function readMessageChannelCenterAgentTarget"
    );

    expect(identityBoundary).toContain(
      "readOrganizationAccountIdentityProjection"
    );
    expect(identityBoundary).not.toMatch(AUTH_PRIVATE_IDENTITY_READ_PATTERN);
  });

  it("routes Slack and Message Channel link previews through the Auth projection", () => {
    const source = readSource("rpc/methods.ts");
    for (const [startMarker, endMarker] of [
      [
        "async function readSlackIdentityLinkMembershipContext",
        "async function ensureSlackIdentityLinkMembership",
      ],
      [
        "async function readMessageChannelIdentityLinkMembership",
        "function createMessageChannelIdentityLinkTokenInvalidError",
      ],
    ] as const) {
      const identityBoundary = readFunctionRange(
        source,
        startMarker,
        endMarker
      );
      expect(identityBoundary).toContain(
        "readOrganizationAccountIdentityProjection"
      );
      expect(identityBoundary).not.toMatch(AUTH_PRIVATE_IDENTITY_READ_PATTERN);
    }
  });
});
