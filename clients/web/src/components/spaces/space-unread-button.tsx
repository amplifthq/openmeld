import { TooltipHint } from "@openmeld/ui/components/tooltip";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { requestInboxSourceFocus } from "#/lib/inbox/source-focus-request";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import { spaceInboxUnreadTargetsQueryOptions } from "#/query/organizations/inbox";

export function SpaceUnreadButton(input: {
	spaceId: string;
	url: string;
	count: number;
	showCount?: boolean;
}) {
	const organization = useOptionalAppOrganization();
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const [pending, setPending] = useState(false);
	return (
		<TooltipHint content="Jump to first unread">
			<button
				aria-label={`${input.count} unread ${input.count === 1 ? "update" : "updates"}. Jump to first unread`}
				className="pointer-events-auto relative z-10 inline-flex min-h-7 min-w-7 items-center justify-center gap-2 rounded-sm text-muted-foreground text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
				disabled={pending}
				onClick={async (event) => {
					event.stopPropagation();
					if (!organization || pending) {
						return;
					}
					setPending(true);
					try {
						const data = await queryClient.fetchQuery({
							...spaceInboxUnreadTargetsQueryOptions({
								organizationId: organization.currentOrganization.id,
								spaceId: input.spaceId,
							}),
							staleTime: 0,
						});
						const target = data.targets[0];
						const url = new URL(input.url, "https://openmeld.invalid");
						for (const key of [
							"view",
							"focusInteractionId",
							"focusSignalId",
							"focusThreadRootSignalId",
						]) {
							url.searchParams.delete(key);
						}
						if (target) {
							url.searchParams.set("focusSignalId", target.signalId);
							if (target.threadRootSignalId) {
								url.searchParams.set(
									"focusThreadRootSignalId",
									target.threadRootSignalId
								);
							}
						}
						await navigate({
							to: url.pathname,
							search: Object.fromEntries(url.searchParams),
							state: requestInboxSourceFocus,
							resetScroll: false,
						});
					} catch {
						toast.error("Couldn’t open unread updates. Try again.");
					} finally {
						setPending(false);
					}
				}}
				type="button"
			>
				<span aria-hidden="true" className="status-dot bg-unread" />
				{input.showCount && <span>{input.count} unread</span>}
			</button>
		</TooltipHint>
	);
}
