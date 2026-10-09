import { badgeVariants } from "@openmeld/ui/components/badge";
import { cn } from "@openmeld/ui/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { requestInboxSourceFocus } from "#/lib/inbox/source-focus-request";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import { spaceInboxUnreadTargetsQueryOptions } from "#/query/organizations/inbox";

/** Share unread navigation across compact dots and directory badges. */
export function SpaceUnreadLink(input: {
	spaceId: string;
	url: string;
	count: number;
	messageUnreadCount?: number;
	variant?: "dot" | "badge";
}) {
	// The summary counts only messages and unread membership notices. Keep the
	// membership notice in Inbox; present it as New when there are no messages.
	const count = input.messageUnreadCount ?? input.count;
	const isNew = input.count > 0 && input.messageUnreadCount === 0;
	let label = count > 0 ? `${count} unread` : "Unread";
	let accessibleLabel =
		count > 0
			? `${count} unread ${count === 1 ? "update" : "updates"}. Jump to first unread`
			: "Unread updates. Jump to first unread";
	if (isNew) {
		label = "New";
		accessibleLabel = "New Space. Open to view";
	}
	const organization = useOptionalAppOrganization();
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const currentHref = useLocation({ select: (location) => location.href });
	const attempt = useRef(0);
	// biome-ignore lint/correctness/useExhaustiveDependencies: A different navigation cancels a pending unread jump.
	useEffect(
		() => () => {
			attempt.current += 1;
		},
		[currentHref]
	);
	const query = organization
		? spaceInboxUnreadTargetsQueryOptions({
				organizationId: organization.currentOrganization.id,
				spaceId: input.spaceId,
			})
		: null;
	const preload = () => {
		if (query) {
			queryClient.prefetchQuery(query);
		}
	};
	const destination = new URL(input.url, "https://openmeld.invalid");
	return (
		<Link
			aria-label={accessibleLabel}
			className={
				input.variant === "badge"
					? cn(
							badgeVariants({ variant: "secondary" }),
							"pointer-events-auto relative gap-1.5 bg-unread/10 px-1.5 text-foreground/85 tabular-nums outline-none hover:bg-unread/15 motion-reduce:transition-none"
						)
					: "status-dot pointer-events-auto relative bg-unread outline-none focus-visible:ring-1 focus-visible:ring-ring"
			}
			data-conversation-unread-indicator="true"
			onClick={async (event) => {
				if (
					event.button !== 0 ||
					event.metaKey ||
					event.ctrlKey ||
					event.shiftKey ||
					event.altKey ||
					!query
				) {
					return;
				}
				event.preventDefault();
				event.stopPropagation();
				const request = ++attempt.current;
				try {
					// Use the same cache/freshness policy as the Space. Do not force a
					// second round trip after pointer-intent preloading or a visible read.
					const data = await queryClient.fetchQuery(query);
					if (request !== attempt.current) {
						return;
					}
					const target = data.targets[0];
					for (const key of [
						"view",
						"focusInteractionId",
						"focusSignalId",
						"focusThreadRootSignalId",
					]) {
						destination.searchParams.delete(key);
					}
					if (target) {
						destination.searchParams.set("focusSignalId", target.signalId);
						if (target.threadRootSignalId) {
							destination.searchParams.set(
								"focusThreadRootSignalId",
								target.threadRootSignalId
							);
						}
					}
					await navigate({
						to: destination.pathname,
						search: Object.fromEntries(destination.searchParams),
						state: requestInboxSourceFocus,
						resetScroll: false,
					});
				} catch {
					if (request === attempt.current) {
						toast.error("Couldn’t open unread updates. Try again.");
					}
				}
			}}
			onFocus={preload}
			onPointerEnter={preload}
			resetScroll={false}
			search={Object.fromEntries(destination.searchParams)}
			to={destination.pathname}
		>
			{input.variant === "badge" && (
				<>
					<span
						aria-hidden
						className="size-1.5 shrink-0 rounded-full bg-unread"
					/>
					{label}
				</>
			)}
		</Link>
	);
}
