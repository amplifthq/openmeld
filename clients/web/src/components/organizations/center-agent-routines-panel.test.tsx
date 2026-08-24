import type {
	CenterAgentRoutine,
	CenterAgentRoutineManagement,
	CenterAgentRoutineRunStatus,
} from "@openmeld/schemas/types";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createTestQueryClient,
	TestQueryClientProvider,
} from "#/test-support/query-client";
import { CenterAgentRoutinesPanel as CenterAgentRoutinesPanelView } from "./center-agent-routines-panel";

vi.mock("./center-agent-self-evolution-card", () => ({
	CenterAgentSelfEvolutionCard: () => null,
}));

vi.mock("@tanstack/react-start", async () => {
	const actual = await vi.importActual<typeof import("@tanstack/react-start")>(
		"@tanstack/react-start"
	);
	return {
		...actual,
		createIsomorphicFn: () => {
			let clientImplementation: ((...args: never[]) => unknown) | undefined;
			const builder = {
				client: (implementation: (...args: never[]) => unknown) => {
					clientImplementation = implementation;
					return builder;
				},
				server: () => {
					if (!clientImplementation) {
						throw new Error("Missing client isomorphic implementation.");
					}
					return clientImplementation;
				},
			};
			return builder;
		},
	};
});

const ORGANIZATION_ID = "org-1";
const ROUTINES_PATH = "/v1/organizations/current/routines";
const ROUTINES_MANAGEMENT_CONTRACT = "management-v2";
const ROUTINES_PRACTICAL_CONTRACT = "practical-v2";
const ROUTINE_TARGET_SPACES_PATH =
	"/v1/organizations/current/routine-target-spaces";
const CENTER_AGENT_DM_PATH = "/v1/organizations/current/center-agent/dm-space";
const EDIT_BUTTON_PATTERN = /Edit/;
const DELETE_BUTTON_PATTERN = /Delete/;
const VIEW_RUNS_BUTTON_PATTERN = /View runs/;
const STATUS_CONFLICT_PATTERN =
	/This routine changed before your update finished/;
const FORBIDDEN_PATTERN =
	/You can view this routine, but only its creator or an organization owner or admin can manage it/;

function CenterAgentRoutinesPanel(input: {
	organizationId: string;
	orgSlug: string;
}) {
	return (
		<CenterAgentRoutinesPanelView
			currentUserId="user-1"
			isPersonalWorkspace={false}
			{...input}
		/>
	);
}

describe("CenterAgentRoutinesPanel", () => {
	beforeEach(() => {
		vi.stubGlobal(
			"fetch",
			createRouteFetch(
				new Map([
					[
						`GET ${window.location.origin}${ROUTINES_PATH}`,
						() =>
							jsonResponse({
								currentUserId: "user-1",
								organizationId: ORGANIZATION_ID,
								routines: [],
							}),
					],
					[
						`GET ${window.location.origin}${ROUTINE_TARGET_SPACES_PATH}`,
						() =>
							jsonResponse({
								organizationId: ORGANIZATION_ID,
								spaces: [],
							}),
					],
				])
			)
		);
	});

	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

	it("explains the empty state and gives every member a Create action", async () => {
		render(
			<TestQueryClientProvider>
				<CenterAgentRoutinesPanel
					organizationId={ORGANIZATION_ID}
					orgSlug="acme"
				/>
			</TestQueryClientProvider>
		);
		await waitFor(() => {
			expect(vi.mocked(fetch)).toHaveBeenCalled();
		});
		expect(
			vi.mocked(fetch).mock.calls.map(([resource, init]) => {
				return resolveRequestRoute(resource, init);
			})
		).toEqual([`GET ${window.location.origin}${ROUTINES_PATH}`]);

		expect(
			await screen.findByRole("heading", { name: "No routines yet" })
		).toBeTruthy();
		expect(screen.getByText("Organization")).toBeTruthy();
		expect(
			screen.getByRole("heading", { level: 1, name: "Routines" })
		).toBeTruthy();
		expect(
			screen.getByText(
				"Routines let your Center Agent work in a target Space on a schedule."
			)
		).toBeTruthy();
		expect(screen.getByRole("button", { name: "Create routine" })).toBeTruthy();
	});

	it("renders shared schedule copy, honest run states, and no mutation controls for read-only routines", async () => {
		const runStatuses = [
			"claimed",
			"submitted",
			"completed",
			"failed",
			"skipped",
		] as const;
		stubRoutineResponse([
			buildRoutine({ canManage: false, id: "routine-not-run", lastRun: null }),
			...runStatuses.map((status) =>
				buildRoutine({
					canManage: false,
					id: `routine-${status}`,
					lastRun: {
						failureCode:
							status === "failed" ? "routine.execution_failed" : null,
						failureDetail: resolveListRunFailureDetail(status),
						finishedAtMs:
							status === "completed" || status === "failed"
								? 1_752_304_000_000
								: null,
						id: `run-${status}`,
						publishedSignalId: status === "completed" ? "signal-1" : null,
						scheduledFor: 1_752_300_000_000,
						startedAtMs: status === "skipped" ? null : 1_752_300_001_000,
						status,
					},
					name: `Routine ${status}`,
				})
			),
		]);

		render(
			<TestQueryClientProvider>
				<CenterAgentRoutinesPanel
					organizationId={ORGANIZATION_ID}
					orgSlug="acme"
				/>
			</TestQueryClientProvider>
		);

		expect(await screen.findByText("Daily feedback review")).toBeTruthy();
		expect(
			screen.getAllByText("Every day at 9:00 AM (America/Los_Angeles)")
		).toHaveLength(6);
		expect(screen.getAllByText("America/Los_Angeles")).toHaveLength(6);
		expect(screen.getByText("Not run yet")).toBeTruthy();
		for (const label of [
			"Claimed",
			"Submitted",
			"Completed",
			"Failed",
			"Skipped",
		]) {
			expect(screen.getByText(label)).toBeTruthy();
		}
		expect(screen.getAllByText("Next run")).toHaveLength(6);
		expect(screen.queryByRole("switch")).toBeNull();
		expect(
			screen.queryByRole("button", { name: EDIT_BUTTON_PATTERN })
		).toBeNull();
		expect(
			screen.queryByRole("button", { name: DELETE_BUTTON_PATTERN })
		).toBeNull();
		expect(
			screen.getAllByRole("button", { name: VIEW_RUNS_BUTTON_PATTERN })
		).toHaveLength(6);
	});

	it("shows who created each Routine and the Local Agent that carried the request", async () => {
		stubRoutineResponse([
			buildRoutine({
				creationAttribution: {
					displayName: "Current User",
					interactionSource: { client: "codex", kind: "local_agent" },
				},
				id: "routine-current-user",
			}),
			buildRoutine({
				createdByUserId: "user-2",
				creationAttribution: {
					displayName: "Mira Chen",
					interactionSource: {
						client: "claude-code",
						kind: "local_agent",
					},
				},
				id: "routine-mira",
				name: "Mira's customer follow-up",
			}),
			buildRoutine({
				createdByUserId: "removed-user",
				creationAttribution: { displayName: null },
				id: "routine-former-member",
				name: "Legacy weekly review",
			}),
		]);

		render(
			<TestQueryClientProvider>
				<CenterAgentRoutinesPanel
					organizationId={ORGANIZATION_ID}
					orgSlug="acme"
				/>
			</TestQueryClientProvider>
		);

		expect(await screen.findByText("Created by you via Codex")).toBeTruthy();
		expect(
			screen.getByText("Created by Mira Chen via Claude Code")
		).toBeTruthy();
		expect(screen.getByText("Created by an organization member")).toBeTruthy();
	});

	it("creates a routine with explicit timezone, shared schedule preview, and a current-organization Space", async () => {
		const createdRoutine = buildRoutine({ id: "routine-created" });
		vi.stubGlobal(
			"fetch",
			createRouteFetch(
				new Map([
					[
						`GET ${window.location.origin}${ROUTINES_PATH}`,
						() =>
							jsonResponse({
								currentUserId: "user-1",
								organizationId: ORGANIZATION_ID,
								routines: [],
							}),
					],
					[
						`POST ${window.location.origin}${CENTER_AGENT_DM_PATH}`,
						() => centerAgentDirectMessageResponse(),
					],
					[
						`GET ${window.location.origin}${ROUTINE_TARGET_SPACES_PATH}`,
						() =>
							jsonResponse({
								organizationId: ORGANIZATION_ID,
								spaces: [
									{
										kind: "space",
										name: "Feedback triage",
										spaceId: "space-1",
									},
								],
							}),
					],
					[
						`POST ${window.location.origin}${ROUTINES_PATH}`,
						() =>
							jsonResponse(
								{ routine: projectPracticalRoutine(createdRoutine) },
								201
							),
					],
				])
			)
		);

		render(
			<TestQueryClientProvider>
				<CenterAgentRoutinesPanel
					organizationId={ORGANIZATION_ID}
					orgSlug="acme"
				/>
			</TestQueryClientProvider>
		);
		fireEvent.click(
			await screen.findByRole("button", { name: "Create routine" })
		);
		const dialog = await screen.findByRole("dialog", {
			name: "Create routine",
		});
		fireEvent.change(within(dialog).getByLabelText("Name"), {
			target: { value: "Daily feedback review" },
		});
		fireEvent.change(within(dialog).getByLabelText("Instructions"), {
			target: { value: "Review new Feedback Inbox issues." },
		});
		fireEvent.change(within(dialog).getByLabelText("Schedule"), {
			target: { value: "0 9 * * *" },
		});
		fireEvent.change(within(dialog).getByLabelText("Timezone"), {
			target: { value: "America/Los_Angeles" },
		});
		expect(
			within(dialog).getByText("Every day at 9:00 AM (America/Los_Angeles)")
		).toBeTruthy();

		fireEvent.click(
			within(dialog).getByRole("combobox", { name: "Target Space" })
		);
		fireEvent.click(
			await screen.findByRole("option", { name: "Feedback triage" })
		);
		const submitButton = within(dialog).getByRole("button", {
			name: "Create routine",
		});
		fireEvent.click(submitButton);
		fireEvent.click(submitButton);

		await waitFor(() => {
			expect(
				vi
					.mocked(fetch)
					.mock.calls.filter(
						([resource, init]) =>
							resolveRequestRoute(resource, init) ===
							`POST ${window.location.origin}${ROUTINES_PATH}`
					)
			).toHaveLength(1);
		});
		const createCall = vi
			.mocked(fetch)
			.mock.calls.find(
				([resource, init]) =>
					resolveRequestRoute(resource, init) ===
					`POST ${window.location.origin}${ROUTINES_PATH}`
			);
		expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({
			cronExpression: "0 9 * * *",
			destinationKind: "space",
			instructions: "Review new Feedback Inbox issues.",
			name: "Daily feedback review",
			runAtMs: null,
			scheduleKind: "cron",
			slackChannelId: null,
			slackConversationId: null,
			slackTeamId: null,
			slackThreadLabel: null,
			slackThreadTs: null,
			targetSpaceId: "space-1",
			timezone: "America/Los_Angeles",
		});
		await waitFor(() => {
			expect(
				screen.queryByRole("dialog", { name: "Create routine" })
			).toBeNull();
		});
		expect(
			vi
				.mocked(fetch)
				.mock.calls.filter(([resource, init]) =>
					resolveRequestRoute(resource, init).startsWith(
						`GET ${window.location.origin}${ROUTINES_PATH}`
					)
				)
		).toHaveLength(2);
	});

	it("shows mutation controls only from canManage and uses explicit edit, pause, and delete API operations", async () => {
		const routine = buildRoutine({ id: "routine-managed" });
		const detailPath = `${ROUTINES_PATH}/routine-managed`;
		vi.stubGlobal(
			"fetch",
			createRouteFetch(
				new Map([
					[
						`GET ${window.location.origin}${ROUTINES_PATH}`,
						() =>
							jsonResponse({
								currentUserId: "user-1",
								organizationId: ORGANIZATION_ID,
								routines: [routine],
							}),
					],
					[
						`POST ${window.location.origin}${CENTER_AGENT_DM_PATH}`,
						() => centerAgentDirectMessageResponse(),
					],
					[
						`GET ${window.location.origin}${ROUTINE_TARGET_SPACES_PATH}`,
						() =>
							jsonResponse({
								organizationId: ORGANIZATION_ID,
								spaces: [buildTargetSpace()],
							}),
					],
					[
						`PATCH ${window.location.origin}${detailPath}`,
						() =>
							jsonResponse({
								routine: projectPracticalRoutine({
									...routine,
									name: "Weekday feedback review",
								}),
							}),
					],
					[
						`POST ${window.location.origin}${detailPath}/pause`,
						() =>
							jsonResponse({
								routine: projectPracticalRoutine({
									...routine,
									nextDueAt: null,
									status: "paused",
								}),
							}),
					],
					[
						`DELETE ${window.location.origin}${detailPath}`,
						() =>
							jsonResponse({
								deleted: true,
								organizationId: ORGANIZATION_ID,
								routineId: routine.id,
							}),
					],
				])
			)
		);

		render(
			<TestQueryClientProvider>
				<CenterAgentRoutinesPanel
					organizationId={ORGANIZATION_ID}
					orgSlug="acme"
				/>
			</TestQueryClientProvider>
		);
		await screen.findByText(routine.name);
		expect(
			screen.getByRole("switch", { name: `Pause ${routine.name}` })
		).toBeTruthy();
		expect(
			screen.getByRole("button", { name: `Edit ${routine.name}` })
		).toBeTruthy();
		expect(
			screen.getByRole("button", { name: `Delete ${routine.name}` })
		).toBeTruthy();

		fireEvent.click(
			screen.getByRole("button", { name: `Edit ${routine.name}` })
		);
		const editDialog = await screen.findByRole("dialog", {
			name: `Edit ${routine.name}`,
		});
		fireEvent.change(within(editDialog).getByLabelText("Name"), {
			target: { value: "Weekday feedback review" },
		});
		fireEvent.click(
			within(editDialog).getByRole("button", { name: "Save changes" })
		);
		await waitFor(() => {
			expect(
				screen.queryByRole("dialog", { name: `Edit ${routine.name}` })
			).toBeNull();
		});
		const patchCall = vi
			.mocked(fetch)
			.mock.calls.find(([, init]) => init?.method === "PATCH");
		expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual({
			name: "Weekday feedback review",
		});

		fireEvent.click(
			screen.getByRole("switch", { name: `Pause ${routine.name}` })
		);
		await waitFor(() => {
			expect(
				vi
					.mocked(fetch)
					.mock.calls.filter(
						([resource, init]) =>
							resolveRequestRoute(resource, init) ===
							`POST ${window.location.origin}${detailPath}/pause`
					)
			).toHaveLength(1);
		});

		fireEvent.click(
			screen.getByRole("button", { name: `Delete ${routine.name}` })
		);
		const deleteDialog = await screen.findByRole("dialog", {
			name: `Delete ${routine.name}?`,
		});
		expect(
			within(deleteDialog).getByText(
				"Existing run history is retained for audit."
			)
		).toBeTruthy();
		fireEvent.click(
			within(deleteDialog).getByRole("button", { name: "Delete routine" })
		);
		await waitFor(() => {
			expect(
				vi
					.mocked(fetch)
					.mock.calls.filter(([, init]) => init?.method === "DELETE")
			).toHaveLength(1);
		});
	});

	it("keeps long Routine controls inside the card with a concise visible Runs action", async () => {
		const routine = buildRoutine({
			id: "routine-responsive",
			name: "Weekly responsive product review across every supported screen size",
		});
		stubRoutineResponse([routine]);
		render(
			<TestQueryClientProvider>
				<CenterAgentRoutinesPanel
					organizationId={ORGANIZATION_ID}
					orgSlug="acme"
				/>
			</TestQueryClientProvider>
		);

		const viewRuns = await screen.findByRole("button", {
			name: `View runs for ${routine.name}`,
		});
		expect(within(viewRuns).getByText("View runs").className).toContain(
			"lg:hidden"
		);
		expect(
			within(viewRuns).getByText(`View runs for ${routine.name}`).className
		).toContain("max-lg:hidden");
		expect(viewRuns.parentElement?.className).toContain("min-w-0");
	});

	it("paginates run history and presents every run state without inventing terminal outcomes", async () => {
		const routine = buildRoutine({ canManage: false, id: "routine-history" });
		const runsPath = `${ROUTINES_PATH}/routine-history/runs`;
		const statuses = [
			"claimed",
			"submitted",
			"completed",
			"failed",
			"skipped",
		] as const;
		const firstPage = statuses.map((status, index) => ({
			failureCode: status === "failed" ? "routine.execution_failed" : null,
			failureDetail: resolveHistoryRunFailureDetail(status),
			finishedAtMs:
				status === "completed" || status === "failed"
					? 1_752_300_020_000 - index * 1000
					: null,
			id: `run-${status}`,
			nativeDeliveryId: status === "submitted" ? "delivery-1" : null,
			organizationId: ORGANIZATION_ID,
			publishedSignalId: status === "completed" ? "signal-1" : null,
			routineId: routine.id,
			scheduledFor: 1_752_300_000_000 - index * 1000,
			startedAtMs:
				status === "skipped" ? null : 1_752_300_001_000 - index * 1000,
			status,
		}));
		const cursor = firstPage.at(-1)?.scheduledFor;
		vi.stubGlobal(
			"fetch",
			createRouteFetch(
				new Map([
					[
						`GET ${window.location.origin}${ROUTINES_PATH}`,
						() =>
							jsonResponse({
								currentUserId: "user-1",
								organizationId: ORGANIZATION_ID,
								routines: [routine],
							}),
					],
					[
						`GET ${window.location.origin}${runsPath}?limit=5`,
						() =>
							jsonResponse({
								organizationId: ORGANIZATION_ID,
								routineId: routine.id,
								runs: firstPage,
							}),
					],
					[
						`GET ${window.location.origin}${runsPath}?beforeScheduledFor=${cursor}&limit=5`,
						() =>
							jsonResponse({
								organizationId: ORGANIZATION_ID,
								routineId: routine.id,
								runs: [
									{
										...firstPage[2],
										id: "run-older",
										scheduledFor: Number(cursor) - 1000,
									},
								],
							}),
					],
				])
			)
		);

		render(
			<TestQueryClientProvider>
				<CenterAgentRoutinesPanel
					organizationId={ORGANIZATION_ID}
					orgSlug="acme"
				/>
			</TestQueryClientProvider>
		);
		fireEvent.click(
			await screen.findByRole("button", {
				name: `View runs for ${routine.name}`,
			})
		);
		const dialog = await screen.findByRole("dialog", {
			name: `Runs for ${routine.name}`,
		});
		expect(
			within(dialog).getByText(
				"Scheduled work is listed newest first. Runs in progress stay visible until they finish."
			)
		).toBeTruthy();
		expect(await within(dialog).findByText("Claimed")).toBeTruthy();
		for (const label of ["Submitted", "Completed", "Failed", "Skipped"]) {
			expect(within(dialog).getByText(label)).toBeTruthy();
		}
		expect(within(dialog).getByText("routine.execution_failed")).toBeTruthy();
		expect(
			within(dialog).getByText("The hosted turn failed before publication.")
		).toBeTruthy();
		expect(
			within(dialog).getByText(
				"Skipped 3 occurrences from Monday through Wednesday."
			)
		).toBeTruthy();
		expect(within(dialog).getAllByText("Result pending")).toHaveLength(2);
		expect(within(dialog).getByText("Result published")).toBeTruthy();
		fireEvent.click(within(dialog).getByRole("button", { name: "Load more" }));
		expect(await within(dialog).findByText("run-older")).toBeTruthy();
		expect(
			vi
				.mocked(fetch)
				.mock.calls.some(
					([resource, init]) =>
						resolveRequestRoute(resource, init) ===
						`GET ${window.location.origin}${runsPath}?beforeScheduledFor=${cursor}&limit=5`
				)
		).toBe(true);
	});

	it("renders pre-epoch quarantine evidence and paginates with a signed cursor", async () => {
		const routine = buildRoutine({
			canManage: false,
			id: "routine-quarantine",
		});
		const runsPath = `${ROUTINES_PATH}/routine-quarantine/runs`;
		const quarantineRuns = Array.from({ length: 5 }, (_, index) => ({
			failureCode: "routine.schedule_invalid",
			failureDetail: "The stored schedule is outside the supported horizon.",
			finishedAtMs: 1_752_300_020_000 + index,
			id: `run-quarantine-${index}`,
			nativeDeliveryId: null,
			organizationId: ORGANIZATION_ID,
			publishedSignalId: null,
			routineId: routine.id,
			scheduledFor: -100_000 * (index + 1),
			startedAtMs: 1_752_300_001_000 + index,
			status: "skipped" as const,
		}));
		const cursor = quarantineRuns.at(-1)?.scheduledFor;
		vi.stubGlobal(
			"fetch",
			createRouteFetch(
				new Map([
					[
						`GET ${window.location.origin}${ROUTINES_PATH}`,
						() =>
							jsonResponse({
								currentUserId: "user-1",
								organizationId: ORGANIZATION_ID,
								routines: [routine],
							}),
					],
					[
						`GET ${window.location.origin}${runsPath}?limit=5`,
						() =>
							jsonResponse({
								organizationId: ORGANIZATION_ID,
								routineId: routine.id,
								runs: quarantineRuns,
							}),
					],
					[
						`GET ${window.location.origin}${runsPath}?beforeScheduledFor=${cursor}&limit=5`,
						() =>
							jsonResponse({
								organizationId: ORGANIZATION_ID,
								routineId: routine.id,
								runs: [],
							}),
					],
				])
			)
		);

		render(
			<TestQueryClientProvider>
				<CenterAgentRoutinesPanel
					organizationId={ORGANIZATION_ID}
					orgSlug="acme"
				/>
			</TestQueryClientProvider>
		);
		fireEvent.click(
			await screen.findByRole("button", {
				name: `View runs for ${routine.name}`,
			})
		);
		const dialog = await screen.findByRole("dialog", {
			name: `Runs for ${routine.name}`,
		});
		await within(dialog).findAllByText(
			"The stored schedule is outside the supported horizon."
		);
		expect(
			dialog.querySelector('time[datetime="1969-12-31T23:58:20.000Z"]')
		).not.toBeNull();
		fireEvent.click(within(dialog).getByRole("button", { name: "Load more" }));
		await waitFor(() => {
			expect(
				vi
					.mocked(fetch)
					.mock.calls.some(
						([resource, init]) =>
							resolveRequestRoute(resource, init) ===
							`GET ${window.location.origin}${runsPath}?beforeScheduledFor=${cursor}&limit=5`
					)
			).toBe(true);
		});
	});

	it("keeps invalid schedules and missing target Spaces actionable", async () => {
		vi.stubGlobal(
			"fetch",
			createRouteFetch(
				new Map([
					[
						`GET ${window.location.origin}${ROUTINES_PATH}`,
						() =>
							jsonResponse({
								currentUserId: "user-1",
								organizationId: ORGANIZATION_ID,
								routines: [],
							}),
					],
					[
						`POST ${window.location.origin}${CENTER_AGENT_DM_PATH}`,
						() => centerAgentDirectMessageResponse(),
					],
					[
						`GET ${window.location.origin}${ROUTINE_TARGET_SPACES_PATH}`,
						() =>
							jsonResponse({
								organizationId: ORGANIZATION_ID,
								spaces: [],
							}),
					],
				])
			)
		);
		render(
			<TestQueryClientProvider>
				<CenterAgentRoutinesPanel
					organizationId={ORGANIZATION_ID}
					orgSlug="acme"
				/>
			</TestQueryClientProvider>
		);
		fireEvent.click(
			await screen.findByRole("button", { name: "Create routine" })
		);
		const dialog = await screen.findByRole("dialog", {
			name: "Create routine",
		});
		expect(
			await within(dialog).findByText(
				"No eligible target Spaces are available. Create or join a Space where the Center Agent can publish, then try again."
			)
		).toBeTruthy();
		expect(
			within(dialog)
				.getByRole("link", { name: "Go to Spaces" })
				.getAttribute("href")
		).toBe("/o/acme/spaces");
		fireEvent.change(within(dialog).getByLabelText("Schedule"), {
			target: { value: "* * * * *" },
		});
		fireEvent.blur(within(dialog).getByLabelText("Schedule"));
		expect(
			within(dialog).getByText(
				"Routine schedules must be at least 5 minutes apart."
			)
		).toBeTruthy();
		const submitButton = within(dialog).getByRole("button", {
			name: "Create routine",
		}) as HTMLButtonElement;
		expect(submitButton.disabled).toBe(false);
		expect(submitButton.getAttribute("aria-disabled")).toBe("true");
	});

	it("retries a failed list read and preserves the stable error context", async () => {
		let listAvailable = false;
		vi.stubGlobal(
			"fetch",
			createRouteFetch(
				new Map([
					[
						`GET ${window.location.origin}${ROUTINES_PATH}`,
						() =>
							listAvailable
								? jsonResponse({
										currentUserId: "user-1",
										organizationId: ORGANIZATION_ID,
										routines: [],
									})
								: jsonResponse(
										{
											ok: false,
											error: {
												code: "routine.store_unavailable",
												message: "Routine store unavailable.",
												requestId: "req-routines",
												upstreamCode: "routine.store_unavailable",
											},
										},
										503
									),
					],
				])
			)
		);
		render(
			<TestQueryClientProvider>
				<CenterAgentRoutinesPanel
					organizationId={ORGANIZATION_ID}
					orgSlug="acme"
				/>
			</TestQueryClientProvider>
		);
		expect(
			await screen.findByRole("heading", { name: "Could not load routines" })
		).toBeTruthy();
		expect(screen.getByRole("alert").textContent).toContain(
			"Error code: routine.store_unavailable. Request ID: req-routines."
		);
		listAvailable = true;
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(
			await screen.findByRole("heading", { name: "No routines yet" })
		).toBeTruthy();
	});

	it("resumes a paused manageable routine through the dedicated API", async () => {
		const routine = buildRoutine({
			id: "routine-paused",
			nextDueAt: null,
			status: "paused",
		});
		vi.stubGlobal(
			"fetch",
			createRouteFetch(
				new Map([
					[
						`GET ${window.location.origin}${ROUTINES_PATH}`,
						() =>
							jsonResponse({
								currentUserId: "user-1",
								organizationId: ORGANIZATION_ID,
								routines: [routine],
							}),
					],
					[
						`POST ${window.location.origin}${ROUTINES_PATH}/routine-paused/resume`,
						() =>
							jsonResponse({
								routine: projectPracticalRoutine({
									...routine,
									nextDueAt: 1,
									status: "enabled",
								}),
							}),
					],
				])
			)
		);
		render(
			<TestQueryClientProvider>
				<CenterAgentRoutinesPanel
					organizationId={ORGANIZATION_ID}
					orgSlug="acme"
				/>
			</TestQueryClientProvider>
		);
		fireEvent.click(
			await screen.findByRole("switch", { name: `Resume ${routine.name}` })
		);
		await waitFor(() => {
			expect(
				vi
					.mocked(fetch)
					.mock.calls.some(
						([resource, init]) =>
							resolveRequestRoute(resource, init) ===
							`POST ${window.location.origin}${ROUTINES_PATH}/routine-paused/resume`
					)
			).toBe(true);
		});
	});

	it("keys owner truth by organization and closes stale dialogs when the organization changes", async () => {
		let activeOrganizationId = "org-1";
		vi.stubGlobal(
			"fetch",
			createRouteFetch(
				new Map([
					[
						`GET ${window.location.origin}${ROUTINES_PATH}`,
						() =>
							jsonResponse({
								currentUserId: "user-1",
								organizationId: activeOrganizationId,
								routines: [
									buildRoutine({
										id: `routine-${activeOrganizationId}`,
										name:
											activeOrganizationId === "org-1"
												? "Org one routine"
												: "Org two routine",
										organizationId: activeOrganizationId,
									}),
								],
							}),
					],
				])
			)
		);
		const queryClient = createTestQueryClient();
		const view = render(
			<TestQueryClientProvider queryClient={queryClient}>
				<CenterAgentRoutinesPanel organizationId="org-1" orgSlug="one" />
			</TestQueryClientProvider>
		);
		await screen.findByText("Org one routine");
		fireEvent.click(screen.getByRole("button", { name: "Create routine" }));
		expect(
			await screen.findByRole("dialog", { name: "Create routine" })
		).toBeTruthy();
		activeOrganizationId = "org-2";
		view.rerender(
			<TestQueryClientProvider queryClient={queryClient}>
				<CenterAgentRoutinesPanel organizationId="org-2" orgSlug="two" />
			</TestQueryClientProvider>
		);
		expect(await screen.findByText("Org two routine")).toBeTruthy();
		expect(screen.queryByRole("dialog", { name: "Create routine" })).toBeNull();
		expect(screen.queryByText("Org one routine")).toBeNull();
	});

	it("fails closed when the Routine list response belongs to another organization", async () => {
		vi.stubGlobal(
			"fetch",
			createRouteFetch(
				new Map([
					[
						`GET ${window.location.origin}${ROUTINES_PATH}`,
						() =>
							jsonResponse({
								currentUserId: "user-1",
								organizationId: "org-other",
								routines: [],
							}),
					],
				])
			)
		);

		render(
			<TestQueryClientProvider>
				<CenterAgentRoutinesPanel
					organizationId={ORGANIZATION_ID}
					orgSlug="acme"
				/>
			</TestQueryClientProvider>
		);

		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toContain(
			"Error code: gateway.invalid_response."
		);
		expect(alert.textContent).toContain(
			"Routine list identity mismatch: expected organization org-1, received org-other."
		);
		expect(
			screen.queryByRole("heading", { name: "No routines yet" })
		).toBeNull();
	});

	it("fails closed when a Runs response belongs to another routine", async () => {
		const routine = buildRoutine({ canManage: false, id: "routine-history" });
		const runsPath = `${ROUTINES_PATH}/${routine.id}/runs`;
		vi.stubGlobal(
			"fetch",
			createRouteFetch(
				new Map([
					[
						`GET ${window.location.origin}${ROUTINES_PATH}`,
						() =>
							jsonResponse({
								currentUserId: "user-1",
								organizationId: ORGANIZATION_ID,
								routines: [routine],
							}),
					],
					[
						`GET ${window.location.origin}${runsPath}?limit=5`,
						() =>
							jsonResponse({
								organizationId: ORGANIZATION_ID,
								routineId: "routine-other",
								runs: [],
							}),
					],
				])
			)
		);

		render(
			<TestQueryClientProvider>
				<CenterAgentRoutinesPanel
					organizationId={ORGANIZATION_ID}
					orgSlug="acme"
				/>
			</TestQueryClientProvider>
		);
		fireEvent.click(
			await screen.findByRole("button", {
				name: `View runs for ${routine.name}`,
			})
		);
		const dialog = await screen.findByRole("dialog", {
			name: `Runs for ${routine.name}`,
		});
		const alert = await within(dialog).findByRole("alert");
		expect(alert.textContent).toContain(
			"Error code: gateway.invalid_response."
		);
		expect(alert.textContent).toContain(
			"Routine runs identity mismatch: expected routine routine-history, received routine-other."
		);
		expect(within(dialog).queryByText("No runs yet.")).toBeNull();
	});

	it("keeps a delayed old-organization response out of the active organization view", async () => {
		let activeOrganizationId = "org-1";
		let resolveOrgOne: ((response: Response) => void) | undefined;
		vi.stubGlobal(
			"fetch",
			createRouteFetch(
				new Map([
					[
						`GET ${window.location.origin}${ROUTINES_PATH}`,
						() => {
							if (activeOrganizationId === "org-1") {
								return new Promise<Response>((resolve) => {
									resolveOrgOne = resolve;
								});
							}
							return jsonResponse({
								currentUserId: "user-1",
								organizationId: "org-2",
								routines: [
									buildRoutine({
										id: "routine-org-2",
										name: "Org two routine",
										organizationId: "org-2",
									}),
								],
							});
						},
					],
				])
			)
		);
		const queryClient = createTestQueryClient();
		const view = render(
			<TestQueryClientProvider queryClient={queryClient}>
				<CenterAgentRoutinesPanel organizationId="org-1" orgSlug="one" />
			</TestQueryClientProvider>
		);
		await waitFor(() => {
			expect(resolveOrgOne).toBeTypeOf("function");
		});

		activeOrganizationId = "org-2";
		view.rerender(
			<TestQueryClientProvider queryClient={queryClient}>
				<CenterAgentRoutinesPanel organizationId="org-2" orgSlug="two" />
			</TestQueryClientProvider>
		);
		expect(await screen.findByText("Org two routine")).toBeTruthy();

		resolveOrgOne?.(
			jsonResponse({
				currentUserId: "user-1",
				organizationId: "org-1",
				routines: [
					buildRoutine({
						id: "routine-org-1",
						name: "Org one late routine",
						organizationId: "org-1",
					}),
				],
			})
		);
		await waitFor(() => {
			expect(screen.getByText("Org two routine")).toBeTruthy();
			expect(screen.queryByText("Org one late routine")).toBeNull();
		});
	});

	it("shows an honest loading state while the Routine owner read is pending", () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(() => new Promise<Response>(() => undefined)) as typeof fetch
		);
		render(
			<TestQueryClientProvider>
				<CenterAgentRoutinesPanel
					organizationId={ORGANIZATION_ID}
					orgSlug="acme"
				/>
			</TestQueryClientProvider>
		);
		expect(screen.getByText("Loading routines.")).toBeTruthy();
	});

	it("keeps owner truth unchanged when pause or delete is rejected", async () => {
		const routine = buildRoutine({ id: "routine-rejected" });
		const detailPath = `${ROUTINES_PATH}/routine-rejected`;
		const rejectedResponse = (
			code: "routine.forbidden" | "routine.status_conflict"
		) =>
			jsonResponse(
				{
					error: {
						code,
						message: "Routine mutation rejected.",
						requestId: `req-${code}`,
					},
					ok: false,
				},
				code === "routine.forbidden" ? 403 : 409
			);
		vi.stubGlobal(
			"fetch",
			createRouteFetch(
				new Map([
					[
						`GET ${window.location.origin}${ROUTINES_PATH}`,
						() =>
							jsonResponse({
								currentUserId: "user-1",
								organizationId: ORGANIZATION_ID,
								routines: [routine],
							}),
					],
					[
						`POST ${window.location.origin}${detailPath}/pause`,
						() => rejectedResponse("routine.status_conflict"),
					],
					[
						`DELETE ${window.location.origin}${detailPath}`,
						() => rejectedResponse("routine.forbidden"),
					],
				])
			)
		);
		render(
			<TestQueryClientProvider>
				<CenterAgentRoutinesPanel
					organizationId={ORGANIZATION_ID}
					orgSlug="acme"
				/>
			</TestQueryClientProvider>
		);
		const switchControl = await screen.findByRole("switch", {
			name: `Pause ${routine.name}`,
		});
		fireEvent.click(switchControl);
		expect(await screen.findByText(STATUS_CONFLICT_PATTERN)).toBeTruthy();
		expect(switchControl.getAttribute("aria-checked")).toBe("true");

		fireEvent.click(
			screen.getByRole("button", { name: `Delete ${routine.name}` })
		);
		const dialog = await screen.findByRole("dialog", {
			name: `Delete ${routine.name}?`,
		});
		fireEvent.click(
			within(dialog).getByRole("button", { name: "Delete routine" })
		);
		expect(await within(dialog).findByText(FORBIDDEN_PATTERN)).toBeTruthy();
		expect(screen.getByText(routine.name)).toBeTruthy();
	});
});

function resolveListRunFailureDetail(
	status: CenterAgentRoutineRunStatus
): string | null {
	if (status === "failed") {
		return "The Center Agent could not finish this run.";
	}
	if (status === "skipped") {
		return "Skipped 3 occurrences while scheduling was unavailable.";
	}
	return null;
}

function resolveHistoryRunFailureDetail(
	status: CenterAgentRoutineRunStatus
): string | null {
	if (status === "failed") {
		return "The hosted turn failed before publication.";
	}
	if (status === "skipped") {
		return "Skipped 3 occurrences from Monday through Wednesday.";
	}
	return null;
}

function stubRoutineResponse(routines: CenterAgentRoutineManagement[]): void {
	vi.stubGlobal(
		"fetch",
		createRouteFetch(
			new Map([
				[
					`GET ${window.location.origin}${ROUTINES_PATH}`,
					() =>
						jsonResponse({
							currentUserId: "user-1",
							organizationId: ORGANIZATION_ID,
							routines,
						}),
				],
			])
		)
	);
}

function buildRoutine(
	input: Partial<CenterAgentRoutineManagement> &
		Pick<CenterAgentRoutineManagement, "id">
): CenterAgentRoutineManagement {
	return {
		canManage: true,
		capabilityState: {
			approvedKnowledge: false,
			canRepair: true,
			externalActionPolicy: "standard",
			slackChannelReport: false,
		},
		createdAtMs: 1_752_200_000_000,
		createdByUserId: "user-1",
		creationAttribution: { displayName: "Current User" },
		cronExpression: "0 9 * * *",
		destinationKind: "space",
		instructions: "Review new Feedback Inbox issues and summarize the work.",
		lastRun: null,
		name: "Daily feedback review",
		nextDueAt: 1_752_400_000_000,
		organizationId: ORGANIZATION_ID,
		runAtMs: null,
		scheduleKind: "cron",
		slackChannelId: null,
		slackConversationId: null,
		slackTeamId: null,
		slackThreadLabel: null,
		slackThreadTs: null,
		status: "enabled",
		targetSpaceId: "space-1",
		timezone: "America/Los_Angeles",
		updatedAtMs: 1_752_200_000_000,
		updatedByUserId: "user-1",
		...input,
	};
}

function projectPracticalRoutine(
	routine: CenterAgentRoutineManagement
): CenterAgentRoutine {
	const {
		capabilityState: _capabilityState,
		creationAttribution: _creationAttribution,
		...practicalRoutine
	} = routine;
	return practicalRoutine;
}

function buildTargetSpace() {
	return {
		kind: "space" as const,
		name: "Feedback triage",
		spaceId: "space-1",
	};
}

function centerAgentDirectMessageResponse(): Response {
	return jsonResponse({
		centerAgentProfileId: "agt_11111111-1111-4111-8111-111111111111",
		created: false,
		memberProfileId: "22222222-2222-4222-8222-222222222222",
		organizationId: ORGANIZATION_ID,
		spaceId: "space-ca-dm",
	});
}

function createRouteFetch(
	routes: Map<string, () => Promise<Response> | Response>
): typeof fetch {
	return vi.fn(async (resource: URL | RequestInfo, init?: RequestInit) => {
		const route = resolveRequestRoute(resource, init);
		const createResponse = routes.get(route);
		if (!createResponse) {
			throw new Error(`Unexpected Web API request: ${route}`);
		}
		const response = await createResponse();
		return route === `GET ${window.location.origin}${ROUTINES_PATH}`
			? await projectRoutineManagementListResponse(response)
			: response;
	});
}

async function projectRoutineManagementListResponse(
	response: Response
): Promise<Response> {
	if (!response.ok) {
		return response;
	}
	const body = (await response.json()) as {
		currentUserId: string;
		organizationId: string;
		routines: CenterAgentRoutineManagement[];
	};
	return jsonResponse(
		{
			...body,
			routines: body.routines.map((routine) => ({
				...routine,
				capabilityState: {
					approvedKnowledge: false,
					canRepair: true,
					externalActionPolicy: "standard",
					slackChannelReport: false,
				},
			})),
		},
		response.status
	);
}

function resolveRequestRoute(
	resource: URL | RequestInfo,
	init?: RequestInit
): string {
	const method =
		init?.method ?? (resource instanceof Request ? resource.method : "GET");
	const requestUrl = new URL(
		resource instanceof Request ? resource.url : String(resource)
	);
	if (
		requestUrl.pathname === ROUTINES_PATH ||
		requestUrl.pathname.startsWith(`${ROUTINES_PATH}/`)
	) {
		const contracts = requestUrl.searchParams.getAll("contract");
		const expectedContract =
			method === "GET" && requestUrl.pathname === ROUTINES_PATH
				? ROUTINES_MANAGEMENT_CONTRACT
				: ROUTINES_PRACTICAL_CONTRACT;
		if (contracts.length !== 1 || contracts[0] !== expectedContract) {
			throw new Error(
				`Routine request must opt into the ${expectedContract} contract.`
			);
		}
		requestUrl.searchParams.delete("contract");
	}
	return `${method} ${requestUrl.toString()}`;
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		headers: { "content-type": "application/json" },
		status,
	});
}
