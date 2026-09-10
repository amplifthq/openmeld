import { createContext } from "react";

export const scenarios = {
	new: "First connection",
	offline: "Saved computer offline",
	checking: "Checking connection",
	error: "Connection check failed",
	local_agents: "Connected, no local agent",
	ready: "Connected and ready",
	multiple: "Two saved computers offline",
	two_ready: "Two available computers",
} as const;
export type Scenario = keyof typeof scenarios;
export type SetupStage = "command" | "connecting" | "failed" | "completed";
export const PreviewState = createContext<{
	stage: SetupStage;
	setStage: (stage: SetupStage) => void;
	setScenario: (scenario: Scenario) => void;
}>({
	stage: "command",
	setStage: () => undefined,
	setScenario: () => undefined,
});
