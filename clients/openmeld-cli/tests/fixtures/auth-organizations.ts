type CapturedOrganizationInput = {
  id: string;
  name: string;
  personal?: boolean;
  slug: string;
};

const CAPTURED_AT = "2026-07-07T03:13:22.500Z";
const CAPTURED_USER_ID = "6707746e-6b5c-43a0-b14f-0fc720fa6713";

// Sanitized from Better Auth 1.6.23's Organization plugin. Builders below
// preserve the captured field layout while letting command tests use readable
// Organization ids and slugs.
export function createCapturedBetterAuthOrganizationListResponse(
  organizations: readonly CapturedOrganizationInput[]
) {
  return organizations.map((organization) => ({
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    logo: null,
    createdAt: CAPTURED_AT,
    metadata: organization.personal ? '{"personal":true}' : null,
  }));
}

export function createCapturedBetterAuthGetFullOrganizationResponse(
  organization: CapturedOrganizationInput
) {
  return {
    name: organization.name,
    slug: organization.slug,
    logo: null,
    createdAt: CAPTURED_AT,
    metadata: organization.personal ? '{"personal":true}' : null,
    id: organization.id,
    invitations: [],
    members: [
      {
        organizationId: organization.id,
        userId: CAPTURED_USER_ID,
        role: "owner",
        createdAt: CAPTURED_AT,
        id: `member_${organization.id}`,
        user: {
          id: CAPTURED_USER_ID,
          name: "Probe User",
          email: "probe@example.com",
          image: null,
        },
      },
    ],
  };
}

// Better Auth owns the base session shape. OpenMeld Auth projects the durable
// account last-selected Organization onto user at this same HTTP boundary.
export function createCapturedBetterAuthSessionResponse(input: {
  activeOrganizationId: string | null;
  lastSelectedOrganizationId: string | null;
}) {
  return {
    session: {
      id: "0c1f16d7-3986-4706-badb-0b92c9c0154e",
      token: "sanitized-session-token",
      userId: CAPTURED_USER_ID,
      activeOrganizationId: input.activeOrganizationId,
      expiresAt: "2026-07-14T03:13:22.505Z",
      createdAt: "2026-07-07T03:13:22.505Z",
      updatedAt: "2026-07-07T03:13:22.505Z",
      ipAddress: "127.0.0.1",
      userAgent: "",
    },
    user: {
      id: CAPTURED_USER_ID,
      name: "Probe User",
      email: "probe@example.com",
      emailVerified: true,
      image: null,
      username: null,
      displayUsername: null,
      createdAt: "2026-07-07T03:13:22.453Z",
      updatedAt: "2026-07-07T03:13:22.453Z",
      lastSelectedOrganizationId: input.lastSelectedOrganizationId,
    },
  };
}
