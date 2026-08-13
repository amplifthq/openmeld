import { compareAgentControllerRefsForDisplay } from "@openmeld/schemas";

export type LocalAgentCandidateTargetKind = "builtin" | "custom";

export type LocalAgentCandidate = {
  agentId: string;
  enabled: boolean;
  lifecycleStatus?: "active" | "suspended";
  registered: boolean;
  selectable: boolean;
  targetKind: LocalAgentCandidateTargetKind;
};

export type SelectableLocalAgentCandidate<
  TCandidate extends LocalAgentCandidate,
> = TCandidate & {
  enabled: true;
  registered: true;
  selectable: true;
  targetKind: "builtin";
};

export function resolveSelectableCandidates<
  TCandidate extends LocalAgentCandidate,
>(
  candidates: readonly TCandidate[]
): SelectableLocalAgentCandidate<TCandidate>[] {
  return candidates
    .filter(isSelectableLocalAgentCandidate)
    .sort((left, right) =>
      compareAgentControllerRefsForDisplay(left.agentId, right.agentId)
    );
}

function isSelectableLocalAgentCandidate<
  TCandidate extends LocalAgentCandidate,
>(
  candidate: TCandidate
): candidate is SelectableLocalAgentCandidate<TCandidate> {
  return (
    candidate.targetKind === "builtin" &&
    candidate.registered &&
    candidate.enabled &&
    candidate.lifecycleStatus !== "suspended" &&
    candidate.selectable
  );
}
