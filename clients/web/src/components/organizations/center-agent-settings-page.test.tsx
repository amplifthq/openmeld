import { listCenterAgentModelChoices } from "@openmeld/agent-runtime";
import { modelCatalogSchema } from "@openmeld/schemas/schemas";
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
import { AgentConfigurationGrid } from "#/components/profiles/agent-configuration-card";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import { buildRemoteCenterAgentReadiness } from "#/test-support/center-agent-readiness";
import {
	createTestQueryClient,
	TestQueryClientProvider,
} from "#/test-support/query-client";
import vendorModelCatalog from "../../../../../release/vendor-models.json";
import { CenterAgentModelSection } from "./center-agent-model-section";
import { CenterAgentSettingsContent } from "./center-agent-settings-page";

const designateCurrentCenterAgentMock = vi.hoisted(() => vi.fn());
const listCurrentCenterAgentAuditJournalMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());
const openCurrentCenterAgentDirectMessageSpaceMock = vi.hoisted(() => vi.fn());
const readCurrentCenterAgentDesignationMock = vi.hoisted(() => vi.fn());
const readCurrentCenterAgentModelMock = vi.hoisted(() => vi.fn());
const readCurrentCenterAgentOperatingStateMock = vi.hoisted(() => vi.fn());
const readCurrentOrganizationCenterAgentMemoryPolicyMock = vi.hoisted(() =>
	vi.fn()
);
const readCurrentOrganizationUsageOverviewMock = vi.hoisted(() => vi.fn());
const setCurrentOrganizationCenterAgentMemoryPolicyMock = vi.hoisted(() =>
	vi.fn()
);
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

vi.mock("#/lib/organizations/center-agent-memory", () => ({
	readCurrentOrganizationCenterAgentMemoryPolicy:
		readCurrentOrganizationCenterAgentMemoryPolicyMock,
	setCurrentOrganizationCenterAgentMemoryPolicy:
		setCurrentOrganizationCenterAgentMemoryPolicyMock,
}));

const ORGANIZATION_ID = "org-1";
const CENTER_AGENT_ID = "agt_11111111-1111-4111-8111-111111111111";
const AUDIT_LOG_BUTTON_NAME = /Audit Log/;

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
		readCurrentOrganizationCenterAgentMemoryPolicyMock
			.mockReset()
			.mockResolvedValue({
				organizationId: ORGANIZATION_ID,
				organizationMemoryOptIn: true,
				provider: "zep_cloud",
				updatedByUserId: "member-1",
			});
		readCurrentOrganizationUsageOverviewMock.mockReset().mockResolvedValue({
			aiSpend: {
				dailyLimitNanoUsd: null,
				resetsAt: "2026-07-17T00:00:00.000Z",
				usedNanoUsd: 120_000_000,
				missingCostRequests: 0,
				exhausted: false,
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
		setCurrentOrganizationCenterAgentMemoryPolicyMock
			.mockReset()
			.mockResolvedValue({
				organizationId: ORGANIZATION_ID,
				organizationMemoryOptIn: false,
				provider: "zep_cloud",
				updatedByUserId: "member-1",
			});
		toastSuccessMock.mockReset();
	});

	afterEach(cleanup);

	it("shows Center Agent essentials first and loads the audit log on demand", async () => {
		const view = renderSettings({ canManage: false });

		expect(
			await screen.findByRole("heading", { name: "Center Agent" })
		).toBeTruthy();
		expect(
			view.container.querySelector("canvas[data-bot-avatar]")
		).toBeTruthy();
		expect(screen.getByText("How this Agent works")).toBeTruthy();
		expect(screen.getByText("Identity")).toBeTruthy();
		expect(screen.getByRole("heading", { name: "Usage" })).toBeTruthy();
		expect(screen.getByText("Organization memory")).toBeTruthy();
		expect(screen.getByText("Remember shared conversations")).toBeTruthy();
		expect(
			(
				await screen.findByRole("switch", {
					name: "Use shared Center Agent organization memory",
				})
			).hasAttribute("data-disabled")
		).toBe(true);
		expect(screen.getByText("Model")).toBeTruthy();
		expect(await screen.findByText("GLM 5.3 Flash")).toBeTruthy();
		expect(
			screen.queryByRole("combobox", { name: "Primary model" })
		).toBeNull();
		expect(screen.queryByRole("combobox", { name: "Provider" })).toBeNull();
		expect(screen.getByText("$0.12")).toBeTruthy();
		const audit = screen.getByRole("button", { name: AUDIT_LOG_BUTTON_NAME });
		expect(audit.getAttribute("aria-expanded")).toBe("false");
		expect(listCurrentCenterAgentAuditJournalMock).not.toHaveBeenCalled();
		expect(screen.getByRole("heading", { name: "Danger zone" })).toBeTruthy();
		expect(screen.queryByText("claude-sonnet-4-5 · high")).toBeNull();
		expect(screen.queryByLabelText("Display name")).toBeNull();
		expect(screen.queryByRole("button", { name: "Save name" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
		expect(
			screen.getByText(
				"Only Organization owners and admins can pause the Center Agent."
			)
		).toBeTruthy();
		fireEvent.click(audit);
		expect(audit.getAttribute("aria-expanded")).toBe("true");
		await waitFor(() => {
			expect(listCurrentCenterAgentAuditJournalMock).toHaveBeenCalledTimes(1);
		});
	});

	it("lets an owner change organization memory from Center Agent settings", async () => {
		renderSettings({ canManage: true });
		await screen.findByRole("heading", { name: "Center Agent" });
		const memorySwitch = await screen.findByRole("switch", {
			name: "Use shared Center Agent organization memory",
		});
		await waitFor(() =>
			expect(memorySwitch.hasAttribute("data-disabled")).toBe(false)
		);
		fireEvent.click(memorySwitch);

		await waitFor(() => {
			expect(
				setCurrentOrganizationCenterAgentMemoryPolicyMock
			).toHaveBeenCalledWith({
				organizationId: ORGANIZATION_ID,
				organizationMemoryOptIn: false,
			});
		});
	});

	it("shows catalog-owned model badges in the trigger and matching choices", async () => {
		renderSettings({ canManage: true });
		await openModelSettings();

		const trigger = await screen.findByRole("combobox", {
			name: "Primary model",
		});
		expect(within(trigger).getByText("New").getAttribute("data-slot")).toBe(
			"badge"
		);

		fireEvent.click(trigger);
		const defaultChoice = await screen.findByRole("option", {
			name: "OpenMeld default (GLM 5.3 Flash) New",
		});
		const glmChoice = screen.getByRole("option", {
			name: "GLM 5.3 Flash New",
		});
		expect(
			within(defaultChoice).getByText("New").getAttribute("data-slot")
		).toBe("badge");
		expect(within(glmChoice).getByText("New").getAttribute("data-slot")).toBe(
			"badge"
		);
		expect(
			screen.getByRole("option", { name: "Grok 4.6" }).textContent
		).not.toContain("New");
		expect(
			screen.getByRole("option", { name: "Grok 4.5" }).textContent
		).not.toContain("New");
	});

	it("lets an owner choose DeepSeek for new work without hiding image routing", async () => {
		renderSettings({ canManage: true });
		await openModelSettings();

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
		fireEvent.click(
			screen.getByRole("button", { name: "Save model settings" })
		);

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

	it("keeps the saved model visible until an explicit save", async () => {
		renderSettings({ canManage: true });
		await openModelSettings();
		fireEvent.click(
			await screen.findByRole("combobox", { name: "Primary model" })
		);
		fireEvent.click(
			await screen.findByRole("option", { name: "DeepSeek V4 Flash" })
		);
		expect(screen.getByText("Current: GLM 5.3 Flash")).toBeTruthy();
		expect(updateCurrentCenterAgentModelMock).not.toHaveBeenCalled();
		expect(
			screen.getByRole("status", { name: "Model change impact" }).textContent
		).toContain("including existing conversations");
		fireEvent.click(
			screen.getByRole("button", { name: "Save model settings" })
		);
		await waitFor(() =>
			expect(screen.getByText("Current: DeepSeek V4 Flash")).toBeTruthy()
		);
	});

	it("selects a model with the keyboard and leaves persistence to Save", async () => {
		renderSettings({ canManage: true });
		await openModelSettings();
		const trigger = await screen.findByRole("combobox", {
			name: "Primary model",
		});
		trigger.focus();
		fireEvent.keyDown(trigger, { key: "ArrowDown" });
		const option = await screen.findByRole("option", {
			name: "DeepSeek V4 Flash",
		});
		option.focus();
		fireEvent.keyDown(option, { key: "Enter" });
		await waitFor(() =>
			expect(trigger.textContent).toContain("DeepSeek V4 Flash")
		);
		expect(
			screen.getByRole("button", { name: "Save model settings" })
		).toHaveProperty("disabled", false);
		expect(updateCurrentCenterAgentModelMock).not.toHaveBeenCalled();
	});

	it("selects a provider before a model and saves only an explicit model choice", async () => {
		readCurrentCenterAgentModelMock.mockResolvedValue({
			...buildModelConfiguration(),
			choices: listCenterAgentModelChoices(
				modelCatalogSchema.parse(vendorModelCatalog)
			),
		});
		renderSettings({ canManage: true });
		await openModelSettings();
		fireEvent.click(await screen.findByRole("combobox", { name: "Provider" }));
		for (const name of [
			"OpenAI",
			"Anthropic",
			"Google",
			"DeepSeek",
			"xAI",
			"Z.ai",
		]) {
			expect(await screen.findByRole("option", { name })).toBeTruthy();
		}
		fireEvent.click(screen.getByRole("option", { name: "Google" }));
		const modelTrigger = screen.getByRole("combobox", {
			name: "Primary model",
		});
		expect(modelTrigger.textContent).toContain("Choose a model");
		expect(
			screen.getByRole("button", { name: "Save model settings" })
		).toHaveProperty("disabled", true);
		expect(updateCurrentCenterAgentModelMock).not.toHaveBeenCalled();
		fireEvent.click(modelTrigger);
		const gemini = await screen.findByRole("option", {
			name: "Gemini 3.8 Flash",
		});
		expect(screen.getAllByRole("option")).toHaveLength(3);
		expect(
			screen.getByRole("option", { name: "Gemini 3.5 Flash Lite" })
		).toBeTruthy();
		expect(screen.getByText("Current: GLM 5.3 Flash")).toBeTruthy();
		fireEvent.click(gemini);
		fireEvent.click(
			screen.getByRole("button", { name: "Save model settings" })
		);
		await waitFor(() =>
			expect(updateCurrentCenterAgentModelMock).toHaveBeenCalledWith({
				expectedConfigurationRevision: 7,
				organizationId: ORGANIZATION_ID,
				preference: {
					kind: "selected_model",
					modelId: "google/gemini-3.8-flash",
				},
			})
		);
	});

	it("clears an incompatible draft and allows returning to the system default", async () => {
		renderSettings({ canManage: true });
		await openModelSettings();
		fireEvent.click(
			await screen.findByRole("combobox", { name: "Primary model" })
		);
		fireEvent.click(
			await screen.findByRole("option", { name: "DeepSeek V4 Flash" })
		);
		fireEvent.click(screen.getByRole("combobox", { name: "Provider" }));
		fireEvent.click(await screen.findByRole("option", { name: "xAI" }));
		expect(
			screen.getByRole("button", { name: "Save model settings" })
		).toHaveProperty("disabled", true);
		fireEvent.click(screen.getByRole("combobox", { name: "Provider" }));
		fireEvent.click(
			await screen.findByRole("option", { name: "All providers" })
		);
		fireEvent.click(screen.getByRole("combobox", { name: "Primary model" }));
		fireEvent.click(
			await screen.findByRole("option", {
				name: "OpenMeld default (GLM 5.3 Flash) New",
			})
		);
		expect(
			screen.getByRole("button", { name: "Save model settings" })
		).toHaveProperty("disabled", true);
		expect(updateCurrentCenterAgentModelMock).not.toHaveBeenCalled();
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
		await openModelSettings();

		fireEvent.click(
			await screen.findByRole("combobox", { name: "Primary model" })
		);
		fireEvent.click(
			await screen.findByRole("option", { name: "DeepSeek V4 Flash" })
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Save model settings" })
		);

		expect(
			await screen.findByText(
				"The Center Agent model changed somewhere else. Refresh this setting and try again."
			)
		).toBeTruthy();
		await waitFor(() => {
			expect(readCurrentCenterAgentModelMock).toHaveBeenCalledTimes(2);
		});
	});

	it("resets provider browsing and unsaved model intent when the Organization changes", async () => {
		const queryClient = createTestQueryClient();
		readCurrentCenterAgentModelMock.mockImplementation(
			async ({ organizationId }) => ({
				...buildModelConfiguration(),
				organizationId,
			})
		);
		const section = (organizationId: string) => (
			<TestQueryClientProvider queryClient={queryClient}>
				<AgentConfigurationGrid>
					<CenterAgentModelSection
						canManage
						enabled
						organizationId={organizationId}
					/>
				</AgentConfigurationGrid>
			</TestQueryClientProvider>
		);
		const view = render(section(ORGANIZATION_ID));
		await openModelSettings();
		fireEvent.click(await screen.findByRole("combobox", { name: "Provider" }));
		fireEvent.click(await screen.findByRole("option", { name: "DeepSeek" }));
		fireEvent.click(screen.getByRole("combobox", { name: "Primary model" }));
		fireEvent.click(
			await screen.findByRole("option", { name: "DeepSeek V4 Flash" })
		);
		expect(
			screen.getByRole("button", { name: "Save model settings" })
		).toHaveProperty("disabled", false);
		view.rerender(section("another-organization"));
		await openModelSettings();
		await waitFor(() =>
			expect(
				screen.getByRole("combobox", { name: "Primary model" }).textContent
			).toContain("OpenMeld default")
		);
		expect(screen.getByRole("combobox", { name: "Provider" }).textContent).toBe(
			"All providers"
		);
		expect(
			screen.getByRole("button", { name: "Save model settings" })
		).toHaveProperty("disabled", true);
		expect(updateCurrentCenterAgentModelMock).not.toHaveBeenCalled();
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
			await screen.findByText(
				"See today's AI model costs and current Routine limits."
			)
		).toBeTruthy();
		expect(
			screen.queryByText(
				"See today's shared AI model costs and current Routine limits."
			)
		).toBeNull();
		expect(
			screen.queryByRole("heading", { name: "Organization memory" })
		).toBeNull();
		expect(
			readCurrentOrganizationCenterAgentMemoryPolicyMock
		).not.toHaveBeenCalled();
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
		fireEvent.click(
			await screen.findByRole("button", { name: "Edit Identity" })
		);

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

		const messageButton = await screen.findByRole("button", {
			name: "Message",
		});
		await waitFor(() =>
			expect(messageButton.hasAttribute("disabled")).toBe(false)
		);
		fireEvent.click(messageButton);
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
				memoryRoleState={{
					canManage: input.canManage,
					errorMessage: null,
					isPending: false,
				}}
				organizationId={ORGANIZATION_ID}
				organizationName="Acme"
				orgSlug="acme"
				roleState={{
					canManage: input.canManage,
					errorMessage: null,
					isPending: false,
				}}
			/>
		</TestQueryClientProvider>
	);
}

async function openModelSettings() {
	fireEvent.click(await screen.findByRole("button", { name: "Edit Model" }));
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
				effectiveModelDisplayName: "GLM 5.3 Flash",
				preference: { kind: "system_default" as const },
				supportsImageInput: true,
			},
			{
				badgeLabel: "New",
				displayName: "GLM 5.3 Flash",
				effectiveModelDisplayName: "GLM 5.3 Flash",
				preference: {
					kind: "selected_model" as const,
					modelId: "z-ai/glm-5.3-flash",
				},
				supportsImageInput: true,
			},
			{
				badgeLabel: null,
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
			displayName: "GLM 5.3 Flash",
			modelId: "z-ai/glm-5.3-flash",
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
