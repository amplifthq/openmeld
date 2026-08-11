"use client";

import { createContext, type ReactNode, use } from "react";
import type { SlackOAuthResult } from "#/lib/organizations/slack-oauth-result";

export type CenterAgentRouteState = {
	appsSelectedService: string | null;
	channelsSlackOAuthResult?: SlackOAuthResult;
};

const DEFAULT_CENTER_AGENT_ROUTE_STATE: CenterAgentRouteState = {
	appsSelectedService: null,
};

const CenterAgentRouteStateContext = createContext<CenterAgentRouteState>(
	DEFAULT_CENTER_AGENT_ROUTE_STATE
);

export function CenterAgentRouteStateProvider(input: {
	children: ReactNode;
	value?: Partial<CenterAgentRouteState>;
}) {
	return (
		<CenterAgentRouteStateContext.Provider
			value={{ ...DEFAULT_CENTER_AGENT_ROUTE_STATE, ...input.value }}
		>
			{input.children}
		</CenterAgentRouteStateContext.Provider>
	);
}

export function useCenterAgentRouteState(): CenterAgentRouteState {
	return use(CenterAgentRouteStateContext);
}
