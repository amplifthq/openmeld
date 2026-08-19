import type { SpaceEphemeralActivityItem } from "#/lib/spaces/dispatch-activity";
import type { SpaceTimelineItem } from "#/lib/spaces/timeline";
import type { SpaceCollaborationProfilePresentation } from "./space-collaboration-profile";

export type SpaceGraphWakeStatus =
	| "awaiting_outcome"
	| "done"
	| "handoff"
	| "needs_input"
	| "posting"
	| "requested"
	| "working"
	| "replied"
	| "failed"
	| "stopped"
	| "silent"
	| "blocked";

export type SpaceGraphMessageNode = {
	actorName: string;
	actorProfileKind: SpaceTimelineItem["actorProfileKind"];
	createdAtMs: number;
	id: `message:${string}`;
	item: SpaceTimelineItem;
	kind: "message";
	profilePresentation: SpaceCollaborationProfilePresentation | null;
	text: string;
};

export type SpaceGraphWakeNode = {
	createdAtMs: number;
	id: `wake:${string}:${string}`;
	kind: "wake";
	label: string;
	profilePresentation: SpaceCollaborationProfilePresentation | null;
	sourceSignalId: string;
	status: SpaceGraphWakeStatus;
	targetProfileId: string;
};

export type SpaceGraphNode = SpaceGraphMessageNode | SpaceGraphWakeNode;

export type SpaceGraphEdge = {
	id: string;
	kind: "reply" | "wake" | "result";
	source: SpaceGraphNode["id"];
	target: SpaceGraphNode["id"];
};

export type SpaceGraphPresentation = {
	edges: readonly SpaceGraphEdge[];
	nodes: readonly SpaceGraphNode[];
};

export function buildSpaceGraphPresentation(input: {
	profileNamesById: ReadonlyMap<string, string>;
	profilePresentationsById?: ReadonlyMap<
		string,
		SpaceCollaborationProfilePresentation
	>;
	timelineItems: readonly SpaceTimelineItem[];
	wakeProgressItems?: readonly SpaceEphemeralActivityItem[];
}): SpaceGraphPresentation {
	const graphMessages = input.timelineItems.filter(isRecordedGraphMessage);
	const wakeKeys = new Set<string>();
	for (const item of graphMessages) {
		for (const targetProfileId of item.wakeTargetProfileIds) {
			wakeKeys.add(buildWakeNodeKey(item.id, targetProfileId));
		}
	}
	const resultsByWakeKey = buildWakeResultsByKey({
		timelineItems: input.timelineItems,
		wakeKeys,
	});
	const progressStatusByWakeKey = buildWakeProgressStatusByKey(
		input.wakeProgressItems ?? []
	);
	const activeResultSignalIds = collectActiveResultSignalIds(resultsByWakeKey);
	const messageItems = graphMessages.filter(
		(item) => !activeResultSignalIds.has(item.id)
	);
	const nodes: SpaceGraphNode[] = messageItems.map((item) =>
		buildMessageNode({
			item,
			profileNamesById: input.profileNamesById,
			profilePresentationsById: input.profilePresentationsById,
		})
	);
	const edges: SpaceGraphEdge[] = [];
	const signalIds = new Set(messageItems.map((item) => item.id));
	const resultSignalIds = new Set<string>();

	for (const item of messageItems) {
		for (const targetProfileId of item.wakeTargetProfileIds) {
			const result = resultsByWakeKey.get(
				buildWakeNodeKey(item.id, targetProfileId)
			);
			const resultItem = result?.item;
			if (
				resultItem &&
				isTerminalWakeResult(result.status) &&
				signalIds.has(resultItem.id)
			) {
				resultSignalIds.add(resultItem.id);
				edges.push({
					id: `result:${item.id}:${targetProfileId}:${resultItem.id}`,
					kind: "result",
					source: buildMessageNodeId(item.id),
					target: buildMessageNodeId(resultItem.id),
				});
				continue;
			}
			const wakeNode: SpaceGraphWakeNode = {
				createdAtMs: item.createdAtMs,
				id: buildWakeNodeId(item.id, targetProfileId),
				kind: "wake",
				label: input.profileNamesById.get(targetProfileId) ?? "Unknown Agent",
				profilePresentation:
					input.profilePresentationsById?.get(targetProfileId) ?? null,
				sourceSignalId: item.id,
				status:
					result?.status ??
					progressStatusByWakeKey.get(
						buildWakeNodeKey(item.id, targetProfileId)
					) ??
					"requested",
				targetProfileId,
			};
			nodes.push(wakeNode);
			edges.push({
				id: `wake:${item.id}:${targetProfileId}`,
				kind: "wake",
				source: buildMessageNodeId(item.id),
				target: wakeNode.id,
			});
		}
	}

	for (const item of messageItems) {
		if (
			!resultSignalIds.has(item.id) &&
			signalIds.has(item.id) &&
			item.replyToSignalId &&
			item.replyToSignalId !== item.id &&
			signalIds.has(item.replyToSignalId)
		) {
			edges.push({
				id: `reply:${item.replyToSignalId}:${item.id}`,
				kind: "reply",
				source: buildMessageNodeId(item.replyToSignalId),
				target: buildMessageNodeId(item.id),
			});
		}
	}

	return { edges, nodes };
}

function collectActiveResultSignalIds(
	resultsByWakeKey: ReadonlyMap<string, SpaceGraphWakeResult>
): ReadonlySet<string> {
	const activeResultSignalIds = new Set<string>();
	for (const result of resultsByWakeKey.values()) {
		if (!isTerminalWakeResult(result.status)) {
			activeResultSignalIds.add(result.item.id);
		}
	}
	return activeResultSignalIds;
}

function buildWakeProgressStatusByKey(
	items: readonly SpaceEphemeralActivityItem[]
): ReadonlyMap<string, SpaceGraphWakeStatus> {
	const statuses = new Map<string, SpaceGraphWakeStatus>();
	for (const item of items) {
		if (!item.sourceSignalId) {
			continue;
		}
		statuses.set(
			buildWakeNodeKey(item.sourceSignalId, item.targetProfileId),
			resolveWakeProgressStatus(item.phase)
		);
	}
	return statuses;
}

function resolveWakeProgressStatus(
	phase: SpaceEphemeralActivityItem["phase"]
): SpaceGraphWakeStatus {
	switch (phase) {
		case "running":
		case "writing":
			return "working";
		case "publishing":
		case "publication_unknown":
			return "posting";
		case "failed":
			return "failed";
		case "stopped":
			return "stopped";
		case "replied":
			return "replied";
		default:
			return "requested";
	}
}

type SpaceGraphWakeResult = {
	item: SpaceTimelineItem;
	status: Exclude<SpaceGraphWakeStatus, "requested">;
};

function buildWakeResultsByKey(input: {
	timelineItems: readonly SpaceTimelineItem[];
	wakeKeys: ReadonlySet<string>;
}): ReadonlyMap<string, SpaceGraphWakeResult> {
	const resultsByWakeKey = new Map<string, SpaceGraphWakeResult>();
	for (const item of input.timelineItems) {
		const targetProfileId = resolveResultTargetProfileId(item);
		const status = resolveWakeResultStatus(item);
		if (!(targetProfileId && status)) {
			continue;
		}
		for (const sourceSignalId of [
			item.wakeSourceSignalId,
			item.replyToSignalId,
		]) {
			if (!sourceSignalId) {
				continue;
			}
			const key = buildWakeNodeKey(sourceSignalId, targetProfileId);
			if (!input.wakeKeys.has(key)) {
				continue;
			}
			const current = resultsByWakeKey.get(key);
			if (
				!(current && isTerminalWakeResult(current.status)) ||
				isTerminalWakeResult(status)
			) {
				resultsByWakeKey.set(key, { item, status });
			}
			break;
		}
	}
	return resultsByWakeKey;
}

function isRecordedGraphMessage(item: SpaceTimelineItem): boolean {
	return (
		item.deliveryState === "sent" &&
		item.agentStreamState === undefined &&
		item.optimisticAgentReplyState === undefined &&
		item.transientActivityPurpose === null
	);
}

function buildMessageNode(input: {
	item: SpaceTimelineItem;
	profileNamesById: ReadonlyMap<string, string>;
	profilePresentationsById?: ReadonlyMap<
		string,
		SpaceCollaborationProfilePresentation
	>;
}): SpaceGraphMessageNode {
	const { item } = input;
	const targetProfileId =
		item.actorProfileKind === "system"
			? item.systemNoticeTargetProfileId
			: null;
	const presentationProfileId = targetProfileId ?? item.actorProfileId;
	const profilePresentation =
		input.profilePresentationsById?.get(presentationProfileId) ?? null;
	return {
		actorName:
			profilePresentation?.profileName ??
			(targetProfileId
				? (input.profileNamesById.get(targetProfileId) ?? "Unknown Agent")
				: item.actorName),
		actorProfileKind:
			profilePresentation?.profileKind ??
			(targetProfileId ? "agent" : item.actorProfileKind),
		createdAtMs: item.createdAtMs,
		id: buildMessageNodeId(item.id),
		item,
		kind: "message",
		profilePresentation,
		text: item.text,
	};
}

function buildMessageNodeId(signalId: string): `message:${string}` {
	return `message:${signalId}`;
}

function buildWakeNodeId(
	sourceSignalId: string,
	targetProfileId: string
): `wake:${string}:${string}` {
	return `wake:${sourceSignalId}:${targetProfileId}`;
}

function buildWakeNodeKey(
	sourceSignalId: string,
	targetProfileId: string
): string {
	return `${sourceSignalId}\u0000${targetProfileId}`;
}

function resolveResultTargetProfileId(item: SpaceTimelineItem): string | null {
	if (item.systemNoticeTargetProfileId) {
		return item.systemNoticeTargetProfileId;
	}
	if (item.actorProfileKind === "agent") {
		return item.actorProfileId;
	}
	return null;
}

function resolveWakeResultStatus(
	item: SpaceTimelineItem
): Exclude<SpaceGraphWakeStatus, "requested"> | null {
	if (item.signalType === "signal.system_notice") {
		switch (item.systemNoticeType) {
			case "terminal_failure":
				return "failed";
			case "wake_stopped":
				return "stopped";
			case "stay_silent":
				return "silent";
			case "policy_blocked":
				return "blocked";
			default:
				return null;
		}
	}

	if (item.agentStreamState) {
		switch (item.agentStreamState.status) {
			case "streaming":
				return "working";
			case "failed":
			case "stopped":
				return "awaiting_outcome";
			case "completed_but_publish_failed":
				return "posting";
			default: {
				const _exhaustive: never = item.agentStreamState.status;
				return _exhaustive;
			}
		}
	}

	if (item.signalType === "signal.status" && item.spaceStatus) {
		switch (item.spaceStatus) {
			case "working":
				return "working";
			case "needs_input":
				return "needs_input";
			case "done":
				return "done";
			case "blocked":
				return "blocked";
			case "handoff":
				return "handoff";
			default: {
				const _exhaustive: never = item.spaceStatus;
				return _exhaustive;
			}
		}
	}

	if (item.actorProfileKind === "agent" && item.signalType === "signal.text") {
		return "replied";
	}

	return null;
}

function isTerminalWakeResult(status: SpaceGraphWakeStatus): boolean {
	return (
		status === "blocked" ||
		status === "done" ||
		status === "failed" ||
		status === "handoff" ||
		status === "replied" ||
		status === "silent" ||
		status === "stopped"
	);
}
