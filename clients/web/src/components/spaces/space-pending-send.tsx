import { useSyncExternalStore } from "react";

type FailedSend = { message: string; retry: () => Promise<void> };
const LOCAL_SIGNAL_PREFIX = /^(pending|failed):/;
const failures = new Map<string, FailedSend>();
const pending = new Map<string, () => void>();
function protectUnsentMessages(event: BeforeUnloadEvent) {
	if (!pending.size) {
		return;
	}
	event.preventDefault();
	event.returnValue = "";
}
export function markSpaceSendPending(
	clientMessageId: string,
	onConfirmed: () => void
) {
	pending.set(clientMessageId, onConfirmed);
	window.addEventListener("beforeunload", protectUnsentMessages);
}
export function completeSpaceSend(clientMessageId: string) {
	const onConfirmed = pending.get(clientMessageId);
	pending.delete(clientMessageId);
	onConfirmed?.();
	setSpaceSendFailure(clientMessageId, null);
	if (!pending.size) {
		window.removeEventListener("beforeunload", protectUnsentMessages);
	}
}
const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}
export function setSpaceSendFailure(
	clientMessageId: string,
	failure: FailedSend | null
) {
	if (failure) {
		failures.set(clientMessageId, failure);
	} else {
		failures.delete(clientMessageId);
	}
	for (const listener of listeners) {
		listener();
	}
}
export function useSpaceSendFailure(signalId?: string) {
	const clientMessageId = signalId?.replace(LOCAL_SIGNAL_PREFIX, "");
	return useSyncExternalStore(
		subscribe,
		() => (clientMessageId ? failures.get(clientMessageId) : undefined),
		() => undefined
	);
}
export function SpacePendingSendFeedback({
	signalId,
	align,
}: {
	signalId?: string;
	align?: "start" | "end";
}) {
	const clientMessageId = signalId?.replace(LOCAL_SIGNAL_PREFIX, "");
	const failure = useSpaceSendFailure(signalId);
	if (!failure) {
		return null;
	}
	return (
		<output
			className={`flex w-full items-center gap-2 text-destructive text-xs ${align === "end" ? "justify-end" : "justify-start"}`}
		>
			<span>{failure.message}</span>
			<button
				className="shrink-0 underline"
				onClick={() => {
					if (clientMessageId) {
						setSpaceSendFailure(clientMessageId, null);
					}
					failure.retry().catch(console.error);
				}}
				type="button"
			>
				Retry
			</button>
		</output>
	);
}
