import type { OrganizationDirectoryResponse } from "@openmeld/schemas/types";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import { buildRemoteCenterAgentReadiness } from "#/test-support/center-agent-readiness";
import {
	createTestQueryClient,
	TestQueryClientProvider,
} from "#/test-support/query-client";
import { CenterAgentSettingsContent } from "./center-agent-settings-page";

const designateCurrentCenterAgentMock = vi.hoisted(() => vi.fn());
const listCurrentCenterAgentAuditJournalMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());
const openCurrentCenterAgentDirectMessageSpaceMock = vi.hoisted(() => vi.fn());
const readCurrentCenterAgentDesignationMock = vi.hoisted(() => vi.fn());
const readCurrentCenterAgentModelMock = vi.hoisted(() => vi.fn());
const readCurrentCenterAgentOperatingStateMock = vi.hoisted(() => vi.fn());
const readCurrentOrganizationUsageOverviewMock = vi.hoisted(() => vi.fn());
const updateCurrentCenterAgentOperatingStateMock = vi.hoisted(() => vi.fn());
const updateCurrentCenterAgentModelMock = vi.hoisted(() => vi.fn());
const updateCurrentCenterAgentProfileMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => navigateMock,
}));

vi.mock("sonner", () => ({
	toast: { success: toastSuccessMock },
}));

vi.mock("#/lib/organizations/center-agent", async () => {
	const actual = await vi.importActual<
		typeof import("#/lib/organizations/center-agent")
	>("#/lib/organizations/center-agent");
	return {
		...actual,
		designateCurrentCenterAgent: designateCurrentCenterAgentMock,
		listCurrentCenterAgentAuditJournal: listCurrentCenterAgentAuditJournalMock,
		openCurrentCenterAgentDirectMessageSpace:
			openCurrentCenterAgentDirectMessageSpaceMock,
		readCurrentCenterAgentDesignation: readCurrentCenterAgentDesignationMock,
		readCurrentCenterAgentModel: readCurrentCenterAgentModelMock,
		readCurrentCenterAgentOperatingState:
			readCurrentCenterAgentOperatingStateMock,
		updateCurrentCenterAgentModel: updateCurrentCenterAgentModelMock,
		updateCurrentCenterAgentOperatingState:
			updateCurrentCenterAgentOperatingStateMock,
		updateCurrentCenterAgentProfile: updateCurrentCenterAgentProfileMock,
	};
});

vi.mock("#/lib/organizations/organization-usage", () => ({
	readCurrentOrganizationUsageOverview:
		readCurrentOrganizationUsageOverviewMock,
}));

const ORGANIZATION_ID = "org-1";
const CENTER_AGENT_ID = "agt_11111111-1111-4111-8111-111111111111";

describe("CenterAgentSettingsContent", () => {
	beforeEach(() => {
		designateCurrentCenterAgentMock.mockReset().mockResolvedValue({
			designation: buildDesignation(),
			organizationId: ORGANIZATION_ID,
			status: "designated",
		});
		listCurrentCenterAgentAuditJournalMock.mockReset().mockResolvedValue({
			entries: [],
			organizationId: ORGANIZATION_ID,
		});
		navigateMock.mockReset().mockResolvedValue(undefined);
		openCurrentCenterAgentDirectMessageSpaceMock.mockReset().mockResolvedValue({
			centerAgentProfileId: CENTER_AGENT_ID,
			created: false,
			memberProfileId: "11111111-1111-4111-8111-111111111111",
			organizationId: ORGANIZATION_ID,
			spaceId: "space-dm-1",
		});
		readCurrentCenterAgentDesignationMock.mockReset().mockResolvedValue({
			designation: buildDesignation(),
			organizationId: ORGANIZATION_ID,
			remoteRuntimeAvailability: { selectable: true },
		});
		readCurrentCenterAgentOperatingStateMock.mockReset().mockResolvedValue({
			canChangeOperatingState: true,
			operatingState: "active",
			organizationId: ORGANIZATION_ID,
			pausedAt: null,
		});
		readCurrentCenterAgentModelMock
			.mockReset()
			.mockResolvedValue(buildModelConfiguration());
		readCurrentOrganizationUsageOverviewMock.mockReset().mockResolvedValue({
			centerAgentWakes: {
				dailyLimit: 200,
				resetsAt: "2026-07-17T00:00:00.000Z",
				usedToday: 12,
			},
			routines: { count: 7, limit: 50 },
		});
		updateCurrentCenterAgentOperatingStateMock.mockReset().mockResolvedValue({
			affectedTaskCount: 2,
			canChangeOperatingState: true,
			changed: true,
			operatingState: "paused",
			organizationId: ORGANIZATION_ID,
			pausedAt: "2026-07-29T00:00:00.000Z",
		});
		updateCurrentCenterAgentModelMock.mockReset().mockResolvedValue({
			...buildModelConfiguration({
				configurationRevision: 8,
				effectiveModel: {
					availability: "available",
					displayName: "DeepSeek V4 Flash",
					modelId: "deepseek/deepseek-v4-flash",
					supportsImageInput: false,
				},
				preference: {
					kind: "selected_model",
					modelId: "deepseek/deepseek-v4-flash",
				},
			}),
			changed: true,
		});
		updateCurrentCenterAgentProfileMock.mockReset().mockResolvedValue({
			organizationId: ORGANIZATION_ID,
			profile: {
				email: null,
				id: CENTER_AGENT_ID,
				image: null,
				name: "Operations Center Agent",
				profileHandle: "operations-center-agent",
				profileKind: "agent",
				profileName: "Operations Center Agent",
				updatedAt: "2026-07-13T12:00:00.000Z",
				openMeldProfileId: CENTER_AGENT_ID,
			},
		});
		toastSuccessMock.mockReset();
	});

	afterEach(cleanup);

	it("shows every section and the current model to a workspace member", async () => {
		renderSettings({ canManage: false });

		expect(
			await screen.findByRole("heading", { name: "Connection" })
		).toBeTruthy();
		expect(
			screen
				.getByTestId(`center-agent-profile-avatar-${CENTER_AGENT_ID}`)
				.querySelector("canvas")
				?.getAttribute("data-profile-avatar-seed")
		).toBe(`openmeld-dither-profile-avatar:v1:center-agent:${CENTER_AGENT_ID}`);
		expect(screen.getByRole("heading", { name: "Identity" })).toBeTruthy();
		expect(screen.getByRole("heading", { name: "Usage" })).toBeTruthy();
		expect(screen.getByRole("heading", { name: "Model" })).toBeTruthy();
		expect(
			screen.queryByText(
				"See which primary model the Center Agent uses for new work."
			)
		).toBeNull();
		expect(await screen.findByText("Grok 4.6")).toBeTruthy();
		expect(screen.getByText("New").getAttribute("data-slot")).toBe("badge");
		expect(screen.getByText("OpenMeld default")).toBeTruthy();
		const modelBehaviorTrigger = screen.getByRole("button", {
			name: "About Center Agent model behavior",
		});
		expect(modelBehaviorTrigger.className).toContain("max-lg:size-11");
		expect(
			screen.queryByText(
				"Handles images directly. New turns only. Doesn't switch on failure."
			)
		).toBeNull();
		fireEvent.focus(modelBehaviorTrigger);
		await waitFor(() => {
			expect(
				screen.getByText(
					"Handles images directly. New turns only. Doesn't switch on failure."
				)
			).toBeTruthy();
		});
		expect(
			screen.getByText(
				"Only organization owners and admins can change this setting."
			)
		).toBeTruthy();
		expect(
			screen.queryByRole("combobox", { name: "Primary model" })
		).toBeNull();
		expect(screen.getByText("12 / 200")).toBeTruthy();
		expect(screen.getByRole("heading", { name: "Audit Log" })).toBeTruthy();
		expect(
			screen.getByText(
				"Review Center Agent actions, Local Agent requests, and the context Local Agents reported loading."
			)
		).toBeTruthy();
		expect(screen.getByRole("heading", { name: "Danger zone" })).toBeTruthy();
		expect(screen.queryByText("claude-sonnet-4-5 · high")).toBeNull();
		expect(screen.getByLabelText("Display name")).toHaveProperty(
			"readOnly",
			true
		);
		expect(screen.queryByRole("button", { name: "Save name" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
		expect(
			screen.getByText(
				"Only the Organization creator can pause the Center Agent."
			)
		).toBeTruthy();
		await waitFor(() => {
			expect(listCurrentCenterAgentAuditJournalMock).toHaveBeenCalledTimes(1);
		});
	});

	it("shows catalog-owned model badges in the trigger and matching choices", async () => {
		renderSettings({ canManage: true });

		const trigger = await screen.findByRole("combobox", {
			name: "Primary model",
		});
		expect(within(trigger).getByText("New").getAttribute("data-slot")).toBe(
			"badge"
		);

		fireEvent.click(trigger);
		const defaultChoice = await screen.findByRole("option", {
			name: "OpenMeld default (Grok 4.6) New",
		});
		const grok46Choice = screen.getByRole("option", {
			name: "Grok 4.6 New",
		});
		expect(
			within(defaultChoice).getByText("New").getAttribute("data-slot")
		).toBe("badge");
		expect(
			within(grok46Choice).getByText("New").getAttribute("data-slot")
		).toBe("badge");
		expect(
			screen.getByRole("option", { name: "Grok 4.5" }).textContent
		).not.toContain("New");
	});

	it("lets an owner choose DeepSeek for new work without hiding image routing", async () => {
		renderSettings({ canManage: true });

		fireEvent.click(
			await screen.findByRole("combobox", { name: "Primary model" })
		);
		fireEvent.click(
			await screen.findByRole("option", { name: "DeepSeek V4 Flash" })
		);

		expect(
			screen.queryByText(
				"DeepSeek V4 Flash handles the conversation. When an image needs understanding, OpenMeld uses a compatible vision model only to describe the image, then gives that description to DeepSeek V4 Flash."
			)
		).toBeNull();
		const modelBehaviorTrigger = screen.getByRole("button", {
			name: "About Center Agent model behavior",
		});
		fireEvent.focus(modelBehaviorTrigger);
		await waitFor(() => {
			expect(
				screen.getByText(
					"Images use a vision model. New turns only. Doesn't switch on failure."
				)
			).toBeTruthy();
		});
		fireEvent.click(screen.getByRole("button", { name: "Save model" }));

		await waitFor(() => {
			expect(updateCurrentCenterAgentModelMock).toHaveBeenCalledWith({
				expectedConfigurationRevision: 7,
				organizationId: ORGANIZATION_ID,
				preference: {
					kind: "selected_model",
					modelId: "deepseek/deepseek-v4-flash",
				},
			});
		});
		expect(toastSuccessMock).toHaveBeenCalledWith(
			"Center Agent will use DeepSeek V4 Flash for new work."
		);
	});

	it("refreshes the model after a concurrent settings change", async () => {
		readCurrentCenterAgentModelMock
			.mockReset()
			.mockResolvedValueOnce(buildModelConfiguration())
			.mockResolvedValue(
				buildModelConfiguration({
					configurationRevision: 8,
					effectiveModel: {
						availability: "available",
						displayName: "DeepSeek V4 Flash",
						modelId: "deepseek/deepseek-v4-flash",
						supportsImageInput: false,
					},
					preference: {
						kind: "selected_model",
						modelId: "deepseek/deepseek-v4-flash",
					},
				})
			);
		updateCurrentCenterAgentModelMock.mockRejectedValue({
			code: "gateway.http_error",
			message: "The Center Agent model changed in another session.",
			status: 409,
			upstreamCode: "center_agent.model_configuration_changed",
		});
		renderSettings({ canManage: true });

		fireEvent.click(
			await screen.findByRole("combobox", { name: "Primary model" })
		);
		fireEvent.click(
			await screen.findByRole("option", { name: "DeepSeek V4 Flash" })
		);
		fireEvent.click(screen.getByRole("button", { name: "Save model" }));

		expect(
			await screen.findByText(
				"The Center Agent model changed somewhere else. Refresh this setting and try again."
			)
		).toBeTruthy();
		await waitFor(() => {
			expect(readCurrentCenterAgentModelMock).toHaveBeenCalledTimes(2);
		});
	});

	it("explains personal Center Agent settings and usage without Organization copy", async () => {
		renderSettings({ canManage: true, isPersonalWorkspace: true });

		expect(await screen.findByText("Personal workspace")).toBeTruthy();
		expect(
			screen.getByRole("heading", {
				level: 1,
				name: "Center Agent settings",
			})
		).toBeTruthy();
		expect(
			screen.getByText(
				"Manage your coordinator’s identity and connection, review its usage, and see the actions it has taken."
			)
		).toBeTruthy();
		expect(
			screen.getByText(
				"See today's Center Agent usage and current Routine limits."
			)
		).toBeTruthy();
		expect(
			screen.queryByText(
				"See today's organization-wide Center Agent usage and current Routine limits."
			)
		).toBeNull();
	});

	it("offers the Remote Agent connection when no designation exists", async () => {
		readCurrentCenterAgentDesignationMock.mockResolvedValue({
			designation: null,
			organizationId: ORGANIZATION_ID,
			remoteRuntimeAvailability: { selectable: true },
		});
		renderSettings({ canManage: true });

		fireEvent.click(
			await screen.findByRole("button", { name: "Connect Center Agent" })
		);

		await waitFor(() => {
			expect(designateCurrentCenterAgentMock).toHaveBeenCalledWith({
				organizationId: ORGANIZATION_ID,
				runtime: "remote_agent",
			});
		});
	});

	it("updates the directory cache immediately after a display-name change", async () => {
		const queryClient = createTestQueryClient();
		queryClient.setQueryData(
			organizationQueryKeys.directory(ORGANIZATION_ID),
			buildDirectoryResponse()
		);
		renderSettings({ canManage: true, queryClient });

		fireEvent.change(await screen.findByLabelText("Display name"), {
			target: { value: "Operations Center Agent" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save name" }));

		await waitFor(() => {
			expect(updateCurrentCenterAgentProfileMock.mock.calls[0]?.[0]).toEqual({
				organizationId: ORGANIZATION_ID,
				profileName: "Operations Center Agent",
			});
		});
		const cached = queryClient.getQueryData<OrganizationDirectoryResponse>(
			organizationQueryKeys.directory(ORGANIZATION_ID)
		);
		expect(cached?.agentProfiles[0]).toMatchObject({
			profileHandle: "operations-center-agent",
			profileName: "Operations Center Agent",
		});
	});

	it("opens the Center Agent DM and pauses all current Center Agent tasks after confirmation", async () => {
		renderSettings({ canManage: true });

		fireEvent.click(await screen.findByRole("button", { name: "Message" }));
		await waitFor(() => {
			expect(navigateMock).toHaveBeenCalledWith({
				to: "/o/acme/spaces/space-dm-1",
			});
		});

		fireEvent.click(await screen.findByRole("button", { name: "Pause" }));
		expect(await screen.findByText("Pause Center Agent?")).toBeTruthy();
		expect(
			screen.getByText(
				"Pausing stops every task currently interacting with the Center Agent across OpenMeld, Slack, and connected channels. Its identity, conversations, Routines, and connections are preserved."
			)
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Pause Center Agent" }));
		await waitFor(() => {
			expect(updateCurrentCenterAgentOperatingStateMock).toHaveBeenCalledWith({
				operatingState: "paused",
				organizationId: ORGANIZATION_ID,
			});
		});
	});

	it("offers Resume without treating a paused Center Agent as disconnected", async () => {
		readCurrentCenterAgentOperatingStateMock.mockResolvedValue({
			canChangeOperatingState: true,
			operatingState: "paused",
			organizationId: ORGANIZATION_ID,
			pausedAt: "2026-07-29T00:00:00.000Z",
		});
		updateCurrentCenterAgentOperatingStateMock.mockResolvedValue({
			affectedTaskCount: 0,
			canChangeOperatingState: true,
			changed: true,
			operatingState: "active",
			organizationId: ORGANIZATION_ID,
			pausedAt: null,
		});

		renderSettings({ canManage: true });

		expect(await screen.findByText("Paused")).toBeTruthy();
		expect(screen.queryByText("Connect your Center Agent")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Resume" }));
		await waitFor(() => {
			expect(updateCurrentCenterAgentOperatingStateMock).toHaveBeenCalledWith({
				operatingState: "active",
				organizationId: ORGANIZATION_ID,
			});
		});
	});
});

function renderSettings(input: {
	canManage: boolean;
	isPersonalWorkspace?: boolean;
	queryClient?: ReturnType<typeof createTestQueryClient>;
}) {
	return render(
		<TestQueryClientProvider queryClient={input.queryClient}>
			<CenterAgentSettingsContent
				agentProfiles={buildDirectoryResponse().agentProfiles}
				isDirectoryPending={false}
				isPersonalWorkspace={input.isPersonalWorkspace === true}
				members={buildDirectoryResponse().members}
				organizationId={ORGANIZATION_ID}
				organizationName="Acme"
				orgSlug="acme"
				roleState={{
					canManage: input.canManage,
					isError: false,
					isPending: false,
				}}
			/>
		</TestQueryClientProvider>
	);
}

function buildDesignation() {
	return {
		agentProfileId: CENTER_AGENT_ID,
		createdAt: "2026-07-13T00:00:00.000Z",
		designatedBy: "member-1",
		duty: null,
		organizationId: ORGANIZATION_ID,
	};
}

function buildModelConfiguration(
	overrides: Partial<{
		configurationRevision: number;
		effectiveModel: {
			availability: "available" | "unavailable" | "unknown";
			displayName: string;
			modelId: string;
			supportsImageInput: boolean;
		};
		preference:
			| { kind: "system_default" }
			| { kind: "selected_model"; modelId: string };
	}> = {}
) {
	return {
		canManage: true,
		choices: [
			{
				badgeLabel: "New",
				displayName: "OpenMeld default",
				effectiveModelDisplayName: "Grok 4.6",
				preference: { kind: "system_default" as const },
				supportsImageInput: true,
			},
			{
				badgeLabel: "New",
				displayName: "Grok 4.6",
				effectiveModelDisplayName: "Grok 4.6",
				preference: {
					kind: "selected_model" as const,
					modelId: "x-ai/grok-4.6",
				},
				supportsImageInput: true,
			},
			{
				badgeLabel: null,
				displayName: "Grok 4.5",
				effectiveModelDisplayName: "Grok 4.5",
				preference: {
					kind: "selected_model" as const,
					modelId: "x-ai/grok-4.5",
				},
				supportsImageInput: true,
			},
			{
				badgeLabel: null,
				displayName: "DeepSeek V4 Flash",
				effectiveModelDisplayName: "DeepSeek V4 Flash",
				preference: {
					kind: "selected_model" as const,
					modelId: "deepseek/deepseek-v4-flash",
				},
				supportsImageInput: false,
			},
		],
		configurationRevision: overrides.configurationRevision ?? 7,
		effectiveModel: overrides.effectiveModel ?? {
			availability: "available" as const,
			displayName: "Grok 4.6",
			modelId: "x-ai/grok-4.6",
			supportsImageInput: true,
		},
		organizationId: ORGANIZATION_ID,
		preference: overrides.preference ?? { kind: "system_default" as const },
	};
}

function buildDirectoryResponse(): OrganizationDirectoryResponse {
	const readiness = buildRemoteCenterAgentReadiness("available", {
		agentProfileId: CENTER_AGENT_ID,
	});
	return {
		agentProfiles: [
			{
				avatarUrl: undefined,
				createdAt: "2026-07-13T00:00:00.000Z",
				createdByUserId: "user-1",
				creatorProfileId: null,
				isCenterAgent: true,
				isDefault: false,
				lastUsedAt: null,
				managedRole: "center_agent",
				organizationId: ORGANIZATION_ID,
				ownerName: "Felix",
				ownerUserId: "user-1",
				profileHandle: "center-agent",
				profileId: CENTER_AGENT_ID,
				profileKind: "agent",
				profileName: "Center Agent",
				readiness: {
					...readiness,
					primaryBinding: {
						modelSelection: {
							modelId: "claude-sonnet-4-5",
							reasoningLevel: "high",
						},
					},
				} as OrganizationDirectoryResponse["agentProfiles"][number]["readiness"],
				source: "managed",
				status: "active",
				updatedAt: "2026-07-13T00:00:00.000Z",
			},
		],
		generatedAt: "2026-07-13T00:00:00.000Z",
		members: [
			{
				humanProfile: {
					lastUsedAt: "2026-07-13T00:00:00.000Z",
					profileHandle: "felix",
					profileId: "11111111-1111-4111-8111-111111111111",
					profileName: "Felix",
					status: "active",
				},
				joinedAt: "2026-07-13T00:00:00.000Z",
				memberId: "member-1",
				organizationId: ORGANIZATION_ID,
				role: "member",
				user: {
					email: "felix@example.com",
					id: "user-1",
					image: null,
					name: "Felix",
				},
				userId: "user-1",
			},
		],
		organizationId: ORGANIZATION_ID,
	};
}
