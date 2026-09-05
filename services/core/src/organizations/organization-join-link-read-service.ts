import { ORGANIZATION_JOIN_LINK_WEB_PATH } from "@openmeld/schemas";

export type ActiveOrganizationJoinLink = {
  organizationName: string;
  token: string;
};

type ActiveOrganizationJoinLinkRow = {
  organization_name: string;
  token: string;
};

export async function readActiveOrganizationJoinLink(input: {
  db: D1Database;
  organizationId: string;
}): Promise<ActiveOrganizationJoinLink | null> {
  const row = await input.db
    .prepare(
      `
        SELECT
          organization_join_links.token AS token,
          organizations.name AS organization_name
        FROM organization_join_links
        INNER JOIN organizations
          ON organizations.id = organization_join_links.organization_id
        WHERE organization_join_links.organization_id = ?
          AND organization_join_links.revoked_at IS NULL
          AND organization_join_links.space_id IS NULL
        LIMIT 1
      `
    )
    .bind(input.organizationId)
    .first<ActiveOrganizationJoinLinkRow>();

  return row
    ? {
        organizationName: row.organization_name,
        token: row.token,
      }
    : null;
}

export function buildOrganizationJoinLinkUrl(input: {
  token: string;
  webAppUrl: string;
}): string {
  const url = new URL(ORGANIZATION_JOIN_LINK_WEB_PATH, input.webAppUrl);
  url.searchParams.set("token", input.token);
  return url.toString();
}
