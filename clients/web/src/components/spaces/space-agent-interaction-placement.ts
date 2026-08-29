export type SpaceAgentInteractionPlacement = "inline" | "pending-surface";

export function resolveSpaceAgentInteractionPlacement(
	placement?: SpaceAgentInteractionPlacement
): SpaceAgentInteractionPlacement {
	return placement ?? "inline";
}
