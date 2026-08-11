"use client";

import {
	createContext,
	type Dispatch,
	type PropsWithChildren,
	use,
	useCallback,
	useEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
} from "react";
import { z } from "zod/v4";

const START_FLOW_STORAGE_KEY = "openmeld.start.flow";

const localAgentSetupChoiceSchema = z.enum([
	"setup_this_computer",
	"use_existing_setup",
	"skip_setup",
]);

const spaceEntrySelectionSchema = z.union([
	z.strictObject({
		status: z.literal("unresolved"),
		selectedAdditionalProfileIds: z.array(z.never()),
	}),
	z.strictObject({
		status: z.literal("ready"),
		selectedAdditionalProfileIds: z.array(z.string().trim().min(1)),
		deferredLocalAgentProfileIds: z.array(z.string().trim().min(1)).optional(),
	}),
]);

const startFlowStateSchema = z.strictObject({
	entryActor: z.literal("human"),
	selectedHumanProfileId: z.string().trim().min(1).nullable(),
	localAgentSetupChoice: localAgentSetupChoiceSchema.nullable(),
	spaceChoice: z.enum(["join", "create"]).nullable(),
	joinMethod: z.enum(["saved_space", "space_id"]).nullable(),
	targetSpaceId: z.string().trim().min(1).nullable(),
	targetSpaceName: z.string().trim().min(1).nullable(),
	targetSpaceSource: z.enum(["join_existing", "create_space"]).nullable(),
	spaceEntrySelection: spaceEntrySelectionSchema.nullable(),
});

export type StartFlowState = z.infer<typeof startFlowStateSchema>;

export type StartFlowAction =
	| {
			type: "reset";
	  }
	| {
			type: "replace_state";
			state: StartFlowState;
	  }
	| {
			type: "set_selected_human_profile_id";
			selectedHumanProfileId: string | null;
	  }
	| {
			type: "set_local_agent_setup_choice";
			localAgentSetupChoice: StartFlowState["localAgentSetupChoice"];
	  }
	| {
			type: "set_space_choice";
			spaceChoice: StartFlowState["spaceChoice"];
	  }
	| {
			type: "set_join_method";
			joinMethod: StartFlowState["joinMethod"];
	  }
	| {
			type: "set_target_space";
			targetSpaceId: string;
			targetSpaceName?: string | null;
			targetSpaceSource: "join_existing" | "create_space";
	  }
	| {
			type: "clear_target_space";
	  }
	| {
			type: "set_space_entry_selection";
			spaceEntrySelection: StartFlowState["spaceEntrySelection"];
	  };

type StartFlowStateContextValue = {
	dispatch: Dispatch<StartFlowAction>;
	hasRestored: boolean;
	state: StartFlowState;
	storageScope: string;
};

const StartFlowStateContext = createContext<StartFlowStateContextValue | null>(
	null
);

export function createInitialStartFlowState(): StartFlowState {
	return {
		entryActor: "human",
		selectedHumanProfileId: null,
		localAgentSetupChoice: null,
		spaceChoice: null,
		joinMethod: null,
		targetSpaceId: null,
		targetSpaceName: null,
		targetSpaceSource: null,
		spaceEntrySelection: null,
	};
}

export function reduceStartFlowState(
	state: StartFlowState,
	action: StartFlowAction
): StartFlowState {
	switch (action.type) {
		case "replace_state":
			return action.state;
		case "reset":
			return createInitialStartFlowState();
		case "set_selected_human_profile_id":
			return {
				...state,
				selectedHumanProfileId: normalizeOptionalId(
					action.selectedHumanProfileId
				),
				localAgentSetupChoice: null,
				spaceChoice: null,
				joinMethod: null,
				targetSpaceId: null,
				targetSpaceName: null,
				targetSpaceSource: null,
				spaceEntrySelection: null,
			};
		case "set_local_agent_setup_choice":
			// Local-agent setup is downstream of the selected Space. Keep the Space
			// target intact so setup, existing setup, and skip routes can continue.
			return {
				...state,
				localAgentSetupChoice: action.localAgentSetupChoice,
				spaceEntrySelection: null,
			};
		case "set_space_choice":
			return {
				...state,
				localAgentSetupChoice: null,
				spaceChoice: action.spaceChoice,
				joinMethod: null,
				targetSpaceId: null,
				targetSpaceName: null,
				targetSpaceSource: null,
				spaceEntrySelection: null,
			};
		case "set_join_method":
			return {
				...state,
				joinMethod: action.joinMethod,
				targetSpaceId: null,
				targetSpaceName: null,
				targetSpaceSource: null,
				spaceEntrySelection: null,
			};
		case "set_target_space":
			return {
				...state,
				targetSpaceId: normalizeRequiredId(action.targetSpaceId),
				targetSpaceName: normalizeOptionalId(action.targetSpaceName),
				targetSpaceSource: action.targetSpaceSource,
				spaceEntrySelection: null,
			};
		case "clear_target_space":
			return {
				...state,
				targetSpaceId: null,
				targetSpaceName: null,
				targetSpaceSource: null,
				spaceEntrySelection: null,
			};
		case "set_space_entry_selection":
			return {
				...state,
				spaceEntrySelection: normalizeSpaceEntrySelection(
					action.spaceEntrySelection
				),
			};
		default:
			return state;
	}
}

export function parsePersistedStartFlowState(
	value: string | null | undefined
): StartFlowState | null {
	if (typeof value !== "string" || value.trim().length === 0) {
		return null;
	}

	try {
		const parsedJson = JSON.parse(value) as unknown;
		const parsedState = startFlowStateSchema.safeParse(
			typeof parsedJson === "object" && parsedJson !== null
				? migratePersistedStartFlowStateFields({
						...createInitialStartFlowState(),
						...pickPersistedStartFlowStateFields(
							parsedJson as Record<string, unknown>
						),
					})
				: parsedJson
		);
		return parsedState.success ? parsedState.data : null;
	} catch {
		return null;
	}
}

export function serializeStartFlowState(state: StartFlowState): string {
	return JSON.stringify(state);
}

export function resolveStartFlowStorageKey(storageScope?: string): string {
	const normalizedScope = String(storageScope ?? "").trim();
	return normalizedScope.length > 0
		? `${START_FLOW_STORAGE_KEY}:${normalizedScope}`
		: START_FLOW_STORAGE_KEY;
}

export function StartFlowStateProvider(
	input: PropsWithChildren<{
		storageScope?: string;
	}>
) {
	const [state, rawDispatch] = useReducer(
		reduceStartFlowState,
		undefined,
		createInitialStartFlowState
	);
	const stateRef = useRef(state);
	const storageScope = useMemo(
		() => String(input.storageScope ?? "").trim(),
		[input.storageScope]
	);
	const [restoredStorageKey, setRestoredStorageKey] = useState<string | null>(
		null
	);
	const storageKey = useMemo(
		() => resolveStartFlowStorageKey(storageScope),
		[storageScope]
	);
	const hasRestored = restoredStorageKey === storageKey;

	useEffect(() => {
		setRestoredStorageKey(null);

		if (typeof window === "undefined") {
			setRestoredStorageKey(storageKey);
			return;
		}

		const nextState =
			parsePersistedStartFlowState(window.sessionStorage.getItem(storageKey)) ??
			createInitialStartFlowState();
		stateRef.current = nextState;
		rawDispatch({
			type: "replace_state",
			state: nextState,
		});
		setRestoredStorageKey(storageKey);
	}, [storageKey]);

	useEffect(() => {
		stateRef.current = state;
	}, [state]);

	const dispatch = useCallback<Dispatch<StartFlowAction>>(
		(action) => {
			const nextState = reduceStartFlowState(stateRef.current, action);
			stateRef.current = nextState;
			rawDispatch({
				type: "replace_state",
				state: nextState,
			});

			if (typeof window !== "undefined" && restoredStorageKey === storageKey) {
				window.sessionStorage.setItem(
					storageKey,
					serializeStartFlowState(nextState)
				);
			}
		},
		[restoredStorageKey, storageKey]
	);

	const value = useMemo(
		() => ({
			hasRestored,
			state,
			dispatch,
			storageScope,
		}),
		[dispatch, hasRestored, state, storageScope]
	);

	return (
		<StartFlowStateContext.Provider value={value}>
			{input.children}
		</StartFlowStateContext.Provider>
	);
}

export function useStartFlowState() {
	const value = use(StartFlowStateContext);
	if (!value) {
		throw new Error("Start flow state is unavailable outside the app shell.");
	}

	return value;
}

function normalizeOptionalId(value: unknown): string | null {
	const normalized = String(value ?? "").trim();
	return normalized.length > 0 ? normalized : null;
}

function normalizeRequiredId(value: string): string {
	const normalized = value.trim();
	if (normalized.length === 0) {
		throw new Error("Expected a non-empty start flow identifier.");
	}

	return normalized;
}
function pickPersistedStartFlowStateFields(value: Record<string, unknown>) {
	const nextState: Record<string, unknown> = {};
	const allowedKeys = [
		"entryActor",
		"selectedHumanProfileId",
		"localAgentSetupChoice",
		"spaceChoice",
		"joinMethod",
		"targetSpaceId",
		"targetSpaceName",
		"targetSpaceSource",
		"spaceEntrySelection",
		"spaceMemberChoice",
		"selectedSpaceMemberProfileIds",
	] as const;

	for (const key of allowedKeys) {
		if (key in value) {
			nextState[key] = value[key];
		}
	}

	if (
		!("localAgentSetupChoice" in nextState) &&
		typeof value.wantsBringAgents === "boolean"
	) {
		nextState.localAgentSetupChoice = value.wantsBringAgents
			? "setup_this_computer"
			: "skip_setup";
	}

	return nextState;
}

function migratePersistedStartFlowStateFields(value: Record<string, unknown>) {
	const migratedState = { ...value };

	if (
		migratedState.spaceEntrySelection === null &&
		("spaceMemberChoice" in migratedState ||
			"selectedSpaceMemberProfileIds" in migratedState)
	) {
		migratedState.spaceEntrySelection = migrateLegacySpaceEntrySelection({
			spaceMemberChoice: migratedState.spaceMemberChoice,
			selectedSpaceMemberProfileIds:
				migratedState.selectedSpaceMemberProfileIds,
		});
	}

	const stateWithoutLegacyFields: Record<string, unknown> = {};
	for (const [key, fieldValue] of Object.entries(migratedState)) {
		if (
			key === "spaceMemberChoice" ||
			key === "selectedSpaceMemberProfileIds"
		) {
			continue;
		}
		stateWithoutLegacyFields[key] = fieldValue;
	}

	return stateWithoutLegacyFields;
}

function migrateLegacySpaceEntrySelection(input: {
	spaceMemberChoice: unknown;
	selectedSpaceMemberProfileIds: unknown;
}): StartFlowState["spaceEntrySelection"] {
	const selectedAdditionalProfileIds = Array.isArray(
		input.selectedSpaceMemberProfileIds
	)
		? normalizeProfileIdList(input.selectedSpaceMemberProfileIds)
		: [];

	if (input.spaceMemberChoice === "just_me") {
		return {
			status: "ready",
			selectedAdditionalProfileIds: [],
		};
	}

	if (input.spaceMemberChoice === "bring_other_profiles") {
		return selectedAdditionalProfileIds.length > 0
			? {
					status: "ready",
					selectedAdditionalProfileIds,
				}
			: {
					status: "unresolved",
					selectedAdditionalProfileIds: [],
				};
	}

	return null;
}

function normalizeSpaceEntrySelection(
	spaceEntrySelection: StartFlowState["spaceEntrySelection"]
): StartFlowState["spaceEntrySelection"] {
	if (spaceEntrySelection === null) {
		return null;
	}

	if (spaceEntrySelection.status === "unresolved") {
		return {
			status: "unresolved",
			selectedAdditionalProfileIds: [],
		};
	}

	return {
		status: "ready",
		...normalizeReadySpaceEntrySelection(spaceEntrySelection),
	};
}

function normalizeReadySpaceEntrySelection(
	spaceEntrySelection: Extract<
		StartFlowState["spaceEntrySelection"],
		{ status: "ready" }
	>
): Omit<
	Extract<StartFlowState["spaceEntrySelection"], { status: "ready" }>,
	"status"
> {
	const selectedAdditionalProfileIds = normalizeProfileIdList(
		spaceEntrySelection.selectedAdditionalProfileIds
	);
	const selectedProfileIdSet = new Set(selectedAdditionalProfileIds);
	const deferredLocalAgentProfileIds = normalizeProfileIdList(
		spaceEntrySelection.deferredLocalAgentProfileIds ?? []
	).filter((profileId) => selectedProfileIdSet.has(profileId));

	return deferredLocalAgentProfileIds.length > 0
		? {
				selectedAdditionalProfileIds,
				deferredLocalAgentProfileIds,
			}
		: {
				selectedAdditionalProfileIds,
			};
}

function normalizeProfileIdList(value: readonly unknown[]): string[] {
	const profileIds: string[] = [];
	const seenProfileIds = new Set<string>();

	for (const candidate of value) {
		const profileId = normalizeOptionalId(candidate);
		if (profileId === null || seenProfileIds.has(profileId)) {
			continue;
		}
		profileIds.push(profileId);
		seenProfileIds.add(profileId);
	}

	return profileIds;
}
