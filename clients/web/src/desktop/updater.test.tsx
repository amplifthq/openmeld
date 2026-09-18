import type {
	DesktopUpdaterRestartRequest,
	DesktopUpdaterState,
} from "@openmeld/schemas";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { registerClientVersionRecoveryBlocker } from "#/client-version-recovery";
import { AppSettingsButton } from "#/components/app/app-settings-button";
import { SettingsInnerSidebar } from "#/components/settings/settings-page";
import {
	clearCenterAgentPendingMessage,
	createPendingCenterAgentMessage,
	readCenterAgentPendingMessage,
	writeCenterAgentPendingMessage,
} from "#/lib/organizations/center-agent-pending-message";
import { DesktopUpdater, DesktopUpdatesSection } from "./updater";

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
		updaterAction: vi.fn(async () => undefined),
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
	await within(settings).findByText(
		"You're up to date. No updates are available."
	);
	expect(within(settings).getByText("Installed version")).toBeTruthy();
	expect(within(settings).getByText("Version 0.1.1")).toBeTruthy();
	expect(within(settings).queryByText("Available version")).toBeNull();

	act(() =>
		native.changed?.({
			...currentState,
			status: "downloading",
			version: "0.1.2",
			percent: 42.4,
		})
	);
	expect(within(settings).getByText("Available version")).toBeTruthy();
	expect(within(settings).getByText("Version 0.1.2")).toBeTruthy();
	expect(
		within(settings).getByText(
			"Downloading update… Downloading version 0.1.2. 42% downloaded."
		)
	).toBeTruthy();
	const notice = screen.getByRole("complementary", { name: "Desktop update" });
	expect(within(notice).getByRole("heading", { name: "Updates" })).toBeTruthy();
	expect(within(notice).queryByText("Installed version")).toBeNull();

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
			"Ready to restart. Version 0.1.2 is downloaded. Restart to finish updating."
		)
	).toBeTruthy();
	within(settings).getByRole("button", { name: "Restart to update" }).click();
	expect(native.bridge.updaterAction).toHaveBeenCalledWith("restart");
});
it.each([
	"page",
	"dialog",
] as const)("keeps both navigation entries on the same native attention in the %s presentation", async (presentation) => {
	const openSettings = vi.fn();
	const navigate = vi.fn();
	const navigationRole = presentation === "dialog" ? "button" : "link";
	const { container, rerender } = render(
		<QueryClientProvider client={new QueryClient()}>
			<DesktopUpdater />
			<AppSettingsButton
				className="size-7"
				isActive={false}
				onClick={openSettings}
			/>
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
	await screen.findByRole("button", {
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
		screen.getByRole("button", { name: "Settings, Desktop update pending" })
	);
	expect(openSettings).toHaveBeenCalledOnce();
	fireEvent.click(screen.getByRole("button", { name: "Later" }));
	expect(
		container.querySelectorAll('[data-slot="desktop-update-indicator"]')
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
			container.querySelectorAll('[data-slot="desktop-update-indicator"]')
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
		container.querySelectorAll('[data-slot="desktop-update-indicator"]')
	).toHaveLength(0);
	expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
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
	rerender(
		<AppSettingsButton
			className="size-7"
			isActive={false}
			onClick={openSettings}
		/>
	);
	expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
	expect(
		container.querySelectorAll('[data-slot="desktop-update-indicator"]')
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
