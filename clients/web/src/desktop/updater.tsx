import type {
	DesktopUpdaterAction,
	DesktopUpdaterState,
} from "@openmeld/schemas";
import { Surface } from "@openmeld/ui/fluid/surface";
import { cn } from "@openmeld/ui/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import {
	hasClientRestartBlocker,
	registerClientVersionRecoveryBlocker,
} from "#/client-version-recovery";
import { hasPendingCenterAgentMessages } from "#/lib/organizations/center-agent-pending-message";
import { desktopUpdaterPresentation } from "../../../desktop/src/shared/updater-presentation";
import { getDesktopPlatform } from "./platform";
import { DesktopUpdaterView } from "./updater-view";

let snapshot: DesktopUpdaterState | null = null;
let initialReadFailed = false;
const listeners = new Set<() => void>();
function notify() {
	for (const listener of listeners) {
		listener();
	}
}
function publish(value: DesktopUpdaterState | null) {
	snapshot = value;
	initialReadFailed = false;
	notify();
}
const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};
export function useDesktopUpdater() {
	return useSyncExternalStore(
		subscribe,
		() => (getDesktopPlatform() ? snapshot : null),
		() => null
	);
}
export const DESKTOP_UPDATE_ATTENTION_LABEL = "Desktop update pending";

// Visibility is presentation state, not acknowledgement. Tokens make cleanup
// safe for multiple hosts and Strict Mode's setup/cleanup/setup cycle.
const settingsViews = new Set<symbol>();
function useUpdatesSettingsVisible() {
	return useSyncExternalStore(
		subscribe,
		() => settingsViews.size > 0,
		() => false
	);
}
function useInitialReadFailed() {
	return useSyncExternalStore(
		subscribe,
		() => initialReadFailed,
		() => false
	);
}

export function useDesktopUpdateAttention() {
	return desktopUpdaterPresentation(useDesktopUpdater()).attention;
}

export function DesktopUpdateIndicator(input: { className?: string }) {
	return (
		<span
			aria-hidden="true"
			className={cn(
				"size-1.5 shrink-0 rounded-full bg-unread",
				input.className
			)}
			data-slot="desktop-update-indicator"
		/>
	);
}

const restartPathKey = "openmeld.desktop.update-return";
const editingEvents = [
	"beforeinput",
	"input",
	"change",
	"click",
	"keydown",
	"keyup",
	"paste",
	"drop",
	"compositionstart",
	"compositionend",
	"submit",
] as const;

export function DesktopUpdater() {
	const router = useRouter();
	const queryClient = useQueryClient();
	const state = useDesktopUpdater();
	const settingsVisible = useUpdatesSettingsVisible();
	const readFailed = useInitialReadFailed();
	const [dismissed, setDismissed] = useState<ReadonlySet<string>>(
		() => new Set()
	);
	useLayoutEffect(() => {
		const bridge = getDesktopPlatform();
		if (!bridge) {
			return;
		}
		const removePendingBlocker = registerClientVersionRecoveryBlocker(() =>
			hasPendingCenterAgentMessages(queryClient)
		);
		let revision = 0;
		let disposed = false;
		let restoreEditing: (() => void) | undefined;
		const freezeEditing = () => {
			if (restoreEditing) {
				return;
			}
			const previousInert = document.body.inert;
			// Also stop queued input (including an already open file chooser) before
			// React handlers can change drafts after the final save.
			const stopInput = (event: Event) => {
				event.preventDefault();
				event.stopImmediatePropagation();
			};
			for (const event of editingEvents) {
				window.addEventListener(event, stopInput, true);
			}
			document.body.inert = true;
			restoreEditing = () => {
				for (const event of editingEvents) {
					window.removeEventListener(event, stopInput, true);
				}
				document.body.inert = previousInert;
			};
		};
		const acceptSnapshot = (next: DesktopUpdaterState) => {
			if (
				next.status === "preparing" ||
				next.status === "installing" ||
				next.errorStage === "install"
			) {
				freezeEditing();
			} else {
				restoreEditing?.();
				restoreEditing = undefined;
			}
			publish(next);
		};
		// Freeze a newly mounted renderer until the native authority answers.
		// A reload must never create an editable window during an accepted install.
		freezeEditing();
		publish(null);
		const unsubscribe = bridge.onUpdaterChanged((next) => {
			if (disposed) {
				return;
			}
			revision++;
			acceptSnapshot(next);
		});
		bridge
			.updaterState()
			.then((next) => {
				if (!disposed && revision === 0) {
					acceptSnapshot(next);
				}
			})
			.catch((error) => {
				console.error("Could not read Desktop update status.", error);
				if (!disposed && revision === 0) {
					initialReadFailed = true;
					notify();
				}
			});
		const prepare = bridge.onUpdaterPrepare(async ({ requestId }) => {
			freezeEditing();
			let saved = false;
			try {
				flushSync(() => {
					/* Commit pending input before reading draft owners. */
				});
				if (!hasClientRestartBlocker()) {
					// Save only a normal app route. Authorization remains with the router.
					const href = router.history.location.href;
					if (href.startsWith("/o/")) {
						localStorage.setItem(restartPathKey, href);
					}
					saved = !hasClientRestartBlocker();
				}
			} catch (error) {
				console.error("Could not save before updating Desktop.", error);
			}
			await bridge.updaterPrepared({ requestId, saved });
		});
		Promise.resolve()
			.then(async () => {
				const stored = localStorage.getItem(restartPathKey);
				if (!stored || disposed) {
					return;
				}
				localStorage.removeItem(restartPathKey);
				if (stored.startsWith("/o/")) {
					await router.navigate({ to: stored, replace: true });
				}
			})
			.catch(console.error);
		return () => {
			removePendingBlocker();
			disposed = true;
			unsubscribe();
			prepare();
			restoreEditing?.();
			publish(null);
		};
	}, [router, queryClient]);
	const view = desktopUpdaterPresentation(state);
	const required = view.notice === "required" || readFailed;
	const noticeKey = view.noticeKey;
	if (
		!getDesktopPlatform() ||
		(!required &&
			(view.notice === "none" ||
				settingsVisible ||
				(noticeKey !== null && dismissed.has(noticeKey))))
	) {
		return null;
	}
	return (
		<aside
			aria-label="Desktop update"
			className="fixed right-4 bottom-4 z-50 w-80 max-w-[calc(100vw-2rem)]"
		>
			<Surface className="p-4">
				<DesktopUpdatesSection
					onDismiss={
						!required && noticeKey
							? () =>
									setDismissed((previous) => new Set([...previous, noticeKey]))
							: undefined
					}
				/>
			</Surface>
		</aside>
	);
}

export function DesktopUpdatesSection(input: {
	presentation?: "notice" | "settings";
	onDismiss?: () => void;
}) {
	const state = useDesktopUpdater();
	const readFailed = useInitialReadFailed();
	const [pending, setPending] = useState(false);
	const pendingRef = useRef(false);
	const [failure, setFailure] = useState<{
		state: DesktopUpdaterState | null;
		message: string;
	} | null>(null);
	const desktop = getDesktopPlatform() !== null;
	useLayoutEffect(() => {
		if (!desktop || input.presentation !== "settings") {
			return;
		}
		const token = Symbol("Desktop Updates view");
		settingsViews.add(token);
		notify();
		return () => {
			settingsViews.delete(token);
			notify();
		};
	}, [desktop, input.presentation]);
	if (!desktop) {
		return null;
	}
	const requestAction = async (action: DesktopUpdaterAction) => {
		const bridge = getDesktopPlatform();
		if (
			!bridge ||
			pendingRef.current ||
			desktopUpdaterPresentation(snapshot).action !== action
		) {
			return;
		}
		pendingRef.current = true;
		setPending(true);
		setFailure(null);
		try {
			await bridge.updaterAction(action);
		} catch (error) {
			console.error(`Could not confirm Desktop ${action} request.`, error);
			setFailure({
				state,
				message: `Couldn't confirm the ${action} request. Check the update status and try again.`,
			});
		} finally {
			pendingRef.current = false;
			setPending(false);
		}
	};
	return (
		<DesktopUpdaterView
			actionError={failure?.state === state ? failure.message : null}
			onAction={requestAction}
			onDismiss={input.onDismiss}
			pending={pending}
			presentation={input.presentation ?? "notice"}
			readError={readFailed}
			state={state}
		/>
	);
}
