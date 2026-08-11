import {
	type RoutineSchedule,
	RoutineScheduleValidationError,
} from "@openmeld/routine-schedule";
import type { CenterAgentRoutineManagement } from "@openmeld/schemas/types";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestQueryClientProvider } from "#/test-support/query-client";
import {
	CenterAgentRoutineFormDialog,
	type CenterAgentRoutineFormValues,
} from "./center-agent-routine-form-dialog";
import {
	buildCenterAgentSelfEvolutionRoutineBody,
	CENTER_AGENT_SELF_EVOLUTION_DEFAULT_FOCUS,
} from "./center-agent-self-evolution";

const ORGANIZATION_ID = "org-1";
const OWNER_ADMIN_REPAIR_PATTERN =
	/owner or admin must repair Self-Evolution permissions/i;
const TARGET_SPACES_URL = `${window.location.origin}/v1/organizations/current/routine-target-spaces`;

describe("CenterAgentRoutineFormDialog", () => {
	beforeEach(() => {
		vi.stubGlobal(
			"fetch",
			vi.fn((resource: URL | RequestInfo, init?: RequestInit) => {
				const method =
					init?.method ??
					(resource instanceof Request ? resource.method : "GET");
				const url =
					resource instanceof Request ? resource.url : String(resource);
				if (`${method} ${url}` !== `GET ${TARGET_SPACES_URL}`) {
					throw new Error(`Unexpected Web API request: ${method} ${url}`);
				}
				return Promise.resolve(
					Response.json({
						organizationId: ORGANIZATION_ID,
						spaces: [
							{
								kind: "space",
								name: "Feedback triage",
								spaceId: "space-1",
							},
						],
					})
				);
			}) as typeof fetch
		);
	});

	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

	it("keeps full schedule admission off the typing hot path and runs it on blur", async () => {
		const validateSchedule = vi.fn((schedule: RoutineSchedule) => schedule);
		renderDialog({ validateSchedule });
		const dialog = await screen.findByRole("dialog", {
			name: "Edit Daily feedback review",
		});
		const scheduleInput = within(dialog).getByLabelText("Schedule");

		for (const value of ["0", "0 9", "0 9 *", "0 9 * *", "0 9 * * *"]) {
			fireEvent.change(scheduleInput, { target: { value } });
		}

		expect(validateSchedule).not.toHaveBeenCalled();
		fireEvent.blur(scheduleInput);
		expect(validateSchedule).toHaveBeenCalledTimes(1);
		expect(validateSchedule).toHaveBeenCalledWith({
			cronExpression: "0 9 * * *",
			timezone: "America/Los_Angeles",
		});
	});

	it("assigns invalid timezone feedback to Timezone without marking Schedule invalid", async () => {
		const onOpenChange = vi.fn();
		renderDialog({ onOpenChange });
		const dialog = await screen.findByRole("dialog", {
			name: "Edit Daily feedback review",
		});
		const scheduleInput = within(dialog).getByLabelText("Schedule");
		const timezoneInput = within(dialog).getByLabelText("Timezone");

		fireEvent.change(timezoneInput, { target: { value: "Los Angeles" } });

		expect(timezoneInput.getAttribute("aria-invalid")).toBe("true");
		expect(timezoneInput.getAttribute("aria-errormessage")).toBe(
			"routine-timezone-error"
		);
		expect(scheduleInput.getAttribute("aria-invalid")).toBe("false");
		expect(
			within(dialog).getByText(
				"Timezone must be an explicit IANA timezone, such as America/Los_Angeles."
			)
		).toBeTruthy();

		fireEvent.keyDown(dialog, { key: "Escape" });
		await waitFor(() => {
			expect(onOpenChange).toHaveBeenCalled();
			expect(onOpenChange.mock.calls.at(-1)?.[0]).toBe(false);
		});
	});

	it("catches too-frequent admission on submit and focuses the Schedule error", async () => {
		const onSubmit = vi.fn();
		const validateSchedule = vi.fn(() => {
			throw new RoutineScheduleValidationError(
				"routine.schedule.too_frequent",
				"Routine schedules must be at least 5 minutes apart."
			);
		});
		renderDialog({ onSubmit, validateSchedule });
		const dialog = await screen.findByRole("dialog", {
			name: "Edit Daily feedback review",
		});
		const scheduleInput = within(dialog).getByLabelText("Schedule");
		fireEvent.change(scheduleInput, { target: { value: "* * * * *" } });
		const submitButton = within(dialog).getByRole("button", {
			name: "Save changes",
		});

		expect(submitButton.getAttribute("aria-disabled")).toBe("false");
		fireEvent.click(submitButton);

		expect(onSubmit).not.toHaveBeenCalled();
		expect(validateSchedule).toHaveBeenCalledTimes(1);
		expect(scheduleInput.getAttribute("aria-invalid")).toBe("true");
		expect(scheduleInput.getAttribute("aria-errormessage")).toBe(
			"routine-schedule-error"
		);
		const error = within(dialog).getByText(
			"Routine schedules must be at least 5 minutes apart."
		);
		expect(error.getAttribute("tabindex")).toBe("-1");
		expect(document.activeElement).toBe(scheduleInput);
	});

	it("submits a one-time Routine with only its run time", async () => {
		const onSubmit = vi.fn();
		renderDialog({ onSubmit });
		const dialog = await screen.findByRole("dialog", {
			name: "Edit Daily feedback review",
		});
		fireEvent.click(within(dialog).getByRole("button", { name: "Once" }));
		const runAtInput = within(dialog).getByLabelText("Run at");
		fireEvent.change(runAtInput, { target: { value: "2030-01-02T03:04" } });

		const submitButton = within(dialog).getByRole("button", {
			name: "Save changes",
		});
		await waitFor(() => {
			expect(submitButton.getAttribute("aria-disabled")).toBe("false");
		});
		fireEvent.click(submitButton);

		expect(onSubmit).toHaveBeenCalledWith({
			cronExpression: null,
			destinationKind: "space",
			instructions: "Review new Feedback Inbox issues.",
			name: "Daily feedback review",
			postSlackSummary: false,
			runAtMs: new Date("2030-01-02T03:04").getTime(),
			scheduleKind: "once",
			slackChannelId: null,
			slackConversationId: null,
			slackReportChannelName: "",
			slackTeamId: null,
			slackThreadLabel: null,
			slackThreadTs: null,
			targetSpaceId: "space-1",
			timezone: null,
		});
	});

	it("changes the Self-Evolution Slack channel without rewriting permissions", async () => {
		const onSubmit = vi.fn();
		renderDialog({ onSubmit, routine: buildSelfEvolutionRoutine() });
		const dialog = await screen.findByRole("dialog", {
			name: "Edit Center Agent Self-Evolution",
		});
		expect(
			await within(dialog).findByRole("combobox", { name: "Learning archive" })
		).toBeTruthy();
		expect(
			within(dialog).getByLabelText("Post a concise summary to Slack")
		).toHaveProperty("checked", true);
		const channelInput = within(dialog).getByLabelText("Slack channel");
		expect(channelInput).toHaveProperty("value", "reply-team");

		fireEvent.change(channelInput, {
			target: { value: "#reply-updates" },
		});
		const submitButton = within(dialog).getByRole("button", {
			name: "Save changes",
		});
		await waitFor(() => {
			expect(submitButton.getAttribute("aria-disabled")).toBe("false");
		});
		fireEvent.click(submitButton);

		expect(onSubmit).toHaveBeenCalledWith(
			expect.objectContaining({
				instructions: expect.stringContaining(
					"Slack team report: #reply-updates"
				),
				postSlackSummary: true,
				slackReportChannelName: "#reply-updates",
				targetSpaceId: "space-1",
			})
		);
		const submitted = onSubmit.mock.calls[0]?.[0];
		expect(submitted).not.toHaveProperty("authorizedActions");
		expect(submitted).not.toHaveProperty("externalActionPolicy");
	});

	it("preserves hidden Self-Evolution permissions during an ordinary edit", async () => {
		const onSubmit = vi.fn();
		renderDialog({ onSubmit, routine: buildSelfEvolutionRoutine() });
		const dialog = await screen.findByRole("dialog", {
			name: "Edit Center Agent Self-Evolution",
		});

		fireEvent.change(within(dialog).getByLabelText("Schedule"), {
			target: { value: "30 9 * * *" },
		});
		fireEvent.click(
			within(dialog).getByRole("button", { name: "Save changes" })
		);

		expect(onSubmit).toHaveBeenCalledOnce();
		const submitted = onSubmit.mock.calls[0]?.[0];
		expect(submitted).not.toHaveProperty("authorizedActions");
		expect(submitted).not.toHaveProperty("externalActionPolicy");
	});

	it("repairs Self-Evolution permissions only after explicit confirmation", async () => {
		const onSubmit = vi.fn();
		renderDialog({
			onSubmit,
			routine: {
				...buildSelfEvolutionRoutine(),
				capabilityState: {
					approvedKnowledge: false,
					canRepair: true,
					externalActionPolicy: "standard",
					slackChannelReport: false,
				},
			},
		});
		const dialog = await screen.findByRole("dialog", {
			name: "Edit Center Agent Self-Evolution",
		});
		fireEvent.click(
			within(dialog).getByLabelText(
				"Repair Self-Evolution permissions when saving"
			)
		);
		fireEvent.click(
			within(dialog).getByRole("button", { name: "Save changes" })
		);

		expect(onSubmit).toHaveBeenCalledWith(
			expect.objectContaining({
				authorizedActions: [
					"organization_documents.save_approved_knowledge",
					"slack.publish_channel_report",
				],
				externalActionPolicy: "read_only",
			})
		);
	});

	it("writes capabilities when the Slack report choice explicitly changes", async () => {
		const onSubmit = vi.fn();
		renderDialog({ onSubmit, routine: buildSelfEvolutionRoutine() });
		const dialog = await screen.findByRole("dialog", {
			name: "Edit Center Agent Self-Evolution",
		});
		fireEvent.click(
			within(dialog).getByLabelText("Post a concise summary to Slack")
		);
		fireEvent.click(
			within(dialog).getByRole("button", { name: "Save changes" })
		);

		expect(onSubmit).toHaveBeenCalledWith(
			expect.objectContaining({
				authorizedActions: ["organization_documents.save_approved_knowledge"],
				externalActionPolicy: "read_only",
				postSlackSummary: false,
			})
		);
	});

	it("keeps a Slack capability change after a repair choice is canceled", async () => {
		const onSubmit = vi.fn();
		renderDialog({
			onSubmit,
			routine: {
				...buildSelfEvolutionRoutine(),
				capabilityState: {
					approvedKnowledge: false,
					canRepair: true,
					externalActionPolicy: "standard",
					slackChannelReport: false,
				},
			},
		});
		const dialog = await screen.findByRole("dialog", {
			name: "Edit Center Agent Self-Evolution",
		});
		fireEvent.click(
			within(dialog).getByLabelText("Post a concise summary to Slack")
		);
		const repairCheckbox = within(dialog).getByLabelText(
			"Repair Self-Evolution permissions when saving"
		);
		fireEvent.click(repairCheckbox);
		fireEvent.click(repairCheckbox);
		fireEvent.click(
			within(dialog).getByRole("button", { name: "Save changes" })
		);

		expect(onSubmit).toHaveBeenCalledWith(
			expect.objectContaining({
				authorizedActions: ["organization_documents.save_approved_knowledge"],
				externalActionPolicy: "read_only",
				postSlackSummary: false,
			})
		);
	});

	it("omits capabilities when the Slack report choice returns to its initial value", async () => {
		const onSubmit = vi.fn();
		renderDialog({ onSubmit, routine: buildSelfEvolutionRoutine() });
		const dialog = await screen.findByRole("dialog", {
			name: "Edit Center Agent Self-Evolution",
		});
		const slackReportCheckbox = within(dialog).getByLabelText(
			"Post a concise summary to Slack"
		);
		fireEvent.click(slackReportCheckbox);
		fireEvent.click(slackReportCheckbox);
		fireEvent.change(within(dialog).getByLabelText("Schedule"), {
			target: { value: "30 9 * * *" },
		});
		fireEvent.click(
			within(dialog).getByRole("button", { name: "Save changes" })
		);

		expect(onSubmit).toHaveBeenCalledOnce();
		const submitted = onSubmit.mock.calls[0]?.[0];
		expect(submitted).not.toHaveProperty("authorizedActions");
		expect(submitted).not.toHaveProperty("externalActionPolicy");
	});

	it("blocks capability repair when the owner projection denies it", async () => {
		renderDialog({
			routine: {
				...buildSelfEvolutionRoutine(),
				capabilityState: {
					approvedKnowledge: false,
					canRepair: false,
					externalActionPolicy: "standard",
					slackChannelReport: false,
				},
			},
		});
		const dialog = await screen.findByRole("dialog", {
			name: "Edit Center Agent Self-Evolution",
		});

		expect(within(dialog).getByText(OWNER_ADMIN_REPAIR_PATTERN)).toBeTruthy();
		expect(
			within(dialog).queryByLabelText(
				"Repair Self-Evolution permissions when saving"
			)
		).toBeNull();
		expect(
			within(dialog).getByLabelText("Post a concise summary to Slack")
		).toHaveProperty("disabled", true);
		expect(within(dialog).getByLabelText("Slack channel")).toHaveProperty(
			"disabled",
			false
		);
	});
});

function renderDialog(
	input: {
		onOpenChange?: (open: boolean) => void;
		onSubmit?: (values: CenterAgentRoutineFormValues) => void;
		routine?: CenterAgentRoutineManagement;
		validateSchedule?: (schedule: RoutineSchedule) => RoutineSchedule;
	} = {}
) {
	return render(
		<TestQueryClientProvider>
			<CenterAgentRoutineFormDialog
				errorMessage={null}
				mode="edit"
				onOpenChange={input.onOpenChange ?? vi.fn()}
				onSubmit={input.onSubmit ?? vi.fn()}
				open
				organizationId={ORGANIZATION_ID}
				orgSlug="acme"
				routine={input.routine ?? buildRoutine()}
				submitting={false}
				targetSpacePreparation={{
					errorMessage: null,
					isPending: false,
					isReady: true,
					onRetry: vi.fn(),
				}}
				validateSchedule={input.validateSchedule}
			/>
		</TestQueryClientProvider>
	);
}

function buildSelfEvolutionRoutine(): CenterAgentRoutineManagement {
	const body = buildCenterAgentSelfEvolutionRoutineBody({
		cronExpression: "0 9 * * *",
		focus: CENTER_AGENT_SELF_EVOLUTION_DEFAULT_FOCUS,
		project: {
			id: "project-reply",
			name: "Reply",
			slug: "reply",
		},
		slackReportChannelName: "reply-team",
		sources: [
			{
				connectionId: "slack-connection-1",
				id: "slack:slack-connection-1",
				kind: "slack",
				label: "Slack · OpenMeld",
			},
		],
		targetSpaceId: "space-1",
		timezone: "America/Los_Angeles",
	});
	return {
		...buildRoutine(),
		...body,
		capabilityState: {
			approvedKnowledge: true,
			canRepair: true,
			externalActionPolicy: "read_only",
			slackChannelReport: true,
		},
		id: "routine-self-evolution",
	};
}

function buildRoutine(): CenterAgentRoutineManagement {
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
		cronExpression: "0 9 * * *",
		destinationKind: "space",
		id: "routine-1",
		instructions: "Review new Feedback Inbox issues.",
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
	};
}
