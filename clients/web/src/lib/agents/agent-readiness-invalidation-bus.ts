import type { SpaceLiveInvalidationFrame } from "@openmeld/schemas/types";

const AGENT_READINESS_INVALIDATION_CHANNEL =
	"openmeld.agent-readiness-invalidation";
const AGENT_READINESS_INVALIDATION_WINDOW_EVENT =
	"openmeld:agent-readiness-invalidated";

export type AgentReadinessInvalidationMessage = {
	storageScope: string;
	organizationId: string;
	agentProfileIds: readonly string[];
	reason: string | null;
	spaceId: string;
	version: number;
};

export function publishAgentReadinessInvalidationFrame(
	frame: SpaceLiveInvalidationFrame,
	scope: { storageScope: string; organizationId: string }
): void {
	if (frame.type !== "agent.readiness.invalidated") {
		return;
	}
	const message = normalizeAgentReadinessInvalidationMessage({
		...scope,
		agentProfileIds: frame.agentProfileIds ?? [],
		reason: frame.reason ?? null,
		spaceId: frame.spaceId,
		version: frame.version,
	});
	if (!message) {
		return;
	}
	const channel = createAgentReadinessInvalidationChannel();
	if (channel) {
		channel.postMessage(message);
		channel.close();
		return;
	}
	window.dispatchEvent(
		new CustomEvent(AGENT_READINESS_INVALIDATION_WINDOW_EVENT, {
			detail: message,
		})
	);
}

export function subscribeAgentReadinessInvalidations(
	onMessage: (message: AgentReadinessInvalidationMessage) => void,
	scope: { storageScope: string; organizationId: string }
): () => void {
	const versions = new Map<string, number>();
	const deliver = (message: AgentReadinessInvalidationMessage | null) => {
		if (
			!message ||
			message.storageScope !== scope.storageScope ||
			message.organizationId !== scope.organizationId
		) {
			return;
		}
		if (message.version <= (versions.get(message.spaceId) ?? -1)) {
			return;
		}
		versions.set(message.spaceId, message.version);
		onMessage(message);
	};
	const channel = createAgentReadinessInvalidationChannel();
	if (channel) {
		const handleMessage = (event: MessageEvent<unknown>) => {
			const message = normalizeAgentReadinessInvalidationMessage(event.data);
			deliver(message);
		};
		channel.addEventListener("message", handleMessage);
		return () => {
			channel.removeEventListener("message", handleMessage);
			channel.close();
		};
	}

	const handleWindowMessage = (event: Event) => {
		const message = normalizeAgentReadinessInvalidationMessage(
			(event as CustomEvent<unknown>).detail
		);
		deliver(message);
	};
	window.addEventListener(
		AGENT_READINESS_INVALIDATION_WINDOW_EVENT,
		handleWindowMessage
	);
	return () => {
		window.removeEventListener(
			AGENT_READINESS_INVALIDATION_WINDOW_EVENT,
			handleWindowMessage
		);
	};
}

function createAgentReadinessInvalidationChannel(): BroadcastChannel | null {
	if (typeof BroadcastChannel === "undefined") {
		return null;
	}
	return new BroadcastChannel(AGENT_READINESS_INVALIDATION_CHANNEL);
}

function normalizeAgentReadinessInvalidationMessage(
	value: unknown
): AgentReadinessInvalidationMessage | null {
	if (!value || typeof value !== "object") {
		return null;
	}
	const candidate = value as Partial<AgentReadinessInvalidationMessage>;
	const spaceId = normalizeText(candidate.spaceId);
	const storageScope = normalizeText(candidate.storageScope);
	const organizationId = normalizeText(candidate.organizationId);
	if (!(spaceId && storageScope && organizationId)) {
		return null;
	}
	const agentProfileIds = normalizeAgentProfileIds(candidate.agentProfileIds);
	if (agentProfileIds.length === 0) {
		return null;
	}
	return {
		storageScope,
		organizationId,
		agentProfileIds,
		reason: normalizeText(candidate.reason) ?? null,
		spaceId,
		version:
			typeof candidate.version === "number" &&
			Number.isFinite(candidate.version)
				? candidate.version
				: 0,
	};
}

function normalizeAgentProfileIds(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const ids = new Set<string>();
	for (const item of value) {
		const normalized = normalizeText(item);
		if (normalized) {
			ids.add(normalized);
		}
	}
	return [...ids];
}

function normalizeText(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}
