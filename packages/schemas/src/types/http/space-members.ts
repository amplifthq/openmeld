import type { z } from "zod/v4";

type SpaceMemberKindSchema =
  typeof import("../../schemas/http/space-members")["spaceMemberKindSchema"];
type SpaceMemberStatusSchema =
  typeof import("../../schemas/http/space-members")["spaceMemberStatusSchema"];
type SpaceMemberSourceSchema =
  typeof import("../../schemas/http/space-members")["spaceMemberSourceSchema"];
type SpaceMemberAgentExecutionReadinessSchema =
  typeof import("../../schemas/http/space-members")["spaceMemberAgentExecutionReadinessSchema"];
type SpaceMemberHumanSnapshotSchema =
  typeof import("../../schemas/http/space-members")["spaceMemberHumanSnapshotSchema"];
type SpaceMemberAgentSnapshotSchema =
  typeof import("../../schemas/http/space-members")["spaceMemberAgentSnapshotSchema"];
type ResolvedSpaceMemberProfileSchema =
  typeof import("../../schemas/http/space-members")["resolvedSpaceMemberProfileSchema"];
type SpaceMembersSummarySchema =
  typeof import("../../schemas/http/space-members")["spaceMembersSummarySchema"];
type SpaceMembersSnapshotSchema =
  typeof import("../../schemas/http/space-members")["spaceMembersSnapshotSchema"];
type RemoveSpaceMembersBodySchema =
  typeof import("../../schemas/http/space-members")["removeSpaceMembersBodySchema"];
type AddCenterAgentToSpaceBodySchema =
  typeof import("../../schemas/http/space-members")["addCenterAgentToSpaceBodySchema"];
type AddOrganizationDirectoryProfilesToSpaceBodySchema =
  typeof import("../../schemas/http/space-members")["addOrganizationDirectoryProfilesToSpaceBodySchema"];
type PostSpaceMembersBodySchema =
  typeof import("../../schemas/http/space-members")["postSpaceMembersBodySchema"];
type PostResolvedSpaceMembersBodySchema =
  typeof import("../../schemas/http/space-members")["postResolvedSpaceMembersBodySchema"];
type PostSpaceMembersResponseSchema =
  typeof import("../../schemas/http/space-members")["postSpaceMembersResponseSchema"];
type RemoveSpaceMembersResponseSchema =
  typeof import("../../schemas/http/space-members")["removeSpaceMembersResponseSchema"];
type LeaveSpaceResponseSchema =
  typeof import("../../schemas/http/space-members")["leaveSpaceResponseSchema"];
type SpaceViewerMembershipProfileSchema =
  typeof import("../../schemas/http/space-members")["spaceViewerMembershipProfileSchema"];
type SpaceViewerMembershipResponseSchema =
  typeof import("../../schemas/http/space-members")["spaceViewerMembershipResponseSchema"];
type SpaceIdentityDirectoryEntrySchema =
  typeof import("../../schemas/http/space-members")["spaceIdentityDirectoryEntrySchema"];
type SpaceIdentityDirectorySchema =
  typeof import("../../schemas/http/space-members")["spaceIdentityDirectorySchema"];
type SpaceMemberDirectoryAllowedRelationsSchema =
  typeof import("../../schemas/http/space-members")["spaceMemberDirectoryAllowedRelationsSchema"];
type SpaceMemberDirectoryCardSchema =
  typeof import("../../schemas/http/space-members")["spaceMemberDirectoryCardSchema"];
type SpaceMemberDirectoryEntrySchema =
  typeof import("../../schemas/http/space-members")["spaceMemberDirectoryEntrySchema"];
type SpaceMemberDirectorySchema =
  typeof import("../../schemas/http/space-members")["spaceMemberDirectorySchema"];

export type SpaceMemberKind = z.infer<SpaceMemberKindSchema>;
export type SpaceMemberStatus = z.infer<SpaceMemberStatusSchema>;
export type SpaceMemberSource = z.infer<SpaceMemberSourceSchema>;
export type SpaceMemberAgentExecutionReadiness =
  z.infer<SpaceMemberAgentExecutionReadinessSchema>;
export type SpaceMemberHumanSnapshot = z.infer<SpaceMemberHumanSnapshotSchema>;
export type SpaceMemberAgentSnapshot = z.infer<SpaceMemberAgentSnapshotSchema>;
export type ResolvedSpaceMemberProfile =
  z.infer<ResolvedSpaceMemberProfileSchema>;
export type SpaceMembersSummary = z.infer<SpaceMembersSummarySchema>;
export type SpaceMembersSnapshot = z.infer<SpaceMembersSnapshotSchema>;
export type AddCenterAgentToSpaceBody =
  z.infer<AddCenterAgentToSpaceBodySchema>;
export type AddOrganizationDirectoryProfilesToSpaceBody =
  z.infer<AddOrganizationDirectoryProfilesToSpaceBodySchema>;
export type RemoveSpaceMembersBody = z.infer<RemoveSpaceMembersBodySchema>;
export type PostSpaceMembersBody = z.infer<PostSpaceMembersBodySchema>;
export type PostResolvedSpaceMembersBody =
  z.infer<PostResolvedSpaceMembersBodySchema>;
export type PostSpaceMembersResponse = z.infer<PostSpaceMembersResponseSchema>;
export type RemoveSpaceMembersResponse =
  z.infer<RemoveSpaceMembersResponseSchema>;
export type LeaveSpaceResponse = z.infer<LeaveSpaceResponseSchema>;
export type SpaceViewerMembershipProfile =
  z.infer<SpaceViewerMembershipProfileSchema>;
export type SpaceViewerMembershipResponse =
  z.infer<SpaceViewerMembershipResponseSchema>;
export type SpaceIdentityDirectoryEntry =
  z.infer<SpaceIdentityDirectoryEntrySchema>;
export type SpaceIdentityDirectory = z.infer<SpaceIdentityDirectorySchema>;
export type SpaceMemberDirectoryAllowedRelations =
  z.infer<SpaceMemberDirectoryAllowedRelationsSchema>;
export type SpaceMemberDirectoryCard = z.infer<SpaceMemberDirectoryCardSchema>;
export type SpaceMemberDirectoryEntry =
  z.infer<SpaceMemberDirectoryEntrySchema>;
export type SpaceMemberDirectory = z.infer<SpaceMemberDirectorySchema>;
