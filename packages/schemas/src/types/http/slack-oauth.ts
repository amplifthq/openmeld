import type { z } from "zod/v4";

type SlackOAuthErrorCodeSchema =
  typeof import("../../schemas/http/slack-oauth")["slackOAuthErrorCodeSchema"];
type SlackOAuthInstallationInputSchema =
  typeof import("../../schemas/http/slack-oauth")["slackOAuthInstallationInputSchema"];
type SlackOAuthInstallationResultSchema =
  typeof import("../../schemas/http/slack-oauth")["slackOAuthInstallationResultSchema"];
type SlackOAuthInstallationStatusSchema =
  typeof import("../../schemas/http/slack-oauth")["slackOAuthInstallationStatusSchema"];
type SlackOAuthOrganizationMembershipInputSchema =
  typeof import("../../schemas/http/slack-oauth")["slackOAuthOrganizationMembershipInputSchema"];
type SlackOAuthOrganizationMembershipResultSchema =
  typeof import("../../schemas/http/slack-oauth")["slackOAuthOrganizationMembershipResultSchema"];
type SlackOAuthStateConsumeResponseSchema =
  typeof import("../../schemas/http/slack-oauth")["slackOAuthStateConsumeResponseSchema"];
type SlackOAuthStateCreateResponseSchema =
  typeof import("../../schemas/http/slack-oauth")["slackOAuthStateCreateResponseSchema"];
type SlackOAuthStateSchema =
  typeof import("../../schemas/http/slack-oauth")["slackOAuthStateSchema"];

export type SlackOAuthErrorCode = z.infer<SlackOAuthErrorCodeSchema>;
export type SlackOAuthInstallationInput =
  z.infer<SlackOAuthInstallationInputSchema>;
export type SlackOAuthInstallationResult =
  z.infer<SlackOAuthInstallationResultSchema>;
export type SlackOAuthInstallationStatus =
  z.infer<SlackOAuthInstallationStatusSchema>;
export type SlackOAuthOrganizationMembershipInput =
  z.infer<SlackOAuthOrganizationMembershipInputSchema>;
export type SlackOAuthOrganizationMembershipResult =
  z.infer<SlackOAuthOrganizationMembershipResultSchema>;
export type SlackOAuthState = z.infer<SlackOAuthStateSchema>;
export type SlackOAuthStateConsumeResponse =
  z.infer<SlackOAuthStateConsumeResponseSchema>;
export type SlackOAuthStateCreateResponse =
  z.infer<SlackOAuthStateCreateResponseSchema>;
