"use client";

import { createContext, type PropsWithChildren, use, useMemo } from "react";
import type {
	OrganizationScopeAccount,
	OrganizationScopeAuthorized,
	OrganizationSummary,
} from "./organization-types";

type AppOrganizationContextValue = {
	account: OrganizationScopeAccount;
	activeOrganization: OrganizationSummary | null;
	currentOrganization: OrganizationSummary;
	currentUserId: string;
	organizations: OrganizationSummary[];
	storageScope: string;
};

const AppOrganizationContext =
	createContext<AppOrganizationContextValue | null>(null);

export function AppOrganizationProvider(
	input: PropsWithChildren<{
		scope: OrganizationScopeAuthorized;
	}>
) {
	const value = useMemo<AppOrganizationContextValue>(
		() => ({
			account: input.scope.account,
			activeOrganization: input.scope.activeOrganization,
			currentOrganization: input.scope.currentOrganization,
			currentUserId: input.scope.currentUserId,
			organizations: input.scope.organizations,
			storageScope: input.scope.storageScope,
		}),
		[
			input.scope.account,
			input.scope.activeOrganization,
			input.scope.currentOrganization,
			input.scope.currentUserId,
			input.scope.organizations,
			input.scope.storageScope,
		]
	);

	return (
		<AppOrganizationContext.Provider value={value}>
			{input.children}
		</AppOrganizationContext.Provider>
	);
}

export function useAppOrganization(): AppOrganizationContextValue {
	const value = use(AppOrganizationContext);
	if (!value) {
		throw new Error(
			"Organization context is unavailable outside the organization app shell."
		);
	}
	return value;
}

export function useOptionalAppOrganization(): AppOrganizationContextValue | null {
	return use(AppOrganizationContext);
}

export function useCurrentOrganizationSlug(): string {
	return useAppOrganization().currentOrganization.slug;
}

export function useOptionalCurrentOrganizationSlug(): string | undefined {
	return use(AppOrganizationContext)?.currentOrganization.slug;
}
