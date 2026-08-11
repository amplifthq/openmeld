import { isAgentWorkActivityPresentable } from "@openmeld/schemas";
import type {
	AgentStreamToolPart,
	SpaceAgentStreamDeltaFrame,
	SpaceAgentStreamPartFrame,
	SpaceAgentStreamPresence,
	SpaceAgentStreamSnapshot,
	SpaceAgentStreamTerminalFrame,
} from "@openmeld/schemas/types";

type SpaceConversationStreamCommon = {
	createdAtMs: number;
	dispatchId: string;
	observedRevision: number;
	profileId: string;
	sequence: number;
	spaceId: string;
	streamId: string;
	triggerMessageId: string;
	updatedAtMs: number;
	toolParts?: readonly AgentStreamToolPart[];
};

const MAX_LIVE_AGENT_WORK_PARTS = 50;

export type SpaceConversationVisibleStreamProjection =
	| (SpaceConversationStreamCommon & {
			reasonCode: null;
			status: "streaming";
			text: string;
			textSequence: number;
			thinking?: string;
	  })
	| (SpaceConversationStreamCommon & {
			reasonCode: string;
			status: "failed" | "stopped" | "completed_but_publish_failed";
			text: string;
	  });

type SpaceConversationFinalStreamProjection = SpaceConversationStreamCommon & {
	publishedSignalId: string;
	status: "final_message";
};

export type SpaceConversationStreamProjection =
	| SpaceConversationVisibleStreamProjection
	| SpaceConversationFinalStreamProjection;

export type SpaceConversationStreamState =
	readonly SpaceConversationStreamProjection[];

export function applySpaceConversationStreamFrame(input: {
	current: SpaceConversationStreamState;
	frame:
		| SpaceAgentStreamDeltaFrame
		| SpaceAgentStreamPartFrame
		| SpaceAgentStreamTerminalFrame;
	observedRevision: number;
}): SpaceConversationStreamState {
	const currentProjection = input.current.find(
		(projection) => projection.streamId === input.frame.streamId
	);
	if (
		currentProjection &&
		!hasMatchingStreamIdentity(currentProjection, input.frame)
	) {
		return input.current;
	}

	if (input.frame.type === "space.agent_stream_delta") {
		if (
			currentProjection?.status !== undefined &&
			currentProjection.status !== "streaming"
		) {
			return input.current;
		}
		if (
			currentProjection &&
			input.frame.sequence <= currentProjection.sequence
		) {
			return input.current;
		}
		return replaceStreamProjection(
			input.current,
			toStreamingProjection({
				createdAtMs: currentProjection?.createdAtMs ?? input.frame.updatedAtMs,
				currentProjection,
				frame: input.frame,
				observedRevision: input.observedRevision,
			})
		);
	}

	if (input.frame.type === "space.agent_stream_part") {
		return applySpaceConversationStreamPartFrame({
			current: input.current,
			currentProjection,
			frame: input.frame,
			observedRevision: input.observedRevision,
		});
	}

	if (
		currentProjection?.status !== undefined &&
		currentProjection.status !== "streaming"
	) {
		return input.current;
	}

	return replaceStreamProjection(
		input.current,
		toTerminalProjection({
			createdAtMs: currentProjection?.createdAtMs ?? input.frame.updatedAtMs,
			frame: input.frame,
			observedRevision: input.observedRevision,
		})
	);
}

function applySpaceConversationStreamPartFrame(input: {
	current: SpaceConversationStreamState;
	currentProjection: SpaceConversationStreamProjection | undefined;
	frame: SpaceAgentStreamPartFrame;
	observedRevision: number;
}): SpaceConversationStreamState {
	if (
		input.currentProjection?.status !== undefined &&
		input.currentProjection.status !== "streaming"
	) {
		return input.current;
	}
	if (
		input.currentProjection &&
		input.frame.sequence <= input.currentProjection.sequence
	) {
		return input.current;
	}
	return replaceStreamProjection(
		input.current,
		toStreamingPartProjection({
			createdAtMs:
				input.currentProjection?.createdAtMs ?? input.frame.updatedAtMs,
			currentProjection: input.currentProjection,
			frame: input.frame,
			observedRevision: input.observedRevision,
		})
	);
}

export function reconcileSpaceConversationStreamSnapshots(input: {
	current: SpaceConversationStreamState;
	presences?: readonly SpaceAgentStreamPresence[];
	requestStartedRevision: number;
	snapshots: readonly SpaceAgentStreamSnapshot[];
}): SpaceConversationStreamState {
	const snapshotIds = new Set(
		[...(input.presences ?? []), ...input.snapshots].map(
			(snapshot) => snapshot.streamId
		)
	);
	let reconciled: SpaceConversationStreamState = input.current.filter(
		(projection) =>
			projection.status !== "streaming" ||
			snapshotIds.has(projection.streamId) ||
			projection.observedRevision > input.requestStartedRevision
	);

	for (const presence of input.presences ?? []) {
		const currentProjection = reconciled.find(
			(projection) => projection.streamId === presence.streamId
		);
		if (
			currentProjection &&
			(currentProjection.status !== "streaming" ||
				!hasMatchingStreamIdentity(currentProjection, presence))
		) {
			continue;
		}
		reconciled = replaceStreamProjection(
			reconciled,
			toPresenceProjection({
				currentProjection,
				observedRevision: input.requestStartedRevision,
				presence,
			})
		);
	}

	for (const snapshot of input.snapshots) {
		const currentProjection = reconciled.find(
			(projection) => projection.streamId === snapshot.streamId
		);
		if (
			currentProjection &&
			(currentProjection.status !== "streaming" ||
				!hasMatchingStreamIdentity(currentProjection, snapshot) ||
				currentProjection.textSequence >= snapshot.sequence)
		) {
			continue;
		}
		reconciled = replaceStreamProjection(
			reconciled,
			toSnapshotProjection({
				currentProjection,
				observedRevision: input.requestStartedRevision,
				snapshot,
			})
		);
	}

	return orderStreamProjections(reconciled);
}

function toPresenceProjection(input: {
	currentProjection: SpaceConversationStreamProjection | undefined;
	observedRevision: number;
	presence: SpaceAgentStreamPresence;
}): SpaceConversationVisibleStreamProjection {
	const currentStreamingProjection =
		input.currentProjection?.status === "streaming"
			? input.currentProjection
			: undefined;
	return {
		createdAtMs: input.presence.createdAtMs,
		dispatchId: input.presence.dispatchId,
		observedRevision: Math.max(
			currentStreamingProjection?.observedRevision ?? 0,
			input.observedRevision
		),
		profileId: input.presence.profileId,
		reasonCode: null,
		sequence: Math.max(
			currentStreamingProjection?.sequence ?? 0,
			input.presence.sequence
		),
		spaceId: input.presence.spaceId,
		status: "streaming",
		streamId: input.presence.streamId,
		text: currentStreamingProjection?.text ?? "",
		textSequence: currentStreamingProjection?.textSequence ?? 0,
		...(currentStreamingProjection?.thinking
			? { thinking: currentStreamingProjection.thinking }
			: {}),
		...(currentStreamingProjection?.toolParts
			? { toolParts: currentStreamingProjection.toolParts }
			: {}),
		triggerMessageId: input.presence.triggerMessageId,
		updatedAtMs: Math.max(
			currentStreamingProjection?.updatedAtMs ?? 0,
			input.presence.updatedAtMs
		),
	};
}

export function listVisibleSpaceConversationStreams(
	state: SpaceConversationStreamState
): readonly SpaceConversationVisibleStreamProjection[] {
	return state.flatMap((projection) =>
		projection.status === "final_message" ? [] : [projection]
	);
}

export function clearSpaceConversationTransientStreams(
	state: SpaceConversationStreamState
): SpaceConversationStreamState {
	return state.map((projection) => {
		if (projection.status !== "streaming") {
			return projection;
		}
		const {
			thinking: _thinking,
			toolParts: _toolParts,
			...persistent
		} = projection;
		return persistent;
	});
}

function toStreamingProjection(input: {
	createdAtMs: number;
	currentProjection: SpaceConversationStreamProjection | undefined;
	frame: SpaceAgentStreamDeltaFrame;
	observedRevision: number;
}): SpaceConversationVisibleStreamProjection {
	const currentStreamingProjection =
		input.currentProjection?.status === "streaming"
			? input.currentProjection
			: undefined;
	const thinking =
		input.frame.kind === "thinking"
			? input.frame.thinkingSnapshot
			: currentStreamingProjection?.thinking;
	return {
		createdAtMs: input.createdAtMs,
		dispatchId: input.frame.dispatchId,
		observedRevision: input.observedRevision,
		profileId: input.frame.profileId,
		reasonCode: null,
		sequence: input.frame.sequence,
		spaceId: input.frame.spaceId,
		status: "streaming",
		streamId: input.frame.streamId,
		text:
			input.frame.kind === "thinking"
				? (currentStreamingProjection?.text ?? "")
				: input.frame.textSnapshot,
		textSequence:
			input.frame.kind === "thinking"
				? (currentStreamingProjection?.textSequence ?? 0)
				: input.frame.sequence,
		...(thinking ? { thinking } : {}),
		triggerMessageId: input.frame.triggerMessageId,
		updatedAtMs: input.frame.updatedAtMs,
		...(input.currentProjection?.toolParts
			? { toolParts: input.currentProjection.toolParts }
			: {}),
	};
}

function toStreamingPartProjection(input: {
	createdAtMs: number;
	currentProjection: SpaceConversationStreamProjection | undefined;
	frame: SpaceAgentStreamPartFrame;
	observedRevision: number;
}): SpaceConversationVisibleStreamProjection {
	const currentToolParts = input.currentProjection?.toolParts ?? [];
	const partIndex = currentToolParts.findIndex(
		(part) => part.toolCallId === input.frame.part.toolCallId
	);
	const existingPart =
		partIndex === -1 ? undefined : currentToolParts[partIndex];
	let visiblePart: AgentStreamToolPart | null =
		input.frame.part.work &&
		isAgentWorkActivityPresentable(input.frame.part.work)
			? input.frame.part
			: null;
	if (!visiblePart && existingPart?.work) {
		visiblePart = { ...input.frame.part, work: existingPart.work };
	}
	const toolParts = [...currentToolParts];
	if (partIndex === -1) {
		if (visiblePart) {
			toolParts.push(visiblePart);
		}
	} else if (visiblePart) {
		toolParts[partIndex] = visiblePart;
	}
	const boundedToolParts = toolParts.slice(-MAX_LIVE_AGENT_WORK_PARTS);
	return {
		createdAtMs: input.createdAtMs,
		dispatchId: input.frame.dispatchId,
		observedRevision: input.observedRevision,
		profileId: input.frame.profileId,
		reasonCode: null,
		sequence: input.frame.sequence,
		spaceId: input.frame.spaceId,
		status: "streaming",
		streamId: input.frame.streamId,
		text:
			input.currentProjection?.status === "streaming"
				? input.currentProjection.text
				: "",
		textSequence:
			input.currentProjection?.status === "streaming"
				? input.currentProjection.textSequence
				: 0,
		...(input.currentProjection?.status === "streaming" &&
		input.currentProjection.thinking
			? { thinking: input.currentProjection.thinking }
			: {}),
		toolParts: boundedToolParts,
		triggerMessageId: input.frame.triggerMessageId,
		updatedAtMs: input.frame.updatedAtMs,
	};
}

function toSnapshotProjection(input: {
	currentProjection: SpaceConversationStreamProjection | undefined;
	observedRevision: number;
	snapshot: SpaceAgentStreamSnapshot;
}): SpaceConversationVisibleStreamProjection {
	return {
		createdAtMs: input.snapshot.createdAtMs,
		dispatchId: input.snapshot.dispatchId,
		observedRevision: Math.max(
			input.currentProjection?.observedRevision ?? 0,
			input.observedRevision
		),
		profileId: input.snapshot.profileId,
		reasonCode: null,
		sequence: Math.max(
			input.currentProjection?.sequence ?? 0,
			input.snapshot.sequence
		),
		spaceId: input.snapshot.spaceId,
		status: "streaming",
		streamId: input.snapshot.streamId,
		text: input.snapshot.textSnapshot,
		textSequence: input.snapshot.sequence,
		...(input.currentProjection?.status === "streaming" &&
		input.currentProjection.thinking
			? { thinking: input.currentProjection.thinking }
			: {}),
		triggerMessageId: input.snapshot.triggerMessageId,
		updatedAtMs: Math.max(
			input.currentProjection?.updatedAtMs ?? 0,
			input.snapshot.updatedAtMs
		),
		...(input.currentProjection?.toolParts
			? { toolParts: input.currentProjection.toolParts }
			: {}),
	};
}

function toTerminalProjection(input: {
	createdAtMs: number;
	frame: SpaceAgentStreamTerminalFrame;
	observedRevision: number;
}): SpaceConversationStreamProjection {
	const common = {
		createdAtMs: input.createdAtMs,
		dispatchId: input.frame.dispatchId,
		observedRevision: input.observedRevision,
		profileId: input.frame.profileId,
		sequence: input.frame.sequence,
		spaceId: input.frame.spaceId,
		streamId: input.frame.streamId,
		triggerMessageId: input.frame.triggerMessageId,
		updatedAtMs: input.frame.updatedAtMs,
	};
	if (input.frame.terminal.kind === "final_message") {
		return {
			...common,
			publishedSignalId: input.frame.terminal.publishedSignalId,
			status: "final_message",
		};
	}
	return {
		...common,
		reasonCode: input.frame.terminal.reasonCode,
		status: input.frame.terminal.kind,
		text: input.frame.terminal.noticeText,
	};
}

function replaceStreamProjection(
	current: SpaceConversationStreamState,
	incoming: SpaceConversationStreamProjection
): SpaceConversationStreamState {
	const byStreamId = new Map(
		current.map((projection) => [projection.streamId, projection] as const)
	);
	byStreamId.set(incoming.streamId, incoming);
	return orderStreamProjections([...byStreamId.values()]);
}

function orderStreamProjections(
	projections: readonly SpaceConversationStreamProjection[]
): SpaceConversationStreamState {
	return [...projections].sort((left, right) => {
		if (left.createdAtMs !== right.createdAtMs) {
			return left.createdAtMs - right.createdAtMs;
		}
		return left.streamId.localeCompare(right.streamId);
	});
}

function hasMatchingStreamIdentity(
	left: Pick<
		SpaceConversationStreamProjection,
		"dispatchId" | "profileId" | "spaceId" | "streamId" | "triggerMessageId"
	>,
	right: Pick<
		| SpaceAgentStreamDeltaFrame
		| SpaceAgentStreamPartFrame
		| SpaceAgentStreamPresence
		| SpaceAgentStreamSnapshot
		| SpaceAgentStreamTerminalFrame,
		"dispatchId" | "profileId" | "spaceId" | "streamId" | "triggerMessageId"
	>
): boolean {
	return (
		left.spaceId === right.spaceId &&
		left.streamId === right.streamId &&
		left.profileId === right.profileId &&
		left.triggerMessageId === right.triggerMessageId &&
		left.dispatchId === right.dispatchId
	);
}
