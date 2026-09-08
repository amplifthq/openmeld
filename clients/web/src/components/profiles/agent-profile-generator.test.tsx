import { DEFAULT_AGENT_CONTROLLER_PERMISSION_MODE } from "@openmeld/agent-runtime";
import type { ModelCatalog } from "@openmeld/schemas/types";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { type FormEvent, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentProfileGenerator } from "./agent-profile-generator";
import type { CreateProfileFormProps } from "./create-profile-form";

const CODEX_RADIO_NAME = /^codex$/i;
const REMOTE_AGENT_NAME = /Remote Agent/;
const CUSTOMIZE_AGENT_BUTTON_NAME = /Advanced Agent Settings/i;
const TEST_MODEL_CATALOG = {
	agentControllers: {
		codex: {
			defaultModelId: "gpt-5.6-sol",
			models: [
				{
					displayName: "GPT-5.6 Sol",
					id: "gpt-5.6-sol",
					minCliVersion: null,
					supportedReasoningLevels: ["low", "medium", "high", "xhigh"],
					unavailable: false,
				},
			],
		},
	},
	schemaVersion: 1,
	updatedAt: "2026-09-02T00:00:00.000Z",
} satisfies ModelCatalog;

afterEach(cleanup);

describe("AgentProfileGenerator", () => {
	it("opens the owner editor even when no local agent is selected", async () => {
		render(
			<GeneratorHarness
				initialAgentId=""
				overrides={{
					additionalSubmitBlockReason: "Choose an Agent owner.",
					additionalSubmitBlockSection: "owner",
				}}
			/>
		);
		fireEvent.click(
			await screen.findByRole("button", { name: "Choose owner" })
		);
		expect(await screen.findByText("Owner choice")).toBeTruthy();
	});

	it("submits directly from the single-page form with the keyboard", async () => {
		const onSubmit = vi.fn();
		render(<GeneratorHarness initialAgentId="codex" onSubmit={onSubmit} />);
		fireEvent.submit(screen.getByTestId("create-profile-panel"));
		expect(await screen.findByLabelText("Agent name")).toBeTruthy();
		expect(onSubmit).toHaveBeenCalledOnce();
	});
	it("keeps creation available while selected local agent discovery refreshes", () => {
		render(
			<GeneratorHarness
				initialAgentId="codex"
				overrides={{ isResolvingLocalAgents: true }}
			/>
		);
		expect(
			(
				screen.getByRole("button", {
					name: "Create Agent",
				}) as HTMLButtonElement
			).disabled
		).toBe(false);
	});

	it("opens Permissions from its blocker and enables creation after consent", async () => {
		render(
			<GeneratorHarness
				initialAgentId="codex"
				overrides={{
					boundAgentControllerPermissionMode: "codex:fullAccess",
				}}
				permissionConfirmed={false}
			/>
		);
		expect(
			(
				(await screen.findByRole("button", {
					name: "Create Agent",
				})) as HTMLButtonElement
			).disabled
		).toBe(true);
		fireEvent.click(screen.getByRole("button", { name: "Review permissions" }));
		const confirmation = await screen.findByRole("checkbox", {
			name: "I understand this permissions mode can run with dangerous full access.",
		});
		await waitFor(() => expect(document.activeElement).toBe(confirmation));
		expect(
			screen
				.getByRole("button", { name: CUSTOMIZE_AGENT_BUTTON_NAME })
				.getAttribute("aria-expanded")
		).toBe("true");
		fireEvent.click(confirmation);
		expect(
			(
				(await screen.findByRole("button", {
					name: "Create Agent",
				})) as HTMLButtonElement
			).disabled
		).toBe(false);
	});

	it("keeps remembered full access usable without opening customization", async () => {
		render(
			<GeneratorHarness
				initialAgentId="codex"
				overrides={{ boundAgentControllerPermissionMode: "codex:fullAccess" }}
			/>
		);
		expect(
			(
				(await screen.findByRole("button", {
					name: "Create Agent",
				})) as HTMLButtonElement
			).disabled
		).toBe(false);
		expect(
			screen.queryByRole("button", { name: "Review permissions" })
		).toBeNull();
	});

	it("keeps an explicitly cleared name blocked with a visible reason", async () => {
		render(<GeneratorHarness initialAgentId="codex" />);
		fireEvent.change(await screen.findByLabelText("Agent name"), {
			target: { value: "" },
		});
		expect(
			(
				screen.getByRole("button", {
					name: "Create Agent",
				}) as HTMLButtonElement
			).disabled
		).toBe(true);
		expect(screen.getByRole("status").textContent).toBe(
			"Enter a profile name."
		);
	});

	it("offers working-folder recovery directly beside the blocked action", async () => {
		const onUseManagedWorkspace = vi.fn();
		render(
			<GeneratorHarness
				initialAgentId="codex"
				overrides={{
					projectSelectionBlockReason:
						"Waiting for a connected working folder.",
					onUseManagedWorkspace,
				}}
			/>
		);
		fireEvent.click(
			await screen.findByRole("button", { name: "Use OpenMeld managed folder" })
		);
		expect(onUseManagedWorkspace).toHaveBeenCalledOnce();
		fireEvent.click(
			screen.getByRole("button", { name: "Choose working folder" })
		);
		expect(await screen.findByText("Project choice")).toBeTruthy();
		expect(screen.queryByText("Session choice")).toBeNull();
	});
	it("asks for the local agent before showing the editable generated name", async () => {
		render(<GeneratorHarness />);

		expect(screen.queryByLabelText("Agent name")).toBeNull();
		fireEvent.click(screen.getByRole("radio", { name: CODEX_RADIO_NAME }));

		expect(
			((await screen.findByLabelText("Agent name")) as HTMLInputElement).value
		).toBe("Felix Lu Codex GPT-5.6 Sol Xhigh");
		expect(screen.getByRole("button", { name: "Create Agent" })).toBeTruthy();
	});

	it.each([
		"dialog",
		"page",
	] as const)("starts advanced settings collapsed on the %s surface and opens only the selected editor", async (surface) => {
		render(<GeneratorHarness initialAgentId="codex" surface={surface} />);

		const customizeTrigger = screen.getByRole("button", {
			name: CUSTOMIZE_AGENT_BUTTON_NAME,
		});
		expect(customizeTrigger.getAttribute("aria-expanded")).toBe("false");
		fireEvent.click(customizeTrigger);
		fireEvent.click(screen.getByRole("button", { name: "Edit Owner" }));

		expect(await screen.findByText("Owner choice")).toBeTruthy();
		expect(screen.queryByText("Session choice")).toBeNull();
		expect(screen.queryByText("Project choice")).toBeNull();
	});

	it("shows the editable name and direct submit without a review step", () => {
		render(<GeneratorHarness initialAgentId="codex" />);
		const name = screen.getByLabelText("Agent name") as HTMLInputElement;
		fireEvent.change(name, { target: { value: "My Agent" } });
		expect(name.value).toBe("My Agent");
		expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
		expect(screen.queryByText("Ready to create")).toBeNull();
		expect(screen.getByRole("button", { name: "Create Agent" })).toBeTruthy();
	});

	it("summarizes the effective setup without opening an editor", () => {
		render(
			<GeneratorHarness
				initialAgentId="codex"
				modelCatalog={TEST_MODEL_CATALOG}
				projectFolderPath="/Users/felix/work/openmeld"
			/>
		);

		expect(
			screen.getByRole("button", { name: CUSTOMIZE_AGENT_BUTTON_NAME })
				.textContent
		).toContain(
			"New session · openmeld · GPT-5.6 Sol (default) · Model default · Ask for approval"
		);
		expect(screen.queryByRole("button", { name: "Edit Model" })).toBeNull();
	});

	it("blocks creation until a local agent is selected and keeps Remote Agent unavailable", () => {
		const onSubmit = vi.fn();
		render(
			<GeneratorHarness
				availableLocalAgentIds={[]}
				initialAgentId=""
				onSubmit={onSubmit}
			/>
		);

		expect(screen.getByText("Set up local agents")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Edit Runs on" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Connect later" })).toBeNull();
		expect(
			(
				screen.getByRole("button", {
					name: "Create Agent",
				}) as HTMLButtonElement
			).disabled
		).toBe(true);
		const remoteTab = screen.getByRole("tab", { name: REMOTE_AGENT_NAME });
		expect(remoteTab.getAttribute("aria-disabled")).toBe("true");
		fireEvent.click(remoteTab);
		expect(remoteTab.getAttribute("aria-selected")).toBe("false");
		expect(screen.getByText("Set up local agents")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Create Agent" }));
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it("submits through the existing creation contract", () => {
		const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => {
			event.preventDefault();
		});
		render(<GeneratorHarness initialAgentId="codex" onSubmit={onSubmit} />);

		fireEvent.click(screen.getByRole("button", { name: "Create Agent" }));

		expect(onSubmit).toHaveBeenCalledOnce();
	});
});

function GeneratorHarness(input: {
	overrides?: Partial<CreateProfileFormProps>;
	permissionConfirmed?: boolean;
	availableLocalAgentIds?: readonly string[];
	initialAgentId?: string;
	modelCatalog?: ModelCatalog | null;
	onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
	projectFolderPath?: string;
	surface?: "dialog" | "page";
}) {
	const [boundAgentId, setBoundAgentId] = useState(input.initialAgentId ?? "");
	const [permissionConfirmed, setPermissionConfirmed] = useState(
		input.permissionConfirmed ?? true
	);
	const [profileName, setProfileName] = useState(
		"Felix Lu Codex GPT-5.6 Sol Xhigh"
	);
	const form: CreateProfileFormProps = {
		additionalHumanProfileCreationEnabled: false,
		agentOwnershipSlot: <div>Owner choice</div>,
		agentSessionSlot: <div>Session choice</div>,
		availableLocalAgentIds: input.availableLocalAgentIds ?? ["codex"],
		boundAgentControllerCollaborationMode: null,
		boundAgentControllerPermissionMode:
			DEFAULT_AGENT_CONTROLLER_PERMISSION_MODE,
		boundAgentControllerPermissionModeConfirmed: permissionConfirmed,
		boundAgentId,
		boundModelId: "",
		boundOpenCodePermission: null,
		boundReasoningLevel: "",
		errorState: null,
		isResolvingAccount: false,
		isResolvingLocalAgents: false,
		isSubmitting: false,
		localFolderPickerDeviceId: null,
		modelCatalog: input.modelCatalog ?? null,
		onChangeBoundAgentControllerCollaborationMode: vi.fn(),
		onChangeBoundAgentControllerPermissionMode: vi.fn(),
		onChangeBoundAgentControllerPermissionModeConfirmed: setPermissionConfirmed,
		onChangeBoundAgentId: setBoundAgentId,
		onChangeBoundModelId: vi.fn(),
		onChangeBoundOpenCodePermission: vi.fn(),
		onChangeBoundReasoningLevel: vi.fn(),
		onChangeProfileName: setProfileName,
		onChangeProjectFolderPath: vi.fn(),
		onSelectProfileKind: vi.fn(),
		onSubmit:
			input.onSubmit ??
			((event) => {
				event.preventDefault();
			}),
		profileKind: "agent",
		profileName,
		projectFolderPath: input.projectFolderPath ?? "",
		projectSelectionSlot: <div>Project choice</div>,
		recoveryActionHref: "/connect",
		...input.overrides,
	};
	return (
		<AgentProfileGenerator form={form} surface={input.surface ?? "dialog"} />
	);
}
