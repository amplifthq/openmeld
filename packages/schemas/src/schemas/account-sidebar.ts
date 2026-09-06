import { z } from "zod/v4";

export const sidebarSortSchema = z.enum([
  "priority",
  "recent",
  "name",
  "manual",
]);
const spaceIdsSchema = z.array(z.string().min(1).max(200)).max(5000);
const sectionSchema = z.object({
  sort: sidebarSortSchema,
  spaceIds: spaceIdsSchema,
});

const itemIdsSchema = z.array(z.string().min(1).max(200)).max(5000);
const peopleSectionSchema = z.object({
  sort: sidebarSortSchema,
  itemIds: itemIdsSchema,
});
export const peopleSidebarPreferencesSchema = z
  .object({
    starred: peopleSectionSchema,
    people: peopleSectionSchema,
    groups: z
      .array(
        peopleSectionSchema.extend({
          id: z.string().uuid(),
          name: z.string().trim().min(1).max(80),
        })
      )
      .max(100),
  })
  .superRefine((value, context) => {
    const grouped = [
      ...value.starred.itemIds,
      ...value.groups.flatMap((group) => group.itemIds),
    ];
    const groupIds = value.groups.map((group) => group.id);
    if (
      grouped.length > 5000 ||
      new Set(grouped).size !== grouped.length ||
      new Set(groupIds).size !== groupIds.length ||
      [value.starred, value.people, ...value.groups].some(
        (section) => new Set(section.itemIds).size !== section.itemIds.length
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "People and groups must be unique within each section.",
      });
    }
  });
export type PeopleSidebarPreferences = z.infer<
  typeof peopleSidebarPreferencesSchema
>;

const spaceSidebarPreferencesSchema = z
  .object({
    pinned: sectionSchema,
    spaces: sectionSchema,
    groups: z
      .array(
        sectionSchema.extend({
          id: z.string().uuid(),
          name: z.string().trim().min(1).max(80),
        })
      )
      .max(100),
  })
  .superRefine((value, context) => {
    const groupIds = value.groups.map((group) => group.id);
    const groupedSpaces = value.groups.flatMap((group) => group.spaceIds);
    if (groupedSpaces.length > 5000) {
      context.addIssue({
        code: "custom",
        message: "A sidebar can group up to 5,000 Spaces.",
      });
    }
    if (
      new Set(groupIds).size !== groupIds.length ||
      new Set(groupedSpaces).size !== groupedSpaces.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Groups and grouped Spaces must be unique.",
      });
    }
    for (const section of [value.pinned, value.spaces, ...value.groups]) {
      if (new Set(section.spaceIds).size !== section.spaceIds.length) {
        context.addIssue({
          code: "custom",
          message: "A Space can appear only once in a section.",
        });
      }
    }
  });

export const accountSidebarPreferencesSchema =
  spaceSidebarPreferencesSchema.safeExtend({
    agents: z
      .object({
        starred: peopleSectionSchema,
        items: peopleSectionSchema,
        groups: z
          .array(
            peopleSectionSchema.extend({
              id: z.string().uuid(),
              name: z.string().trim().min(1).max(80),
            })
          )
          .max(100),
      })
      .superRefine((value, context) => {
        const result = peopleSidebarPreferencesSchema.safeParse({
          starred: value.starred,
          people: value.items,
          groups: value.groups,
        });
        if (!result.success) {
          context.addIssue({
            code: "custom",
            message: "Agents and groups must be unique within each section.",
          });
        }
      })
      .optional(),
    people: peopleSidebarPreferencesSchema.optional(),
    messages: spaceSidebarPreferencesSchema.optional(),
  });

export const accountSidebarSnapshotSchema = z.object({
  revision: z.number().int().nonnegative(),
  preferences: accountSidebarPreferencesSchema,
});
export const saveAccountSidebarBodySchema = accountSidebarSnapshotSchema.extend(
  {
    organizationId: z.string().min(1).max(200),
  }
);
export const accountSidebarResponseSchema = accountSidebarSnapshotSchema.extend(
  { ok: z.literal(true) }
);
export const accountSidebarErrorResponseSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.enum([
      "auth.unauthenticated",
      "organization.membership_required",
      "invalid_payload",
      "sidebar.conflict",
    ]),
    message: z.string(),
    requestId: z.string().optional(),
  }),
});

export type AccountSidebarPreferences = z.infer<
  typeof accountSidebarPreferencesSchema
>;
export type AccountSidebarSnapshot = z.infer<
  typeof accountSidebarSnapshotSchema
>;
