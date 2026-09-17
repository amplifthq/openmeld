import type {
	ListSpaceThreadsResponse,
	WakeProgressItem,
} from "@openmeld/schemas/types";
import { resolveWakeReplyThreadRoot } from "./active-wake-conversation";

export type SpaceMessageTarget = {
	focusSignalId?: string;
	focusThreadRootSignalId?: string;
};

/** Resolve placement from the owning Space catalog, never from message text. */
export function resolveSpaceThreadTarget(
	catalog: ListSpaceThreadsResponse | undefined,
	target: SpaceMessageTarget
) {
	if (target.focusThreadRootSignalId) {
		return catalog?.threads.find(
			(thread) => thread.rootSignalId === target.focusThreadRootSignalId
		);
	}
	if (!target.focusSignalId) {
		return undefined;
	}
	const preview = catalog?.previews.find((item) =>
		item.placements.some(
			(placement) =>
				placement.signalId === target.focusSignalId &&
				placement.placement === "thread"
		)
	);
	return catalog?.threads.find(
		(thread) => thread.threadId === preview?.threadId
	);
}

export function buildSpaceMessageFocusHref(
	url: string,
	signalId?: string | null
) {
	if (!signalId) {
		return url;
	}
	const target = new URL(url, "https://openmeld.invalid");
	target.searchParams.set("focusSignalId", signalId);
	target.searchParams.delete("focusThreadRootSignalId");
	target.searchParams.delete("focusInteractionId");
	target.searchParams.delete("view");
	return `${target.pathname}${target.search}${target.hash}`;
}

export function buildSpaceActivityFocusHref(input: {
	url: string;
	progress: WakeProgressItem;
	threads: ListSpaceThreadsResponse;
	agentStreams: NonNullable<
		Parameters<typeof resolveWakeReplyThreadRoot>[0]["agentStreams"]
	>;
}) {
	const placement = resolveWakeReplyThreadRoot(input);
	const rootSignalId =
		placement === undefined
			? input.threads.threads.find(
					(thread) => thread.threadId === input.progress.sourceContext?.threadId
				)?.rootSignalId
			: placement;
	const sourceThread = input.threads.threads.find(
		(thread) => thread.threadId === input.progress.sourceContext?.threadId
	);
	const href = buildSpaceMessageFocusHref(
		input.url,
		placement === null && sourceThread
			? sourceThread.rootSignalId
			: input.progress.sourceSignalId
	);
	if (!rootSignalId) {
		return href;
	}
	const target = new URL(href, "https://openmeld.invalid");
	target.searchParams.set("focusThreadRootSignalId", rootSignalId);
	return `${target.pathname}${target.search}${target.hash}`;
}
