import type { ModelCatalog } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { TooltipProvider } from "@openmeld/ui/components/tooltip";
import {
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { AgentProfileGenerator } from "../../src/components/profiles/agent-profile-generator";
import type { CreateProfileFormProps } from "../../src/components/profiles/create-profile-form";
import { useAgentCreationComputerRecovery } from "../../src/components/profiles/use-agent-creation-computer-recovery";
import {
	agentCreationComputerFixture,
	agentCreationRecoveryFixture,
} from "../../src/test-support/agent-creation-computer-fixtures";
import {
	PreviewState,
	type Scenario,
	type SetupStage,
	scenarios,
} from "./preview-state";
import "./preview.css";

const catalog: ModelCatalog = {
	schemaVersion: 1,
	updatedAt: "2026-09-10T00:00:00Z",
	agentControllers: {
		codex: {
			defaultModelId: "gpt-5.6-sol",
			models: [
				{
					id: "gpt-5.6-sol",
					displayName: "GPT-5.6 Sol",
					minCliVersion: null,
					supportedReasoningLevels: ["low", "medium", "high"],
					unavailable: false,
				},
			],
		},
		"claude-code": {
			defaultModelId: "claude-opus-4-8",
			models: [
				{
					id: "claude-opus-4-8",
					displayName: "Claude Opus 4.8",
					minCliVersion: null,
					supportedReasoningLevels: [],
					unavailable: false,
				},
			],
		},
	},
};

function Preview() {
	const initial =
		new URLSearchParams(window.location.search).get("scenario") ?? "offline";
	const [scenario, setScenario] = useState<Scenario>(
		initial in scenarios ? (initial as Scenario) : "offline"
	);
	const [stage, setStage] = useState<SetupStage>("command");
	const [open, setOpen] = useState(true);
	const [created, setCreated] = useState(false);
	const [dark, setDark] = useState(false);
	return (
		<PreviewState value={{ stage, setStage, setScenario }}>
			<div className={dark ? "dark" : ""}>
				<main className="flex min-h-screen bg-background text-foreground">
					<aside className="hidden w-56 border-r bg-muted/30 p-5 sm:block">
						<p className="mb-8 font-medium">OpenMeld</p>
						<p className="text-muted-foreground text-sm">Spaces</p>
						<p className="mt-3 text-sm">Product team</p>
					</aside>
					<section className="flex-1 p-8">
						<div className="flex items-center justify-between">
							<h1 className="font-medium">Product team</h1>
							<Button onClick={() => setOpen(true)} variant="outline">
								Add people and agents
							</Button>
						</div>
						<p className="mt-10 text-muted-foreground text-sm">
							{created
								? "Agent created in preview. Continue choosing who to add to this Space."
								: "Agent creation connection recovery · local UI preview"}
						</p>
					</section>
				</main>
				<Dialog onOpenChange={setOpen} open={open}>
					<DialogContent className="flex max-h-[calc(100dvh-2rem)] min-w-0 flex-col overflow-hidden sm:max-w-3xl">
						<div className="flex flex-wrap items-center gap-2 border-b pr-7 pb-3 text-xs">
							<span className="text-muted-foreground">Mock controls</span>
							<select
								aria-label="Preview scenario"
								className="h-8 rounded-md border bg-background px-2"
								onChange={(event) => {
									setScenario(event.target.value as Scenario);
									setStage("command");
								}}
								value={scenario}
							>
								{Object.entries(scenarios).map(([value, label]) => (
									<option key={value} value={value}>
										{label}
									</option>
								))}
							</select>
							<Button onClick={() => setDark(!dark)} size="sm" variant="ghost">
								Theme
							</Button>
							<Button
								onClick={() => setStage("connecting")}
								size="sm"
								variant="ghost"
							>
								Simulate connecting
							</Button>
							<Button
								onClick={() => setStage("failed")}
								size="sm"
								variant="ghost"
							>
								Simulate failure
							</Button>
							<Button
								onClick={() => setStage("completed")}
								size="sm"
								variant="ghost"
							>
								Simulate success
							</Button>
						</div>
						<Button
							className="self-start"
							onClick={() => setOpen(false)}
							size="sm"
							variant="ghost"
						>
							Back to people and agents
						</Button>
						<DialogHeader>
							<DialogTitle>Create a new Agent</DialogTitle>
							<DialogDescription>
								Create an Agent, then return to select who to add to this Space.
							</DialogDescription>
						</DialogHeader>
						<CreationPreview
							onCreated={() => {
								setCreated(true);
								setOpen(false);
							}}
							onRetry={() => setScenario("ready")}
							scenario={scenario}
						/>
					</DialogContent>
				</Dialog>
			</div>
		</PreviewState>
	);
}

function CreationPreview(input: {
	scenario: Scenario;
	onCreated: () => void;
	onRetry: () => void;
}) {
	const [name, setName] = useState("Release helper");
	const [agent, setAgent] = useState("codex");
	const [model, setModel] = useState("");
	const [reasoning, setReasoning] = useState("low");
	const [permission, setPermission] = useState<
		CreateProfileFormProps["boundAgentControllerPermissionMode"]
	>("codex:askForApproval");
	const [confirmed, setConfirmed] = useState(true);
	const [folder, setFolder] = useState("");
	const [device, setDevice] = useState("office-mac");
	const ready = input.scenario === "ready" || input.scenario === "two_ready";
	const computers =
		input.scenario === "new"
			? []
			: [
					agentCreationComputerFixture(),
					...(input.scenario === "multiple" || input.scenario === "two_ready"
						? [agentCreationComputerFixture("Studio Mac", "studio-mac")]
						: []),
				];
	const guidance = {
		checking: "checking",
		error: "check_failed",
		local_agents: "set_up_local_agents",
		ready: "set_up_local_agents",
		two_ready: "set_up_local_agents",
	} as const;
	const recovery = useAgentCreationComputerRecovery({
		enabled: true,
		orgSlug: "preview",
		recovery: agentCreationRecoveryFixture({
			computers,
			deviceId:
				input.scenario === "new" || input.scenario === "multiple"
					? null
					: device,
			onSelect: (target) => setDevice(target.deviceId),
		}),
		guidance:
			input.scenario in guidance
				? guidance[input.scenario as keyof typeof guidance]
				: "connect_computer",
		hasLocalAgents: ready,
		isPending: input.scenario === "checking",
		onRetry: input.onRetry,
	});
	const form: CreateProfileFormProps = {
		...recovery,
		additionalHumanProfileCreationEnabled: false,
		agentComputerSlot:
			input.scenario === "two_ready" ? (
				<label className="grid gap-2 text-sm">
					Computer
					<select
						aria-label="Computer"
						className="h-9 rounded-md border bg-background px-3"
						onChange={(event) => setDevice(event.target.value)}
						value={device}
					>
						{computers.map((computer) => (
							<option key={computer.deviceId} value={computer.deviceId}>
								{computer.deviceDisplayName} · Connected
							</option>
						))}
					</select>
				</label>
			) : undefined,
		agentOwnershipSummary: "Alex Morgan",
		agentOwnershipSlot: <p className="text-sm">Alex Morgan · You</p>,
		agentSessionSummary: "New session",
		availableLocalAgentIds: ["codex", "claude-code"],
		boundAgentId: agent,
		boundAgentControllerCollaborationMode: null,
		boundAgentControllerPermissionMode: permission,
		boundAgentControllerPermissionModeConfirmed: confirmed,
		boundModelId: model,
		boundOpenCodePermission: null,
		boundReasoningLevel: reasoning,
		errorState: null,
		isResolvingAccount: false,
		isResolvingLocalAgents: false,
		isSubmitting: false,
		localFolderPickerDeviceId: null,
		modelCatalog: catalog,
		onChangeBoundAgentControllerCollaborationMode: () => undefined,
		onChangeBoundAgentControllerPermissionMode: setPermission,
		onChangeBoundAgentControllerPermissionModeConfirmed: setConfirmed,
		onChangeBoundAgentId: setAgent,
		onChangeBoundModelId: setModel,
		onChangeBoundOpenCodePermission: () => undefined,
		onChangeBoundReasoningLevel: setReasoning,
		onChangeProfileName: setName,
		onChangeProjectFolderPath: setFolder,
		onSelectProfileKind: () => undefined,
		onSubmit: (event) => {
			event.preventDefault();
			input.onCreated();
		},
		profileKind: "agent",
		profileName: name,
		projectFolderPath: folder,
		projectSelectionSummary: "OpenMeld managed",
		recoveryActionHref: "/",
		remoteAgentCreation: { onSubmit: input.onCreated },
	};
	return <AgentProfileGenerator form={form} surface="dialog" />;
}

const rootRoute = createRootRoute({ component: Preview });
const page = createRoute({ getParentRoute: () => rootRoute, path: "/" });
const router = createRouter({ routeTree: rootRoute.addChildren([page]) });
const root = document.getElementById("root");
if (!root) {
	throw new Error("Missing preview root");
}
createRoot(root).render(
	<TooltipProvider>
		<RouterProvider router={router} />
	</TooltipProvider>
);
