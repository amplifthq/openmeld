import type {
	DesktopUpdaterAction,
	DesktopUpdaterRestartRequest,
	DesktopUpdaterState,
} from "@openmeld/schemas";
import { DropdownMenu } from "@openmeld/ui/components/dropdown-menu";
import { FluidDropdownMenuContent } from "@openmeld/ui/fluid/dropdown-menu";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { type ComponentProps, StrictMode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { registerClientVersionRecoveryBlocker } from "#/client-version-recovery";
import { AppSettingsMenuItem } from "#/components/app/app-settings-menu-item";

import { SettingsInnerSidebar } from "#/components/settings/settings-page";
import {
	clearCenterAgentPendingMessage,
	createPendingCenterAgentMessage,
	readCenterAgentPendingMessage,
	writeCenterAgentPendingMessage,
} from "#/lib/organizations/center-agent-pending-message";
import { DesktopUpdater, DesktopUpdatesSection } from "./updater";

function TestSettingsEntry({ onClick }: { onClick: () => void }) {
	return (
		<DropdownMenu open>
			<FluidDropdownMenuContent>
				<AppSettingsMenuItem closeOnClick={false} index={0} onClick={onClick} />
			</FluidDropdownMenuContent>
		</DropdownMenu>
	);
}

const editingPaused = /Editing is paused/;

const native = vi.hoisted(() => ({
	enabled: true,
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
		updaterAction: vi.fn<(action: DesktopUpdaterAction) => Promise<void>>(
			async () => undefined
		),
		session: vi.fn(() => {
			throw new Error("Cloud admission blocked");
		}),
	},
}));
const router = vi.hoisted(() => ({
	history: { location: { href: "/o/team/spaces/space?thread=thread" } },
	navigate: vi.fn(),
}));
vi.mock("@tanstack/react-router", async () => ({
	...(await vi.importActual<typeof import("@tanstack/react-router")>(
		"@tanstack/react-router"
	)),
	useRouter: () => router,
	Link: ({
		to,
		children,
		activeOptions: _active,
		...props
	}: ComponentProps<"a"> & { to: string; activeOptions?: unknown }) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
}));
vi.mock("./platform", () => ({
	getDesktopPlatform: () =>
		native.enabled
			? {
					...native.bridge,
					onUpdaterChanged: (callback: typeof native.changed) => {
						native.changed = callback;
						return () => undefined;
					},
					onUpdaterPrepare: (callback: typeof native.prepare) => {
						native.prepare = callback;
						return () => undefined;
					},
				}
			: null,
}));
afterEach(() => {
	cleanup();
	localStorage.clear();
	native.enabled = true;
	vi.clearAllMocks();
	vi.restoreAllMocks();
});

function updateState(
	patch: Partial<DesktopUpdaterState> = {}
): DesktopUpdaterState {
	return {
		status: "available",
		currentVersion: "0.1.1",
		version: "0.1.2",
		percent: null,
		errorStage: null,
		...patch,
	};
}

it("lets the user cancel while the download action is still pending", async () => {
	native.bridge.updaterState.mockResolvedValueOnce(
		updateState({ canCancelDownload: true })
	);
	let finishDownload: (() => void) | undefined;
	native.bridge.updaterAction.mockImplementationOnce(
		() =>
			new Promise<void>((resolve) => {
				finishDownload = resolve;
			})
	);
	render(
		<QueryClientProvider client={new QueryClient()}>
			<DesktopUpdater />
			<DesktopUpdatesSection presentation="settings" />
		</QueryClientProvider>
	);
	fireEvent.click(
		await screen.findByRole("button", { name: "Download update" })
	);
	act(() =>
		native.changed?.(
			updateState({
				canCancelDownload: true,
				status: "downloading",
				percent: 27,
			})
		)
	);
	const cancel = await screen.findByRole("button", { name: "Cancel download" });
	expect(cancel.hasAttribute("disabled")).toBe(false);
	fireEvent.click(cancel);
	expect(native.bridge.updaterAction).toHaveBeenCalledWith("cancel");
	await act(() => {
		finishDownload?.();
	});
});

it("keeps the installed version separate from the changing update status", async () => {
	const currentState: DesktopUpdaterState = {
		status: "current",
		currentVersion: "0.1.1",
		version: null,
		percent: null,
		errorStage: null,
	};
	native.bridge.updaterState.mockResolvedValueOnce(currentState);
	render(
		<QueryClientProvider client={new QueryClient()}>
			<DesktopUpdater />
			<DesktopUpdatesSection presentation="settings" />
		</QueryClientProvider>
	);

	const heading = await screen.findByRole("heading", {
		level: 1,
		name: "Updates",
	});
	const settings = heading.closest("section");
	if (!settings) {
		throw new Error("Expected the Desktop Updates settings section.");
	}
	await within(settings).findByRole("heading", { name: "You're up to date" });
	expect(
		within(settings).getByText("OpenMeld Desktop · Version 0.1.1")
	).toBeTruthy();
	expect(within(settings).getByText("No updates are available.")).toBeTruthy();
	expect(
		within(settings).getByRole("button", { name: "Check for updates" })
	).toBeTruthy();

	expect(native.bridge.updaterAction).not.toHaveBeenCalled();
	act(() =>
		native.changed?.({ ...currentState, status: "downloading", percent: null })
	);
	const indeterminate = within(settings).getByRole("progressbar", {
		name: "Download progress",
	});
	expect(indeterminate.hasAttribute("aria-valuenow")).toBe(false);
	expect(indeterminate.getAttribute("aria-valuetext")).toContain(
		"not available"
	);
	act(() =>
		native.changed?.({
			...currentState,
			status: "downloading",
			version: "0.1.2",
			percent: 42.4,
		})
	);
	expect(within(settings).getByText("Downloading version 0.1.2.")).toBeTruthy();
	expect(within(settings).getByText("42%")).toBeTruthy();
	expect(
		within(settings).queryByRole("button", { name: "Cancel download" })
	).toBeNull();
	expect(
		within(settings)
			.getByRole("progressbar", { name: "Download progress" })
			.getAttribute("aria-valuenow")
	).toBe("42");
	expect(
		screen.queryByRole("complementary", { name: "Desktop update" })
	).toBeNull();
	act(() =>
		native.changed?.({
			...currentState,
			status: "downloading",
			version: "0.1.2",
			percent: 100,
		})
	);
	expect(
		within(settings).queryByRole("button", { name: "Restart to update" })
	).toBeNull();

	act(() =>
		native.changed?.({
			...currentState,
			status: "downloaded",
			version: "0.1.2",
			percent: 100,
		})
	);
	expect(
		within(settings).getByText(
			"Version 0.1.2 is downloaded. Restart to finish updating."
		)
	).toBeTruthy();
	within(settings).getByRole("button", { name: "Restart to update" }).click();
	expect(native.bridge.updaterAction).toHaveBeenCalledWith("restart");
});

it("retains dismissed identities across progress, repeated checks, and retries without acknowledging an update", async () => {
	native.bridge.updaterState.mockResolvedValueOnce(updateState());
	render(
		<QueryClientProvider client={new QueryClient()}>
			<DesktopUpdater />
		</QueryClientProvider>
	);
	await screen.findByRole("button", { name: "Download update" });
	fireEvent.click(screen.getByRole("button", { name: "Later" }));
	for (const state of [updateState({ status: "checking" }), updateState()]) {
		act(() => native.changed?.(state));
		expect(
			screen.queryByRole("complementary", { name: "Desktop update" })
		).toBeNull();
	}
	act(() =>
		native.changed?.(updateState({ status: "downloading", percent: 12 }))
	);
	fireEvent.click(screen.getByRole("button", { name: "Later" }));
	act(() =>
		native.changed?.(updateState({ status: "downloading", percent: 74 }))
	);
	expect(
		screen.queryByRole("complementary", { name: "Desktop update" })
	).toBeNull();
	act(() =>
		native.changed?.(updateState({ status: "error", errorStage: "download" }))
	);
	expect(screen.getByRole("button", { name: "Retry download" })).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "Later" }));
	for (const state of [
		updateState({ status: "downloading" }),
		updateState({ status: "error", errorStage: "download" }),
	]) {
		act(() => native.changed?.(state));
		expect(
			screen.queryByRole("complementary", { name: "Desktop update" })
		).toBeNull();
	}
	act(() => native.changed?.(updateState({ status: "checking" })));
	act(() => native.changed?.(updateState({ version: "0.1.3" })));
	expect(screen.getByRole("button", { name: "Download update" })).toBeTruthy();
	expect(native.bridge.updaterAction).not.toHaveBeenCalled();
});

it("surfaces completion and a different error stage but not a repeated downloaded snapshot", async () => {
	native.bridge.updaterState.mockResolvedValueOnce(
		updateState({ status: "error", errorStage: "download" })
	);
	render(
		<QueryClientProvider client={new QueryClient()}>
			<DesktopUpdater />
		</QueryClientProvider>
	);
	await screen.findByRole("button", { name: "Retry download" });
	fireEvent.click(screen.getByRole("button", { name: "Later" }));
	act(() =>
		native.changed?.(updateState({ status: "downloaded", percent: 100 }))
	);
	expect(
		screen.getByRole("button", { name: "Restart to update" })
	).toBeTruthy();
	act(() => native.changed?.(updateState({ status: "preparing" })));
	expect(screen.queryByRole("button", { name: "Later" })).toBeNull();
	act(() =>
		native.changed?.(updateState({ status: "error", errorStage: "restart" }))
	);
	expect(screen.getByRole("button", { name: "Retry restart" })).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "Later" }));
	act(() =>
		native.changed?.(updateState({ status: "downloaded", percent: 100 }))
	);
	fireEvent.click(screen.getByRole("button", { name: "Later" }));
	act(() => native.changed?.(updateState({ status: "checking" })));
	act(() =>
		native.changed?.(updateState({ status: "downloaded", percent: 100 }))
	);
	expect(
		screen.queryByRole("complementary", { name: "Desktop update" })
	).toBeNull();
});

it("suppresses only ordinary notices while Updates is mounted, including Strict Mode cleanup", async () => {
	native.bridge.updaterState
		.mockResolvedValueOnce(updateState())
		.mockResolvedValueOnce(updateState());
	const client = new QueryClient();
	const content = (settings: boolean) => (
		<StrictMode>
			<QueryClientProvider client={client}>
				<DesktopUpdater />
				{settings ? <DesktopUpdatesSection presentation="settings" /> : null}
			</QueryClientProvider>
		</StrictMode>
	);
	const view = render(content(true));
	await screen.findByRole("heading", { name: "Update available" });
	expect(
		screen.queryByRole("complementary", { name: "Desktop update" })
	).toBeNull();
	view.rerender(content(false));
	expect(
		screen.getByRole("complementary", { name: "Desktop update" })
	).toBeTruthy();
	view.rerender(content(true));
	expect(
		screen.queryByRole("complementary", { name: "Desktop update" })
	).toBeNull();
	view.rerender(content(false));
	fireEvent.click(screen.getByRole("button", { name: "Later" }));
	view.rerender(content(true));
	view.rerender(content(false));
	expect(
		screen.queryByRole("complementary", { name: "Desktop update" })
	).toBeNull();
	view.rerender(content(true));
	act(() => native.changed?.(updateState({ status: "preparing" })));
	expect(
		screen.getByRole("complementary", { name: "Desktop update" })
	).toBeTruthy();
	expect(screen.queryByRole("button", { name: "Later" })).toBeNull();
	expect(document.body.inert).toBe(true);
	act(() =>
		native.changed?.(updateState({ status: "error", errorStage: "install" }))
	);
	expect(
		screen.getByRole("complementary", { name: "Desktop update" })
	).toBeTruthy();
	expect(screen.queryByRole("button")).toBeNull();
	expect(document.body.inert).toBe(true);
});

it.each([
	["idle", "check", "Check for updates"],
	["available", "download", "Download update"],
	["downloaded", "restart", "Restart to update"],
] as const)("surfaces a rejected %s action without fabricating native success", async (status, action, label) => {
	vi.spyOn(console, "error").mockImplementation(() => undefined);
	native.bridge.updaterState.mockResolvedValueOnce(updateState({ status }));
	let reject!: (error: Error) => void;
	native.bridge.updaterAction.mockImplementationOnce(
		() =>
			new Promise((_resolve, no) => {
				reject = no;
			})
	);
	render(
		<QueryClientProvider client={new QueryClient()}>
			<DesktopUpdater />
			<DesktopUpdatesSection presentation="settings" />
		</QueryClientProvider>
	);
	const button = await screen.findByRole("button", { name: label });
	fireEvent.click(button);
	fireEvent.click(button);
	expect(button.hasAttribute("disabled")).toBe(true);
	expect(button.getAttribute("aria-busy")).toBe("true");
	expect(native.bridge.updaterAction).toHaveBeenCalledTimes(1);
	await act(async () => reject(new Error("Synthetic IPC failure")));
	expect((await screen.findByRole("alert")).textContent).toContain(
		"Couldn't confirm"
	);
	expect(native.bridge.updaterAction).toHaveBeenCalledWith(action);
	expect(
		screen.getByRole("button", { name: label }).hasAttribute("disabled")
	).toBe(false);
});
it.each([
	"page",
	"dialog",
] as const)("keeps both navigation entries on the same native attention in the %s presentation", async (presentation) => {
	const openSettings = vi.fn();
	const navigate = vi.fn();
	const navigationRole = presentation === "dialog" ? "button" : "link";
	const { rerender } = render(
		<QueryClientProvider client={new QueryClient()}>
			<DesktopUpdater />
			<TestSettingsEntry onClick={openSettings} />
			<SettingsInnerSidebar
				activeSectionId="account"
				isPersonalWorkspace={false}
				items={[
					{ id: "updates", title: "Updates", to: "/o/team/settings/updates" },
				]}
				onNavigate={presentation === "dialog" ? navigate : undefined}
				onSendFeedback={vi.fn()}
				organizationName="Team"
				organizationRole="owner"
				presentation={presentation}
			/>
		</QueryClientProvider>
	);
	await screen.findByRole("menuitem", {
		name: "Settings, Desktop update pending",
	});
	const updatesEntry = screen.getByRole(navigationRole, {
		name: "Updates, Desktop update pending",
	});
	if (presentation === "dialog") {
		fireEvent.click(updatesEntry);
		expect(navigate).toHaveBeenCalledWith("updates");
	} else {
		expect(updatesEntry.getAttribute("href")).toBe("/o/team/settings/updates");
	}
	fireEvent.click(
		screen.getByRole("menuitem", { name: "Settings, Desktop update pending" })
	);
	expect(openSettings).toHaveBeenCalledOnce();
	fireEvent.click(screen.getByRole("button", { name: "Later" }));
	expect(
		document.querySelectorAll('[data-slot="desktop-update-indicator"]')
	).toHaveLength(2);
	for (const status of ["downloading", "checking", "error"] as const) {
		act(() =>
			native.changed?.({
				status,
				currentVersion: "0.1.1",
				version: "0.1.2",
				percent: null,
				errorStage: status === "error" ? "check" : null,
			})
		);
		expect(
			document.querySelectorAll('[data-slot="desktop-update-indicator"]')
		).toHaveLength(2);
	}
	act(() =>
		native.changed?.({
			status: "current",
			currentVersion: "0.1.1",
			version: null,
			percent: null,
			errorStage: null,
		})
	);
	expect(
		document.querySelectorAll('[data-slot="desktop-update-indicator"]')
	).toHaveLength(0);
	expect(screen.getByRole("menuitem", { name: "Settings" })).toBeTruthy();
	expect(screen.getByRole(navigationRole, { name: "Updates" })).toBeTruthy();
	// A retained Desktop snapshot must not leak attention into a plain Web host.
	act(() =>
		native.changed?.({
			status: "available",
			currentVersion: "0.1.1",
			version: "0.1.2",
			percent: null,
			errorStage: null,
		})
	);
	native.enabled = false;
	rerender(<TestSettingsEntry onClick={openSettings} />);
	expect(screen.getByRole("menuitem", { name: "Settings" })).toBeTruthy();
	expect(
		document.querySelectorAll('[data-slot="desktop-update-indicator"]')
	).toHaveLength(0);
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
it.each([
	"resolve",
	"reject",
] as const)("does not replace a newer native event with a late initial %s", async (outcome) => {
	vi.spyOn(console, "error").mockImplementation(() => undefined);
	let resolve!: (state: DesktopUpdaterState) => void;
	let reject!: (error: Error) => void;
	native.bridge.updaterState.mockImplementationOnce(
		() =>
			new Promise((yes, no) => {
				resolve = yes;
				reject = no;
			})
	);
	const { container } = render(
		<QueryClientProvider client={new QueryClient()}>
			<DesktopUpdater />
			<DesktopUpdatesSection presentation="settings" />
		</QueryClientProvider>
	);
	expect(container.textContent).toContain("Loading update status");
	expect(container.textContent).not.toContain("You're up to date");
	expect(document.body.inert).toBe(true);
	act(() => native.changed?.(updateState({ status: "installing" })));
	await act(async () => {
		if (outcome === "resolve") {
			resolve(updateState({ status: "current", version: null }));
		} else {
			reject(new Error("Late initial read failure"));
		}
		await Promise.resolve();
	});
	expect(container.textContent).toContain("Restarting to update");
	expect(container.textContent).not.toContain("Couldn't read update status");
	expect(container.querySelector("button")).toBeNull();
	expect(document.body.inert).toBe(true);
});

it("explains an initial read failure without unlocking an unknown install, then accepts native recovery", async () => {
	vi.spyOn(console, "error").mockImplementation(() => undefined);
	native.bridge.updaterState.mockRejectedValueOnce(
		new Error("Initial IPC unavailable")
	);
	const { container } = render(
		<QueryClientProvider client={new QueryClient()}>
			<DesktopUpdater />
		</QueryClientProvider>
	);
	await act(async () => {
		await Promise.resolve();
	});
	expect(container.textContent).toContain("Couldn't read update status");
	expect(container.textContent).toContain("Choose Quit from the app menu");
	expect(container.querySelector("button")).toBeNull();
	expect(document.body.inert).toBe(true);
	act(() => native.changed?.(updateState()));
	expect(screen.getByRole("button", { name: "Download update" })).toBeTruthy();
	expect(document.body.inert).toBeFalsy();
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
