import type { StructuredApiClientFailure } from "@openmeld/api-client";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { listOrganizations } from "#/lib/organizations/auth-organizations";
import type { OrganizationSummary } from "#/lib/organizations/organization-types";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";

/**
 * The single Core classification code this hook is allowed to self-heal. Any
 * other failure is passed through untouched so real errors stay visible.
 */
const MEMBERSHIP_REQUIRED_CODE = "organization.membership_required";

export type OrganizationMembershipSelfHealStatus =
	/** No membership_required failure is present; render the query normally. */
	| "inactive"
	/** A one-time repair is running (re-resolving the membership list). */
	| "healing"
	/**
	 * The URL organization is confirmed in the refreshed membership list, the
	 * Organization caches were invalidated, and the org-scoped query is
	 * refetching with its explicit URL Organization context.
	 */
	| "recovering"
	/**
	 * The URL organization is not in the refreshed membership list. The caller
	 * should surface the organization-access-denied experience.
	 */
	| "access-denied"
	/**
	 * The repair itself failed while re-resolving membership or refetching. The
	 * caller should surface a graceful, actionable error.
	 */
	| "failed";

export type OrganizationScopedQueryLike = {
	error: StructuredApiClientFailure | null;
	/**
	 * Timestamp (ms) of the most recent error, from TanStack Query. It advances
	 * on every failure — including a repeated failure after a refetch — so the
	 * repair state machine reacts to each fresh membership mismatch instead of
	 * stalling when the boolean error flag stays constant.
	 */
	errorUpdatedAt: number;
	isError: boolean;
	refetch: () => Promise<unknown>;
};

export type UseOrganizationMembershipSelfHealResult = {
	status: OrganizationMembershipSelfHealStatus;
};

export function isOrganizationMembershipRequiredFailure(
	error: StructuredApiClientFailure | null | undefined
): boolean {
	return error?.code === MEMBERSHIP_REQUIRED_CODE;
}

/**
 * Performs one bounded membership revalidation for org-scoped data queries.
 *
 * When a query fails with `organization.membership_required`, this performs
 * exactly one automatic revalidation:
 *
 * 1. Re-resolve the caller's organizations from the auth service.
 * 2. If the URL organization is still a membership, invalidate Organization
 *    projections and refetch with the same explicit URL context.
 * 3. Otherwise report `access-denied` so the caller can route to the existing
 *    organization-access-denied page.
 *
 * The repair runs at most once per `currentOrganization.id` to prevent loops.
 * It never changes the shared Auth Session or introduces another Organization
 * source of truth.
 */
export function useOrganizationMembershipSelfHeal(input: {
	currentOrganization: OrganizationSummary;
	query: OrganizationScopedQueryLike;
}): UseOrganizationMembershipSelfHealResult {
	const queryClient = useQueryClient();
	const { currentOrganization, query } = input;
	const currentOrganizationId = currentOrganization.id;

	const [status, setStatus] =
		useState<OrganizationMembershipSelfHealStatus>("inactive");
	// The organization the current verdict/attempt belongs to, so switching
	// organizations re-arms the repair and drops a stale terminal verdict.
	const attemptOrganizationIdRef = useRef<string>(currentOrganizationId);
	// The `errorUpdatedAt` that a repair was started for. A newer failure
	// timestamp means the post-repair refetch failed again, which must not
	// trigger a second repair (loop guard).
	const attemptErrorUpdatedAtRef = useRef<number | null>(null);

	const shouldHeal =
		query.isError && isOrganizationMembershipRequiredFailure(query.error);
	const errorUpdatedAt = query.errorUpdatedAt;

	useEffect(() => {
		if (attemptOrganizationIdRef.current !== currentOrganizationId) {
			// The URL organization changed; re-arm the one-shot repair and drop
			// the previous organization's verdict before evaluating the new one.
			attemptOrganizationIdRef.current = currentOrganizationId;
			attemptErrorUpdatedAtRef.current = null;
			setStatus("inactive");
		}

		if (!shouldHeal) {
			// The query is healthy (or failed for a different, non-membership
			// reason). Clear any stale "recovering"/"healing" verdict so it never
			// masks the real state.
			setStatus((previous) =>
				previous === "healing" || previous === "recovering"
					? "inactive"
					: previous
			);
			return;
		}

		const attemptedErrorUpdatedAt = attemptErrorUpdatedAtRef.current;
		if (attemptedErrorUpdatedAt !== null) {
			if (errorUpdatedAt > attemptedErrorUpdatedAt) {
				// The repair ran but the query failed again with the same membership
				// mismatch. Do not loop: settle on a terminal error so the caller can
				// offer an executable way out instead of spinning.
				setStatus((previous) =>
					previous === "access-denied" ? previous : "failed"
				);
			}
			// Same failure the repair is already handling: leave the verdict alone.
			return;
		}
		attemptErrorUpdatedAtRef.current = errorUpdatedAt;

		let cancelled = false;
		setStatus("healing");

		healOrganizationMembership({
			currentOrganization,
			queryClient,
			refetch: query.refetch,
		})
			.then((verdict) => {
				if (!cancelled) {
					setStatus(verdict);
				}
			})
			.catch((error: unknown) => {
				console.warn(
					"[openmeld.web.organization_membership_self_heal_failed]",
					{
						currentOrganizationId,
						error: error instanceof Error ? error.message : String(error),
					}
				);
				if (!cancelled) {
					setStatus("failed");
				}
			});

		return () => {
			cancelled = true;
		};
	}, [
		currentOrganization,
		currentOrganizationId,
		errorUpdatedAt,
		query.refetch,
		queryClient,
		shouldHeal,
	]);

	return { status };
}

async function healOrganizationMembership(input: {
	currentOrganization: OrganizationSummary;
	queryClient: QueryClient;
	refetch: () => Promise<unknown>;
}): Promise<
	Extract<
		OrganizationMembershipSelfHealStatus,
		"access-denied" | "failed" | "recovering"
	>
> {
	const organizations = await listOrganizations();
	const stillMember = organizations.some(
		(organization) => organization.id === input.currentOrganization.id
	);
	if (!stillMember) {
		return "access-denied";
	}

	await input.queryClient.invalidateQueries({
		queryKey: organizationQueryKeys.all,
	});
	await input.refetch();
	return "recovering";
}
