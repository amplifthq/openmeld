import {
  members,
  organizationJoinLinks,
  organizations,
} from "@openmeld/db/auth";
import type { InferSelectModel } from "drizzle-orm";
import { and, eq, isNull, lte } from "drizzle-orm";
import type { createD1Db } from "../db";

export type OrganizationJoinLinkRecord = InferSelectModel<
  typeof organizationJoinLinks
>;

export type OrganizationJoinLinkOrganizationRecord = Pick<
  InferSelectModel<typeof organizations>,
  "id" | "metadata" | "name" | "slug"
>;

export type OrganizationJoinLinkMembershipRecord = Pick<
  InferSelectModel<typeof members>,
  "id" | "role"
>;

export type ActiveOrganizationJoinLinkRecord = OrganizationJoinLinkRecord & {
  organization: OrganizationJoinLinkOrganizationRecord;
};

export type OrganizationJoinLinkRepository = {
  findActiveByOrganizationId: (
    organizationId: string,
    spaceId?: string,
    mode?: "direct" | "request"
  ) => Promise<OrganizationJoinLinkRecord | null>;
  findActiveByToken: (
    token: string
  ) => Promise<ActiveOrganizationJoinLinkRecord | null>;
  findMembership: (
    organizationId: string,
    userId: string
  ) => Promise<OrganizationJoinLinkMembershipRecord | null>;
  findOrganizationById: (
    organizationId: string
  ) => Promise<OrganizationJoinLinkOrganizationRecord | null>;
  ensureActive: (input: {
    mode: "direct" | "request";
    expiresAt: Date;
    spaceId?: string;
    createdBy: string;
    id: string;
    organizationId: string;
    token: string;
  }) => Promise<OrganizationJoinLinkRecord>;
  resetActive: (input: {
    mode: "direct" | "request";
    expiresAt: Date;
    spaceId?: string;
    createdBy: string;
    id: string;
    organizationId: string;
    token: string;
  }) => Promise<OrganizationJoinLinkRecord>;
  revokeActive: (
    organizationId: string,
    spaceId?: string,
    mode?: "direct" | "request"
  ) => Promise<boolean>;
};

type OrganizationJoinLinkDatabase = ReturnType<typeof createD1Db>;

export function createDrizzleOrganizationJoinLinkRepository(
  db: OrganizationJoinLinkDatabase
): OrganizationJoinLinkRepository {
  return {
    async findActiveByOrganizationId(
      organizationId,
      spaceId,
      mode = "request"
    ) {
      const rows = await db
        .select()
        .from(organizationJoinLinks)
        .where(
          and(
            eq(organizationJoinLinks.organizationId, organizationId),
            eq(organizationJoinLinks.mode, mode),
            spaceId
              ? eq(organizationJoinLinks.spaceId, spaceId)
              : isNull(organizationJoinLinks.spaceId),
            isNull(organizationJoinLinks.revokedAt)
          )
        )
        .limit(1);
      return rows[0] ?? null;
    },
    async findActiveByToken(token) {
      const rows = await db
        .select({
          id: organizationJoinLinks.id,
          organizationId: organizationJoinLinks.organizationId,
          token: organizationJoinLinks.token,
          mode: organizationJoinLinks.mode,
          expiresAt: organizationJoinLinks.expiresAt,
          spaceId: organizationJoinLinks.spaceId,
          role: organizationJoinLinks.role,
          createdBy: organizationJoinLinks.createdBy,
          createdAt: organizationJoinLinks.createdAt,
          revokedAt: organizationJoinLinks.revokedAt,
          organization: {
            id: organizations.id,
            metadata: organizations.metadata,
            name: organizations.name,
            slug: organizations.slug,
          },
        })
        .from(organizationJoinLinks)
        .innerJoin(
          organizations,
          eq(organizations.id, organizationJoinLinks.organizationId)
        )
        .where(
          and(
            eq(organizationJoinLinks.token, token),
            isNull(organizationJoinLinks.revokedAt)
          )
        )
        .limit(1);
      return rows[0] ?? null;
    },
    async findMembership(organizationId, userId) {
      const rows = await db
        .select({ id: members.id, role: members.role })
        .from(members)
        .where(
          and(
            eq(members.organizationId, organizationId),
            eq(members.userId, userId)
          )
        )
        .limit(1);
      return rows[0] ?? null;
    },
    async findOrganizationById(organizationId) {
      const rows = await db
        .select({
          id: organizations.id,
          metadata: organizations.metadata,
          name: organizations.name,
          slug: organizations.slug,
        })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);
      return rows[0] ?? null;
    },
    async ensureActive(input) {
      const [, createdRows, activeRows] = await db.batch([
        db
          .update(organizationJoinLinks)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(organizationJoinLinks.organizationId, input.organizationId),
              eq(organizationJoinLinks.mode, input.mode),
              input.spaceId
                ? eq(organizationJoinLinks.spaceId, input.spaceId)
                : isNull(organizationJoinLinks.spaceId),
              isNull(organizationJoinLinks.revokedAt),
              lte(organizationJoinLinks.expiresAt, new Date())
            )
          ),
        db
          .insert(organizationJoinLinks)
          .values({
            id: input.id,
            mode: input.mode,
            expiresAt: input.expiresAt,
            spaceId: input.spaceId ?? null,
            organizationId: input.organizationId,
            token: input.token,
            role: "member",
            createdBy: input.createdBy,
          })
          .onConflictDoNothing()
          .returning(),
        db
          .select()
          .from(organizationJoinLinks)
          .where(
            and(
              eq(organizationJoinLinks.organizationId, input.organizationId),
              eq(organizationJoinLinks.mode, input.mode),
              input.spaceId
                ? eq(organizationJoinLinks.spaceId, input.spaceId)
                : isNull(organizationJoinLinks.spaceId),
              isNull(organizationJoinLinks.revokedAt)
            )
          )
          .limit(1),
      ]);
      const active = createdRows[0] ?? activeRows[0];
      if (!active) {
        throw new Error(
          "Organization join link ensure did not create or find an active link"
        );
      }
      return active;
    },
    async resetActive(input) {
      const now = new Date();
      const [, createdRows] = await db.batch([
        db
          .update(organizationJoinLinks)
          .set({ revokedAt: now })
          .where(
            and(
              eq(organizationJoinLinks.organizationId, input.organizationId),
              eq(organizationJoinLinks.mode, input.mode),
              input.spaceId
                ? eq(organizationJoinLinks.spaceId, input.spaceId)
                : isNull(organizationJoinLinks.spaceId),
              isNull(organizationJoinLinks.revokedAt)
            )
          ),
        db
          .insert(organizationJoinLinks)
          .values({
            id: input.id,
            mode: input.mode,
            expiresAt: input.expiresAt,
            spaceId: input.spaceId ?? null,
            organizationId: input.organizationId,
            token: input.token,
            role: "member",
            createdBy: input.createdBy,
            createdAt: now,
          })
          .returning(),
      ]);
      const created = createdRows[0];
      if (!created) {
        throw new Error("Organization join link insert returned no record");
      }
      return created;
    },
    async revokeActive(organizationId, spaceId, mode = "request") {
      const rows = await db
        .update(organizationJoinLinks)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(organizationJoinLinks.organizationId, organizationId),
            eq(organizationJoinLinks.mode, mode),
            spaceId
              ? eq(organizationJoinLinks.spaceId, spaceId)
              : isNull(organizationJoinLinks.spaceId),
            isNull(organizationJoinLinks.revokedAt)
          )
        )
        .returning({ id: organizationJoinLinks.id });
      return rows.length > 0;
    },
  };
}
