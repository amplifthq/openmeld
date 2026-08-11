import { describe, expect, it } from "vitest";
import {
  buildCanonicalLocalProjectConnectRequest,
  buildCanonicalLocalProjectDiscoveryRequest,
} from "../src/rpc/methods";

const CANONICAL_FINGERPRINT = `sha256:${"a".repeat(64)}`;
const UNTRUSTED_FINGERPRINT = `sha256:${"b".repeat(64)}`;
const PROJECT = {
  archivedAtMs: null,
  canArchive: true,
  canManage: true,
  createdAtMs: 1,
  createdByUserId: "owner-1",
  id: "project-1",
  name: "OpenMeld",
  organizationId: "org-1",
  repositoryFingerprint: CANONICAL_FINGERPRINT,
  slug: "openmeld",
  updatedAtMs: 1,
};

describe("Core local Project control canonical downlink", () => {
  it("authors discovery fingerprints from canonical Projects only", () => {
    const request = buildCanonicalLocalProjectDiscoveryRequest({
      projects: [PROJECT],
      request: {
        clientGeneration: 9,
        expectedOrganizationId: "org-1",
        repositoryFingerprint: UNTRUSTED_FINGERPRINT,
      } as {
        clientGeneration: number;
        expectedOrganizationId: string;
      },
    });

    expect(request).toEqual({
      clientGeneration: 9,
      expectedOrganizationId: "org-1",
      projects: [
        {
          projectId: "project-1",
          repositoryFingerprint: CANONICAL_FINGERPRINT,
        },
      ],
    });
  });

  it("overwrites caller-authored connect fingerprint and slug values", () => {
    const request = buildCanonicalLocalProjectConnectRequest({
      project: PROJECT,
      request: {
        candidateId: "candidate-1",
        candidatePath: "/work/openmeld",
        clientGeneration: 9,
        expectedOrganizationId: "org-1",
        idempotencyKey: "connect-1",
        projectId: "project-1",
        projectSlug: "untrusted-slug",
        repositoryFingerprint: UNTRUSTED_FINGERPRINT,
      } as never,
    });

    expect(request).toMatchObject({
      projectSlug: "openmeld",
      repositoryFingerprint: CANONICAL_FINGERPRINT,
    });
  });
});
