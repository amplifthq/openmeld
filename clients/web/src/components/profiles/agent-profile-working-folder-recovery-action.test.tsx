import type { AuthProfileView } from "@openmeld/schemas/types";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createTestQueryClient,
	TestQueryClientProvider,
} from "#/test-support/query-client";
import {
	AgentProfileWorkingFolderDialogHost,
	AgentProfileWorkingFolderRecoveryAction,
} from "./agent-profile-working-folder-recovery-action";
import { resetWorkingFolderDialogHostForTests } from "./working-folder-dialog-host";

const readReadinessMock = vi.hoisted(() => vi.fn());
const readFoldersMock = vi.hoisted(() => vi.fn(() => Promise.resolve({})));
const toastMock = vi.hoisted(() => ({
	info: vi.fn(),
	loading: vi.fn(() => "toast-1"),
	success: vi.fn(),
	warning: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("#/query/agents/execution-readiness", () => ({
	agentExecutionReadinessBatchQueryOptions: (input: { enabled: boolean }) => ({
		enabled: input.enabled,
		queryFn: readReadinessMock,
		queryKey: ["readiness", "profile-agent"],
	}),
}));
vi.mock("#/query/profiles/primary-binding", () => ({
	agentProfileControllerChangeEligibilityQueryOptions: (input: {
		enabled: boolean;
	}) => ({
		enabled: input.enabled,
		queryFn: () => Promise.resolve({ status: "allowed" }),
		queryKey: ["eligibility", "profile-agent"],
	}),
}));
vi.mock("#/lib/profiles/agent-profile-primary-binding", () => ({
	projectAgentProfileBindingTarget: () => ({
		agentControllerConversationId: null,
		agentControllerRef: "builtin:codex",
		bindingId: "binding-1",
		openMeldServiceRuntimeId: "runtime-1",
	}),
}));
// The dialog's own behavior has its own tests; here it only reports a save.
vi.mock("#/components/profiles/agent-profile-folders-dialog", () => ({
	AgentProfileFoldersDialog: (input: {
		onOpenChange: (open: boolean) => void;
		onOpenChangeComplete?: (open: boolean) => void;
		open: boolean;
		preparing?: { failed: boolean };
		recovery: { message: string; onSaved: () => void };
	}) =>
		input.open ? (
			<div role="dialog">
				<button
					onClick={() => {
						input.onOpenChange(false);
						input.onOpenChangeComplete?.(false);
					}}
					type="button"
				>
					Done
				</button>
				{input.preparing ? (
					<p>Preparing</p>
				) : (
					<>
						<p>{input.recovery.message}</p>
						<button onClick={input.recovery.onSaved} type="button">
							Save folder
						</button>
					</>
				)}
			</div>
		) : null,
}));
vi.mock("#/query/profiles/agent-profile-folders", () => ({
	agentProfileFoldersQueryOptions: (input: { enabled: boolean }) => ({
		enabled: input.enabled,
		queryFn: readFoldersMock,
		queryKey: ["folders", "profile-agent"],
	}),
}));
vi.mock("#/query/profiles/working-folder", () => ({
	agentProfileWorkingFolderQueryOptions: (input: { enabled: boolean }) => ({
		enabled: input.enabled,
		queryFn: () => Promise.resolve({ workspace: { status: "configured" } }),
		queryKey: ["working-folder", "profile-agent"],
	}),
}));

function readiness(status: string) {
	return {
		items: [
			{
				agentControllerRef: "builtin:codex",
				agentProfileId: "profile-agent",
				agentWakeAvailability: { status },
				primaryBinding: {},
				routeDeviceId: "device-1",
				routeLane: "prod",
				runtimeDeviceDisplayName: "Felix’s MacBook Pro",
			},
		],
	};
}

function renderAction(
	options: { folderMissing?: boolean; fromReadiness?: boolean } = {
		folderMissing: true,
	}
) {
	const queryClient = createTestQueryClient();
	return render(
		<TestQueryClientProvider queryClient={queryClient}>
			<AgentProfileWorkingFolderRecoveryAction
				actorProfileId={null}
				folderMissing={options.folderMissing}
				fromReadiness={options.fromReadiness}
				onProfileUpdated={vi.fn()}
				organizationId="org-1"
				profile={{ openMeldProfileId: "profile-agent" } as AuthProfileView}
				storageScope="account-1"
			/>
		</TestQueryClientProvider>
	);
}

afterEach(() => {
	cleanup();
	resetWorkingFolderDialogHostForTests();
});
beforeEach(() => {
	vi.clearAllMocks();
});

describe("AgentProfileWorkingFolderRecoveryAction", () => {
	it("keeps the open dialog when readiness hides the action that opened it", async () => {
		readReadinessMock.mockResolvedValue(readiness("unavailable_for_wake"));
		const queryClient = createTestQueryClient();
		const view = (showAction: boolean) => (
			<TestQueryClientProvider queryClient={queryClient}>
				<AgentProfileWorkingFolderDialogHost />
				{showAction ? (
					<AgentProfileWorkingFolderRecoveryAction
						actorProfileId={null}
						folderMissing
						onProfileUpdated={vi.fn()}
						organizationId="org-1"
						profile={{ openMeldProfileId: "profile-agent" } as AuthProfileView}
						storageScope="account-1"
					/>
				) : null}
			</TestQueryClientProvider>
		);
		const { rerender } = render(view(true));
		await waitFor(() => expect(readFoldersMock).toHaveBeenCalled());
		fireEvent.click(
			screen.getByRole("button", { name: "Choose working folder" })
		);
		expect(screen.getByRole("button", { name: "Save folder" })).toBeTruthy();
		// Readiness flips to "Checking" and back: the action goes and returns.
		rerender(view(false));
		expect(screen.getByRole("button", { name: "Save folder" })).toBeTruthy();
		rerender(view(true));
		expect(screen.getAllByRole("dialog")).toHaveLength(1);
		rerender(view(false));
		fireEvent.click(screen.getByRole("button", { name: "Save folder" }));
		await waitFor(() =>
			expect(toastMock.warning).toHaveBeenCalledWith(
				"Working folder saved. This Agent still needs attention. Review its current status.",
				expect.objectContaining({ id: "toast-1" })
			)
		);
		fireEvent.click(screen.getByRole("button", { name: "Done" }));
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("does not read readiness again each time readiness shows the action again", async () => {
		readReadinessMock.mockResolvedValue(readiness("unavailable_for_wake"));
		const queryClient = createTestQueryClient();
		const view = (showAction: boolean) => (
			<TestQueryClientProvider queryClient={queryClient}>
				{showAction ? (
					<AgentProfileWorkingFolderRecoveryAction
						actorProfileId={null}
						folderMissing
						onProfileUpdated={vi.fn()}
						organizationId="org-1"
						profile={{ openMeldProfileId: "profile-agent" } as AuthProfileView}
						storageScope="account-1"
					/>
				) : null}
			</TestQueryClientProvider>
		);
		const { rerender } = render(view(true));
		await waitFor(() => expect(readReadinessMock).toHaveBeenCalledTimes(1));
		for (const show of [false, true, false, true]) {
			rerender(view(show));
		}
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(readReadinessMock).toHaveBeenCalledTimes(1);
	});

	it("asks to choose a folder when none is set, without talking about a failure", async () => {
		readReadinessMock.mockResolvedValue(readiness("unavailable_for_wake"));
		renderAction();
		fireEvent.click(
			screen.getByRole("button", { name: "Choose working folder" })
		);
		expect(
			await screen.findByText(
				"Choose the folder on Felix’s MacBook Pro where this Agent starts new work."
			)
		).toBeTruthy();
	});

	it("says a folder found unusable by readiness may have moved, without a failed task", async () => {
		readReadinessMock.mockResolvedValue(readiness("unavailable_for_wake"));
		renderAction({ fromReadiness: true });
		fireEvent.click(
			screen.getByRole("button", { name: "Review working folder" })
		);
		expect(
			await screen.findByText(
				"This Agent can’t use its working folder on Felix’s MacBook Pro. It may have been moved or deleted. Set it up again or choose another folder for new work. This does not move files."
			)
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Save folder" }));
		await waitFor(() =>
			expect(toastMock.warning).toHaveBeenCalledWith(
				"Working folder saved. This Agent still needs attention. Review its current status.",
				expect.objectContaining({ id: "toast-1" })
			)
		);
	});

	it("reads ahead, so a click opens the dialog in its final layout", async () => {
		readReadinessMock.mockResolvedValue(readiness("unavailable_for_wake"));
		renderAction();
		// Read while the fix is on screen, before any click.
		await waitFor(() => expect(readFoldersMock).toHaveBeenCalled());
		fireEvent.click(
			screen.getByRole("button", { name: "Choose working folder" })
		);
		expect(screen.getByRole("button", { name: "Save folder" })).toBeTruthy();
		expect(screen.queryByText("Preparing")).toBeNull();
	});

	it("shows the same dialog's loading layout when clicked before the reads finish", async () => {
		let resolveReadiness: (value: unknown) => void = () => undefined;
		readReadinessMock.mockReturnValue(
			new Promise((resolve) => {
				resolveReadiness = resolve;
			})
		);
		renderAction();
		fireEvent.click(
			screen.getByRole("button", { name: "Choose working folder" })
		);
		expect(screen.getByText("Preparing")).toBeTruthy();
		resolveReadiness(readiness("unavailable_for_wake"));
		expect(
			await screen.findByRole("button", { name: "Save folder" })
		).toBeTruthy();
		expect(screen.getAllByRole("dialog")).toHaveLength(1);
	});

	it("still confirms the save after the fix unmounts the action", async () => {
		readReadinessMock.mockResolvedValue(readiness("unavailable_for_wake"));
		const view = renderAction();
		fireEvent.click(
			screen.getByRole("button", { name: "Choose working folder" })
		);
		const save = await screen.findByRole("button", { name: "Save folder" });
		readReadinessMock.mockResolvedValue(readiness("available_for_wake"));
		fireEvent.click(save);
		// The problem is gone, so the card or footer that held this action goes.
		view.unmount();
		await waitFor(() =>
			expect(toastMock.success).toHaveBeenCalledWith(
				"Working folder saved. This Agent is ready for new work.",
				{ id: "toast-1" }
			)
		);
	});

	it("keeps a way to check again when the Agent still needs attention", async () => {
		readReadinessMock.mockResolvedValue(readiness("unavailable_for_wake"));
		renderAction();
		fireEvent.click(
			screen.getByRole("button", { name: "Choose working folder" })
		);
		fireEvent.click(await screen.findByRole("button", { name: "Save folder" }));
		await waitFor(() =>
			expect(toastMock.warning).toHaveBeenCalledWith(
				"Working folder saved. This Agent still needs attention. Review its current status.",
				{
					action: expect.objectContaining({ label: "Check again" }),
					id: "toast-1",
				}
			)
		);
	});

	it("waits out a checking readiness instead of warning, then confirms in place", async () => {
		readReadinessMock.mockResolvedValue(readiness("unavailable_for_wake"));
		renderAction();
		fireEvent.click(
			screen.getByRole("button", { name: "Choose working folder" })
		);
		const save = await screen.findByRole("button", { name: "Save folder" });
		vi.useFakeTimers();
		try {
			readReadinessMock
				.mockResolvedValueOnce(readiness("checking_connection"))
				.mockResolvedValueOnce(readiness("checking_connection"))
				.mockResolvedValue(readiness("available_for_wake"));
			fireEvent.click(save);
			expect(toastMock.loading).toHaveBeenCalledWith(
				"Working folder saved. Checking availability…"
			);
			await vi.advanceTimersByTimeAsync(5000);
		} finally {
			vi.useRealTimers();
		}
		expect(toastMock.success).toHaveBeenCalledWith(
			"Working folder saved. This Agent is ready for new work.",
			{ id: "toast-1" }
		);
		expect(toastMock.warning).not.toHaveBeenCalled();
	});

	it("stays neutral when readiness is still checking after the last read", async () => {
		readReadinessMock.mockResolvedValue(readiness("unavailable_for_wake"));
		renderAction();
		fireEvent.click(
			screen.getByRole("button", { name: "Choose working folder" })
		);
		const save = await screen.findByRole("button", { name: "Save folder" });
		vi.useFakeTimers();
		try {
			readReadinessMock.mockResolvedValue(readiness("checking_connection"));
			fireEvent.click(save);
			await vi.advanceTimersByTimeAsync(20_000);
		} finally {
			vi.useRealTimers();
		}
		expect(toastMock.info).toHaveBeenCalledWith(
			"Working folder saved. OpenMeld is still checking this Agent.",
			expect.objectContaining({ id: "toast-1" })
		);
		expect(toastMock.warning).not.toHaveBeenCalled();
		expect(toastMock.success).not.toHaveBeenCalled();
	});
});
