"use client";

import { createContext, type ReactNode, useContext, useMemo } from "react";

type AppNavigationPresentation = "drawer" | "inline";

type AppNavigationPresentationContextValue = {
	dismiss: () => void;
	presentation: AppNavigationPresentation;
};

const AppNavigationPresentationContext =
	createContext<AppNavigationPresentationContextValue>({
		dismiss: () => undefined,
		presentation: "inline",
	});

export function AppNavigationPresentationProvider(input: {
	children: ReactNode;
	dismiss?: () => void;
	presentation: AppNavigationPresentation;
}) {
	const value = useMemo<AppNavigationPresentationContextValue>(
		() => ({
			dismiss: input.dismiss ?? (() => undefined),
			presentation: input.presentation,
		}),
		[input.dismiss, input.presentation]
	);

	return (
		<AppNavigationPresentationContext.Provider value={value}>
			{input.children}
		</AppNavigationPresentationContext.Provider>
	);
}

export function useAppNavigationPresentation() {
	return useContext(AppNavigationPresentationContext);
}
