import type {
  SpaceSendTargetAllowedRelations,
  SpaceSendTargetProjectionEntry,
  SpaceSendTargetWakeAvailability,
} from "./send-target-projection";

export type MentionPickerTarget = {
  allowedRelations: SpaceSendTargetAllowedRelations;
  controllerDisplay: string | null;
  agentControllerRef: string | null;
  description: string;
  labelSource: SpaceSendTargetProjectionEntry["labelSource"];
  ownerDisplay: string | null;
  primaryMentionLabel: string;
  profileId: string;
  profileKind: "human" | "agent";
  profileName: string;
  wakeAvailability: SpaceSendTargetWakeAvailability;
};

export type MentionPickerState =
  | {
      kind: "closed";
    }
  | {
      kind: "target_picker";
      query: string;
      selectedProfileId: string | null;
    }
  | {
      kind: "relation_picker";
      query: string;
      target: MentionPickerTarget;
    };

export function closeMentionPickerState(): MentionPickerState {
  return { kind: "closed" };
}

export function openTargetPickerState(input: {
  query: string;
  selectedProfileId?: string | null;
}): MentionPickerState {
  return {
    kind: "target_picker",
    query: input.query,
    selectedProfileId: input.selectedProfileId ?? null,
  };
}

export function enterRelationPickerState(input: {
  query: string;
  target: MentionPickerTarget;
}): MentionPickerState {
  return {
    kind: "relation_picker",
    query: input.query,
    target: input.target,
  };
}

export function returnToTargetPickerState(
  state: Extract<MentionPickerState, { kind: "relation_picker" }>
): MentionPickerState {
  return openTargetPickerState({
    query: state.query,
    selectedProfileId: state.target.profileId,
  });
}

export function isRelationPickerState(
  state: MentionPickerState
): state is Extract<MentionPickerState, { kind: "relation_picker" }> {
  return state.kind === "relation_picker";
}

export function isTargetPickerState(
  state: MentionPickerState
): state is Extract<MentionPickerState, { kind: "target_picker" }> {
  return state.kind === "target_picker";
}
