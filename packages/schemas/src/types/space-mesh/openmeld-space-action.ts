import type { z } from "zod/v4";

type OpenMeldSpaceActionReadResultBySchema =
  typeof import("../../schemas/space-mesh/openmeld-space-action")["openMeldSpaceActionReadResultBySchema"];
type OpenMeldSpaceActionReadUpdatesFromSchema =
  typeof import("../../schemas/space-mesh/openmeld-space-action")["openMeldSpaceActionReadUpdatesFromSchema"];
type OpenMeldSpaceActionReplyToSchema =
  typeof import("../../schemas/space-mesh/openmeld-space-action")["openMeldSpaceActionReplyToSchema"];
type OpenMeldSpaceActionSchema =
  typeof import("../../schemas/space-mesh/openmeld-space-action")["openMeldSpaceActionSchema"];
type OpenMeldSpaceEgressActionSchema =
  typeof import("../../schemas/space-mesh/openmeld-space-action")["openMeldSpaceEgressActionSchema"];
type OpenMeldSpacePostMessageActionSchema =
  typeof import("../../schemas/space-mesh/openmeld-space-action")["openMeldSpacePostMessageActionSchema"];
type OpenMeldSpacePostStatusActionSchema =
  typeof import("../../schemas/space-mesh/openmeld-space-action")["openMeldSpacePostStatusActionSchema"];
type OpenMeldSpaceReadResultActionSchema =
  typeof import("../../schemas/space-mesh/openmeld-space-action")["openMeldSpaceReadResultActionSchema"];
type OpenMeldSpaceReadUpdatesActionSchema =
  typeof import("../../schemas/space-mesh/openmeld-space-action")["openMeldSpaceReadUpdatesActionSchema"];
type OpenMeldSpaceStaySilentActionSchema =
  typeof import("../../schemas/space-mesh/openmeld-space-action")["openMeldSpaceStaySilentActionSchema"];

export type OpenMeldSpaceAction = z.infer<OpenMeldSpaceActionSchema>;
export type OpenMeldSpaceEgressAction =
  z.infer<OpenMeldSpaceEgressActionSchema>;
export type OpenMeldSpaceActionReplyTo =
  z.infer<OpenMeldSpaceActionReplyToSchema>;
export type OpenMeldSpaceActionReadUpdatesFrom =
  z.infer<OpenMeldSpaceActionReadUpdatesFromSchema>;
export type OpenMeldSpaceActionReadResultBy =
  z.infer<OpenMeldSpaceActionReadResultBySchema>;
export type OpenMeldSpacePostMessageAction =
  z.infer<OpenMeldSpacePostMessageActionSchema>;
export type OpenMeldSpacePostStatusAction =
  z.infer<OpenMeldSpacePostStatusActionSchema>;
export type OpenMeldSpaceStaySilentAction =
  z.infer<OpenMeldSpaceStaySilentActionSchema>;
export type OpenMeldSpaceReadUpdatesAction =
  z.infer<OpenMeldSpaceReadUpdatesActionSchema>;
export type OpenMeldSpaceReadResultAction =
  z.infer<OpenMeldSpaceReadResultActionSchema>;
