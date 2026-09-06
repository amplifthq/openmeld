import { createContext, useContext } from "react";

// Only the entry resolver can release a restored app conversation for actions.
// Public and standalone conversation surfaces retain their own access checks.
export const SpaceEntryConfirmationContext = createContext(true);
export const SpaceEntryRetryContext = createContext<{
	retry: () => Promise<void>;
	isError: boolean;
} | null>(null);

export function useSpaceEntryRetry() {
	return useContext(SpaceEntryRetryContext);
}

export function useSpaceEntryConfirmed(): boolean {
	return useContext(SpaceEntryConfirmationContext);
}
