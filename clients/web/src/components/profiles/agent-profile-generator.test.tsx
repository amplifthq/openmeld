import { DEFAULT_AGENT_CONTROLLER_PERMISSION_MODE } from "@openmeld/agent-runtime";
import type { ModelCatalog } from "@openmeld/schemas/types";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type FormEvent, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentProfileGenerator } from "./agent-profile-generator";
import type { CreateProfileFormProps } from "./create-profile-form";

const CODEX_RADIO_NAME = /^codex$/i;
const CUSTOMIZE_AGENT_BUTTON_NAME = /Customize this Agent/i;
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
	it("asks for the local agent before showing the editable generated name", async () => {
		render(<GeneratorHarness />);

		expect(screen.queryByLabelText("Agent name")).toBeNull();
		fireEvent.click(screen.getByRole("radio", { name: CODEX_RADIO_NAME }));
		fireEvent.click(screen.getByRole("button", { name: "Continue" }));

		expect(
			((await screen.findByLabelText("Agent name")) as HTMLInputElement).value
		).toBe("Felix Lu Codex GPT-5.6 Sol Xhigh");
		expect(screen.getByRole("button", { name: "Create Agent" })).toBeTruthy();
	});

	it.each([
		"dialog",
		"page",
	] as const)("starts customization expanded on the %s surface and opens only the selected editor", async (surface) => {
		render(<GeneratorHarness initialAgentId="codex" surface={surface} />);

		const customizeTrigger = screen.getByRole("button", {
			name: CUSTOMIZE_AGENT_BUTTON_NAME,
		});
		expect(customizeTrigger.getAttribute("aria-expanded")).toBe("true");
		fireEvent.click(screen.getByRole("button", { name: "Edit Owner" }));

		expect(await screen.findByText("Owner choice")).toBeTruthy();
		expect(screen.queryByText("Session choice")).toBeNull();
		expect(screen.queryByText("Project choice")).toBeNull();
	});

	it("keeps customization expanded when returning from review", async () => {
		render(<GeneratorHarness initialAgentId="codex" />);

		fireEvent.click(screen.getByRole("button", { name: "Continue" }));
		fireEvent.click(await screen.findByRole("button", { name: "Back" }));

		const customizeTrigger = await screen.findByRole("button", {
			name: CUSTOMIZE_AGENT_BUTTON_NAME,
		});
		expect(customizeTrigger.getAttribute("aria-expanded")).toBe("true");
		expect(screen.getByRole("button", { name: "Edit Owner" })).toBeTruthy();
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
		expect(
			screen.getByText("GPT-5.6 Sol (default) · Model default")
		).toBeTruthy();
		expect(screen.getByText("openmeld")).toBeTruthy();
		expect(screen.getByText("Ask for approval")).toBeTruthy();
	});

	it("allows an explicit unbound Agent without inventing an available local agent", async () => {
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
		fireEvent.click(screen.getByRole("button", { name: "Connect later" }));

		expect(await screen.findByText("Connect a local agent later")).toBeTruthy();
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it("submits through the existing creation contract", () => {
		const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => {
			event.preventDefault();
		});
		render(<GeneratorHarness initialAgentId="codex" onSubmit={onSubmit} />);

		fireEvent.click(screen.getByRole("button", { name: "Continue" }));
		fireEvent.click(screen.getByRole("button", { name: "Create Agent" }));

		expect(onSubmit).toHaveBeenCalledOnce();
	});
});

function GeneratorHarness(input: {
	availableLocalAgentIds?: readonly string[];
	initialAgentId?: string;
	modelCatalog?: ModelCatalog | null;
	onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
	projectFolderPath?: string;
	surface?: "dialog" | "page";
}) {
	const [boundAgentId, setBoundAgentId] = useState(input.initialAgentId ?? "");
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
		boundAgentControllerPermissionModeConfirmed: true,
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
		onChangeBoundAgentControllerPermissionModeConfirmed: vi.fn(),
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
	};
	return (
		<AgentProfileGenerator form={form} surface={input.surface ?? "dialog"} />
	);
}
