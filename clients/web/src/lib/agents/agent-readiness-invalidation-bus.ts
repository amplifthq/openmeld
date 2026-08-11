import type { SpaceLiveInvalidationFrame } from "@openmeld/schemas/types";

const AGENT_READINESS_INVALIDATION_CHANNEL =
	"openmeld.agent-readiness-invalidation";
const AGENT_READINESS_INVALIDATION_WINDOW_EVENT =
	"openmeld:agent-readiness-invalidated";

export type AgentReadinessInvalidationMessage = {
	agentProfileIds: readonly string[];
	reason: string | null;
	spaceId: string;
	version: number;
};

export function publishAgentReadinessInvalidationFrame(
	frame: SpaceLiveInvalidationFrame
): void {
	if (frame.type !== "agent.readiness.invalidated") {
		return;
	}
	const message = normalizeAgentReadinessInvalidationMessage({
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
	onMessage: (message: AgentReadinessInvalidationMessage) => void
): () => void {
	const channel = createAgentReadinessInvalidationChannel();
	if (channel) {
		const handleMessage = (event: MessageEvent<unknown>) => {
			const message = normalizeAgentReadinessInvalidationMessage(event.data);
			if (message) {
				onMessage(message);
			}
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
		if (message) {
			onMessage(message);
		}
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
	if (!spaceId) {
		return null;
	}
	const agentProfileIds = normalizeAgentProfileIds(candidate.agentProfileIds);
	if (agentProfileIds.length === 0) {
		return null;
	}
	return {
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
