import type { z } from "zod/v4";

export type ClearSpaceReasoningReplay = z.infer<
  typeof import("../../schemas/protocol/agent-stream")["clearSpaceReasoningReplaySchema"]
>;

type SpaceAgentStreamSnapshotSchema =
  typeof import("../../schemas/protocol/agent-stream")["spaceAgentStreamSnapshotSchema"];
type SpaceAgentStreamPresenceSchema =
  typeof import("../../schemas/protocol/agent-stream")["spaceAgentStreamPresenceSchema"];
type SpaceAgentStreamDeltaFrameSchema =
  typeof import("../../schemas/protocol/agent-stream")["spaceAgentStreamDeltaFrameSchema"];
type AgentStreamToolPartSchema =
  typeof import("../../schemas/protocol/agent-stream")["agentStreamToolPartSchema"];
type SpaceAgentActivitySchema =
  typeof import("../../schemas/protocol/agent-stream")["spaceAgentActivitySchema"];
type SpaceAgentStreamPartFrameSchema =
  typeof import("../../schemas/protocol/agent-stream")["spaceAgentStreamPartFrameSchema"];
type SpaceAgentStreamTerminalSchema =
  typeof import("../../schemas/protocol/agent-stream")["spaceAgentStreamTerminalSchema"];
type SpaceAgentStreamTerminalFrameSchema =
  typeof import("../../schemas/protocol/agent-stream")["spaceAgentStreamTerminalFrameSchema"];

export type SpaceAgentStreamSnapshot = z.infer<SpaceAgentStreamSnapshotSchema>;
export type SpaceAgentStreamPresence = z.infer<SpaceAgentStreamPresenceSchema>;
export type SpaceAgentStreamDeltaFrame =
  z.infer<SpaceAgentStreamDeltaFrameSchema>;
export type AgentStreamToolPart = z.infer<AgentStreamToolPartSchema>;
export type AgentWorkActivity = NonNullable<AgentStreamToolPart["work"]>;
export type SpaceAgentActivity = z.infer<SpaceAgentActivitySchema>;
export type SpaceAgentStreamPartFrame =
  z.infer<SpaceAgentStreamPartFrameSchema>;
export type SpaceAgentStreamTerminal = z.infer<SpaceAgentStreamTerminalSchema>;
export type SpaceAgentStreamTerminalFrame =
  z.infer<SpaceAgentStreamTerminalFrameSchema>;
