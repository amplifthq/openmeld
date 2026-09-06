import { createContext, useContext } from "react";

// Only the entry resolver can release a restored app conversation for actions.
// Public and standalone conversation surfaces retain their own access checks.
export type SpaceEntryConfirmation = {
	confirmed: boolean;
	ensureConfirmed: () => Promise<boolean>;
};

export const SpaceEntryConfirmationContext =
	createContext<SpaceEntryConfirmation>({
		confirmed: true,
		ensureConfirmed: async () => true,
	});

export function useSpaceEntryConfirmation(): SpaceEntryConfirmation {
	return useContext(SpaceEntryConfirmationContext);
}

export function useSpaceEntryConfirmed(): boolean {
	return useSpaceEntryConfirmation().confirmed;
}
