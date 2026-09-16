import type { DesktopUpdaterState } from "@openmeld/schemas";
import { Button } from "@openmeld/ui/components/button";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useLayoutEffect, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import {
	hasClientRestartBlocker,
	registerClientVersionRecoveryBlocker,
} from "#/client-version-recovery";
import { hasPendingCenterAgentMessages } from "#/lib/organizations/center-agent-pending-message";
import { desktopUpdaterPresentation } from "../../../desktop/src/shared/updater-presentation";
import { getDesktopPlatform } from "./platform";

let snapshot: DesktopUpdaterState | null = null;
const listeners = new Set<() => void>();
function publish(value: DesktopUpdaterState) {
	snapshot = value;
	for (const listener of listeners) {
		listener();
	}
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
		() => snapshot,
		() => null
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
	const [dismissed, setDismissed] = useState<string | null>(null);
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
		const unsubscribe = bridge.onUpdaterChanged((next) => {
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
			.catch(console.error);
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
		};
	}, [router, queryClient]);
	const noticeKey = state ? `${state.status}:${state.version}` : null;
	if (
		!state ||
		dismissed === noticeKey ||
		!(
			state.status === "available" ||
			state.status === "downloaded" ||
			state.status === "downloading" ||
			state.status === "preparing" ||
			state.status === "installing" ||
			(state.status === "error" && state.errorStage !== "check")
		)
	) {
		return null;
	}
	return (
		<aside
			aria-label="Desktop update"
			className="fixed right-4 bottom-4 z-50 max-w-sm rounded-lg border bg-background p-4 shadow-sm"
		>
			<DesktopUpdatesSection />
			{state.status !== "preparing" &&
			state.status !== "installing" &&
			state.errorStage !== "install" ? (
				<Button
					onClick={() => setDismissed(noticeKey)}
					size="sm"
					variant="ghost"
				>
					Later
				</Button>
			) : null}
		</aside>
	);
}

export function DesktopUpdatesSection() {
	const state = useDesktopUpdater();
	if (!(getDesktopPlatform() && state)) {
		return null;
	}
	const { message, action, label } = desktopUpdaterPresentation(state);
	return (
		<section aria-label="Updates" className="space-y-3">
			<h2 className="font-medium">Updates</h2>
			<output className="block text-muted-foreground text-sm">{message}</output>
			{action ? (
				<Button
					onClick={() => {
						if (action) {
							getDesktopPlatform()?.updaterAction(action).catch(console.error);
						}
					}}
					size="sm"
					variant="outline"
				>
					{label}
				</Button>
			) : null}
		</section>
	);
}
