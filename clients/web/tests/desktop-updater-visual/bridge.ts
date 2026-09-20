import type {
	DesktopUpdaterAction,
	DesktopUpdaterState,
} from "@openmeld/schemas";
import type { DesktopPilotBridge } from "../../../desktop/src/shared/pilot-bridge";

type UpdaterBridge = Pick<
	DesktopPilotBridge,
	| "updaterState"
	| "updaterAction"
	| "updaterPrepared"
	| "onUpdaterChanged"
	| "onUpdaterPrepare"
>;
const parameters = new URLSearchParams(location.search);
const base: DesktopUpdaterState = {
	status: "idle",
	currentVersion: "0.1.2",
	version: null,
	percent: null,
	errorStage: null,
};
const update = { ...base, version: "0.1.3" };
export const cases: Record<string, DesktopUpdaterState | null> = {
	unknown: null,
	idle: base,
	checking: { ...update, status: "checking" },
	current: { ...base, status: "current" },
	available: { ...update, status: "available" },
	downloading: { ...update, status: "downloading", percent: 42.4 },
	indeterminate: { ...update, status: "downloading" },
	verifying: { ...update, status: "downloading", percent: 100 },
	downloaded: { ...update, status: "downloaded", percent: 100 },
	preparing: { ...update, status: "preparing" },
	installing: { ...update, status: "installing" },
	unavailable: { ...base, status: "unavailable" },
	"check-error": { ...base, status: "error", errorStage: "check" },
	"unknown-error": { ...base, status: "error" },
	"download-error": { ...update, status: "error", errorStage: "download" },
	"restart-error": { ...update, status: "error", errorStage: "restart" },
	"install-error": { ...update, status: "error", errorStage: "install" },
};
let current = cases[parameters.get("state") ?? "available"];
if (current === undefined) {
	throw new Error("Unknown synthetic updater case.");
}
const subscribers = new Set<(state: DesktopUpdaterState) => void>();
export const actions: DesktopUpdaterAction[] = [];
export function emit(state: DesktopUpdaterState) {
	current = state;
	for (const subscriber of subscribers) {
		subscriber(state);
	}
}
const bridge: UpdaterBridge = {
	updaterState: () => {
		if (parameters.has("read-error")) {
			return Promise.reject(new Error("Synthetic initial read failure"));
		}
		return current ? Promise.resolve(current) : new Promise(() => undefined);
	},
	updaterAction: (action) => {
		actions.push(action);
		if (parameters.has("hold")) {
			return new Promise<void>(() => undefined);
		}
		if (parameters.has("reject")) {
			return Promise.reject(new Error("Synthetic IPC rejection"));
		}
		// Promise completion deliberately does not claim a native transition.
		return Promise.resolve();
	},
	updaterPrepared: () => Promise.resolve(),
	onUpdaterChanged: (handler) => {
		subscribers.add(handler);
		return () => subscribers.delete(handler);
	},
	onUpdaterPrepare: () => () => undefined,
};

export function getDesktopPlatform() {
	return parameters.has("web") ? null : bridge;
}

// Other Desktop capabilities are deliberately unavailable in this fixture.
export function canConfigureLocalComputer() {
	return false;
}
export function openDesktopWeb(): Promise<void> {
	return Promise.reject(
		new Error("External navigation is outside this updater fixture.")
	);
}
