import type { RouterHistory } from "@tanstack/react-router";

// The router owns entries and navigation. This projection only bounds the
// controls to workspace entries observed since the current account was admitted.
export function createDesktopNavigation(history: RouterHistory) {
	let account: string | null = null;
	let first = history.location.state.__TSR_index;
	let last = first;
	let snapshot = { back: false, forward: false };
	const listeners = new Set<() => void>();
	const workspace = () => history.location.pathname.startsWith("/o/");
	const publish = () => {
		const index = history.location.state.__TSR_index;
		const back = !!account && workspace() && index > first && index <= last;
		const forward = !!account && workspace() && index >= first && index < last;
		if (back !== snapshot.back || forward !== snapshot.forward) {
			snapshot = { back, forward };
			for (const listener of listeners) {
				listener();
			}
		}
	};
	const reset = (next: string | null = null) => {
		account = next;
		first = history.location.state.__TSR_index;
		last = first;
		publish();
	};
	return {
		reset,
		identify(next: string | null) {
			if (next !== account) {
				reset(next);
			}
		},
		connect: () =>
			history.subscribe(({ action, location }) => {
				const index = location.state.__TSR_index;
				if (!(workspace() && account)) {
					reset();
				} else if (action.type === "PUSH") {
					last = index;
					publish();
				} else {
					publish();
				}
			}),
		getSnapshot: () => snapshot,
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		back() {
			if (snapshot.back) {
				history.back();
			}
		},
		forward() {
			if (snapshot.forward) {
				history.forward();
			}
		},
	};
}
