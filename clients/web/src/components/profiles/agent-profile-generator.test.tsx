import { DEFAULT_AGENT_CONTROLLER_PERMISSION_MODE } from "@openmeld/agent-runtime";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type FormEvent, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentProfileGenerator } from "./agent-profile-generator";
import type { CreateProfileFormProps } from "./create-profile-form";

const ADVANCED_BUTTON_NAME = /advanced/i;
const CODEX_RADIO_NAME = /codex on this computer/i;

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

	it("keeps lower-frequency owner, Session, and Project choices under Advanced", () => {
		render(<GeneratorHarness initialAgentId="codex" />);

		expect(screen.queryByText("Owner choice")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: ADVANCED_BUTTON_NAME }));

		expect(screen.getByText("Owner choice")).toBeTruthy();
		expect(screen.getByText("Session choice")).toBeTruthy();
		expect(screen.getByText("Project choice")).toBeTruthy();
	});

	it("allows an explicit unbound Agent without inventing an available local agent", async () => {
		render(<GeneratorHarness availableLocalAgentIds={[]} initialAgentId="" />);

		expect(screen.getByText("No local agents are available")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: ADVANCED_BUTTON_NAME }));
		fireEvent.click(
			screen.getByRole("button", { name: "Create without a local agent" })
		);
		fireEvent.click(screen.getByRole("button", { name: "Continue" }));

		expect(await screen.findByText("Connect a local agent later")).toBeTruthy();
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
	onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
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
		modelCatalog: null,
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
		projectFolderPath: "",
		projectSelectionSlot: <div>Project choice</div>,
		recoveryActionHref: "/connect",
	};
	return <AgentProfileGenerator form={form} surface="dialog" />;
}
