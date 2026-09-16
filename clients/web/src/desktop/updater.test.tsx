import type {
	DesktopUpdaterRestartRequest,
	DesktopUpdaterState,
} from "@openmeld/schemas";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { registerClientVersionRecoveryBlocker } from "#/client-version-recovery";
import {
	clearCenterAgentPendingMessage,
	createPendingCenterAgentMessage,
	readCenterAgentPendingMessage,
	writeCenterAgentPendingMessage,
} from "#/lib/organizations/center-agent-pending-message";
import { DesktopUpdater } from "./updater";

const editingPaused = /Editing is paused/;

const native = vi.hoisted(() => ({
	prepare: undefined as
		| undefined
		| ((request: DesktopUpdaterRestartRequest) => Promise<void>),
	changed: undefined as undefined | ((state: DesktopUpdaterState) => void),
	bridge: {
		updaterState: vi.fn(
			async (): Promise<DesktopUpdaterState> => ({
				status: "downloaded",
				currentVersion: "0.1.1",
				version: "0.1.2",
				percent: 100,
				errorStage: null,
			})
		),
		updaterPrepared: vi.fn(async () => undefined),
		session: vi.fn(() => {
			throw new Error("Cloud admission blocked");
		}),
	},
}));
const router = vi.hoisted(() => ({
	history: { location: { href: "/o/team/spaces/space?thread=thread" } },
	navigate: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({ useRouter: () => router }));
vi.mock("./platform", () => ({
	getDesktopPlatform: () => ({
		...native.bridge,
		onUpdaterChanged: (callback: typeof native.changed) => {
			native.changed = callback;
			return () => undefined;
		},
		onUpdaterPrepare: (callback: typeof native.prepare) => {
			native.prepare = callback;
			return () => undefined;
		},
	}),
}));
afterEach(() => {
	cleanup();
	localStorage.clear();
});
it.each([
	"installing",
	"error",
] as const)("restores the native %s freeze on remount before accepting input", async (status) => {
	const state: DesktopUpdaterState = {
		status,
		currentVersion: "0.1.1",
		version: "0.1.2",
		percent: null,
		errorStage: status === "error" ? "install" : null,
	};
	let resolveSnapshot!: (state: DesktopUpdaterState) => void;
	native.bridge.updaterState.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				resolveSnapshot = resolve;
			})
	);
	render(
		<QueryClientProvider client={new QueryClient()}>
			<DesktopUpdater />
		</QueryClientProvider>
	);
	expect(document.body.inert).toBe(true);
	await act(async () => resolveSnapshot(state));
	expect(document.body.inert).toBe(true);
	act(() =>
		native.changed?.({ ...state, status: "error", errorStage: "install" })
	);
	expect(document.body.inert).toBe(true);
	expect(screen.queryByText("Later")).toBeNull();
	expect(screen.queryByText("Close")).toBeNull();
	expect(screen.getByText(editingPaused)).toBeTruthy();
	const input = document.createElement("input");
	const edited = vi.fn();
	input.addEventListener("input", edited);
	document.body.appendChild(input);
	input.dispatchEvent(new Event("input", { bubbles: true }));
	expect(edited).not.toHaveBeenCalled();
	input.remove();
});
it("freezes editing for preparation, honors existing blockers, and recovers without cloud admission", async () => {
	const queryClient = new QueryClient();
	render(
		<QueryClientProvider client={queryClient}>
			<DesktopUpdater />
		</QueryClientProvider>
	);
	await act(async () => {
		await Promise.resolve();
	});
	const remove = registerClientVersionRecoveryBlocker(() => true);
	await act(async () => {
		await native.prepare?.({
			requestId: "00000000-0000-4000-8000-000000000001",
		});
	});
	expect(native.bridge.updaterPrepared).toHaveBeenLastCalledWith({
		requestId: "00000000-0000-4000-8000-000000000001",
		saved: false,
	});
	expect(document.body.inert).toBe(true);
	const input = document.createElement("input");
	const edited = vi.fn();
	input.addEventListener("input", edited);
	document.body.appendChild(input);
	input.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
	expect(edited).not.toHaveBeenCalled();
	act(() =>
		native.changed?.({
			status: "error",
			currentVersion: "0.1.1",
			version: "0.1.2",
			percent: null,
			errorStage: "restart",
		})
	);
	expect(document.body.inert).toBeFalsy();
	input.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
	expect(edited).toHaveBeenCalledTimes(1);
	input.remove();
	remove();
	const scope = { organizationSlug: "team" };
	const pending = createPendingCenterAgentMessage(
		"Wait for the original acknowledgement"
	);
	writeCenterAgentPendingMessage(queryClient, scope, pending);
	await act(async () => {
		await native.prepare?.({
			requestId: "00000000-0000-4000-8000-000000000003",
		});
	});
	expect(native.bridge.updaterPrepared).toHaveBeenLastCalledWith({
		requestId: "00000000-0000-4000-8000-000000000003",
		saved: false,
	});
	expect(readCenterAgentPendingMessage(queryClient, scope)).toEqual(pending);
	act(() =>
		native.changed?.({
			status: "error",
			currentVersion: "0.1.1",
			version: "0.1.2",
			percent: null,
			errorStage: "restart",
		})
	);
	clearCenterAgentPendingMessage(queryClient, scope);
	await act(async () => {
		await native.prepare?.({
			requestId: "00000000-0000-4000-8000-000000000002",
		});
	});
	expect(native.bridge.updaterPrepared).toHaveBeenLastCalledWith({
		requestId: "00000000-0000-4000-8000-000000000002",
		saved: true,
	});
	expect(native.bridge.session).not.toHaveBeenCalled();
	expect(localStorage.getItem("openmeld.desktop.update-return")).toBe(
		router.history.location.href
	);
});
