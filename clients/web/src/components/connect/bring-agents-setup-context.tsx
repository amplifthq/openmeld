"use client";

import { createContext, type PropsWithChildren, use, useMemo } from "react";
import type { ConnectRouteIntent } from "#/lib/connect/connect-route";
import { useBringAgentsSetup } from "./use-bring-agents-setup";

type BringAgentsSetupContextValue = ReturnType<typeof useBringAgentsSetup> & {
	routeIntent: ConnectRouteIntent;
};

const BringAgentsSetupContext =
	createContext<BringAgentsSetupContextValue | null>(null);

export function BringAgentsSetupProvider(
	input: PropsWithChildren<{ routeIntent: ConnectRouteIntent }>
) {
	const setup = useBringAgentsSetup(input.routeIntent);
	const value = useMemo(
		() => ({ ...setup, routeIntent: input.routeIntent }),
		[setup, input.routeIntent]
	);

	return (
		<BringAgentsSetupContext.Provider value={value}>
			{input.children}
		</BringAgentsSetupContext.Provider>
	);
}

export function useBringAgentsSetupContext() {
	const value = use(BringAgentsSetupContext);
	if (!value) {
		throw new Error(
			"Connect setup context is unavailable outside App Connect."
		);
	}

	return value;
}
