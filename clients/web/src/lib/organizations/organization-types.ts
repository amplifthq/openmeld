import type { OrganizationSummary } from "@openmeld/schemas";

export type { OrganizationSummary } from "@openmeld/schemas";

export type OrganizationRole = "admin" | "member" | "owner" | string;

export type OrganizationScopeAccount = {
	email?: string | null;
	image?: string | null;
	name?: string | null;
};

export type OrganizationScopeAuthorized = {
	access: "authorized";
	account: OrganizationScopeAccount;
	activeOrganization: OrganizationSummary | null;
	currentOrganization: OrganizationSummary;
	currentUserId: string;
	organizations: OrganizationSummary[];
	storageScope: string;
};

export type OrganizationScopeDenied = {
	access: "denied";
	account: OrganizationScopeAccount;
	activeOrganization: OrganizationSummary | null;
	currentUserId: string;
	organizations: OrganizationSummary[];
	storageScope: string;
};

export type OrganizationScopeResolution =
	| OrganizationScopeAuthorized
	| OrganizationScopeDenied;
