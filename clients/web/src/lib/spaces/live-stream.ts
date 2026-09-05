import { incomingServerMessageSchema } from "@openmeld/schemas";
import type {
	IncomingServerMessage,
	SignalEnvelope,
	SpaceAgentStreamDeltaFrame,
	SpaceAgentStreamPartFrame,
	SpaceAgentStreamTerminalFrame,
	SpaceLiveInvalidationFrame,
	SpaceLiveSignalFrame,
	SpaceThreadContext,
	SpaceThreadSignalPlacement,
} from "@openmeld/schemas/types";

export type SpaceLiveMessage =
	| {
			kind: "ready";
	  }
	| {
			kind: "agent_stream";
			frame:
				| SpaceAgentStreamDeltaFrame
				| SpaceAgentStreamPartFrame
				| SpaceAgentStreamTerminalFrame;
	  }
	| {
			kind: "signal";
			history: SpaceLiveSignalFrame["history"] | null;
			signal: SignalEnvelope;
			threadContext: SpaceThreadContext | null;
			threadPlacement: SpaceThreadSignalPlacement | null;
	  }
	| {
			kind: "server_error";
			error: Extract<IncomingServerMessage, { error: string }>;
	  }
	| {
			kind: "invalidation";
			frame: SpaceLiveInvalidationFrame;
	  }
	| {
			kind: "ignored";
	  };

export function createSpaceLiveStreamUrl(input: {
	origin: string;
	spaceId: string;
	profileId: string;
}): string {
	const originUrl = new URL(input.origin);
	originUrl.protocol = originUrl.protocol === "https:" ? "wss:" : "ws:";
	originUrl.pathname = `/v1/spaces/${encodeURIComponent(input.spaceId)}/stream`;
	originUrl.search = "";
	originUrl.searchParams.set("profileId", input.profileId);
	originUrl.hash = "";
	return originUrl.toString();
}

export function parseSpaceLiveMessage(rawMessage: string): SpaceLiveMessage {
	let parsedJson: unknown;
	try {
		parsedJson = JSON.parse(rawMessage);
	} catch {
		return {
			kind: "ignored",
		};
	}

	const parsed = incomingServerMessageSchema.safeParse(parsedJson);
	if (!parsed.success) {
		return {
			kind: "ignored",
		};
	}

	if ("type" in parsed.data && parsed.data.type === "system.hello.ack") {
		return {
			kind: "ready",
		};
	}
	if (isSpaceLiveInvalidationFrame(parsed.data)) {
		return {
			kind: "invalidation",
			frame: parsed.data,
		};
	}
	if (isSpaceAgentStreamFrame(parsed.data)) {
		return {
			kind: "agent_stream",
			frame: parsed.data,
		};
	}
	if (isSpaceLiveSignalFrame(parsed.data)) {
		return {
			kind: "signal",
			history: parsed.data.history ?? null,
			signal: parsed.data.signal,
			threadContext: parsed.data.threadContext ?? null,
			threadPlacement: parsed.data.threadPlacement ?? null,
		};
	}

	if ("error" in parsed.data) {
		return {
			kind: "server_error",
			error: parsed.data,
		};
	}

	return {
		kind: "signal",
		history: null,
		signal: parsed.data,
		threadContext: null,
		threadPlacement: null,
	};
}

function isSpaceAgentStreamFrame(
	message: IncomingServerMessage
): message is
	| SpaceAgentStreamDeltaFrame
	| SpaceAgentStreamPartFrame
	| SpaceAgentStreamTerminalFrame {
	return (
		"type" in message &&
		(message.type === "space.agent_stream_delta" ||
			message.type === "space.agent_stream_part" ||
			message.type === "space.agent_stream_terminal")
	);
}

function isSpaceLiveSignalFrame(
	message: IncomingServerMessage
): message is SpaceLiveSignalFrame {
	return "type" in message && message.type === "space.signal";
}

function isSpaceLiveInvalidationFrame(
	message: IncomingServerMessage
): message is SpaceLiveInvalidationFrame {
	return (
		"type" in message &&
		(message.type === "space.members.changed" ||
			message.type === "space.meta.changed" ||
			message.type === "space.files.changed" ||
			message.type === "agent.readiness.invalidated" ||
			message.type === "wake.progress.changed")
	);
}
