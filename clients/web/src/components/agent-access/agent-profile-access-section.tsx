import { Button } from "@openmeld/ui/components/button";
import { SkeletonRows } from "@openmeld/ui/components/skeleton-content";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@openmeld/ui/fluid/accordion";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import type { ReactNode } from "react";
import { isMemberAgentsEnabled } from "#/lib/member-agents/member-agents-feature";
import {
	useAgentProfileAccessGrants,
	useRevokeAgentProfileAccessGrant,
} from "#/query/agent-access";

/**
 * Owner-only, collapsed until opened: who may use this Agent without asking,
 * and Revoke, then any other sensitive history the page adds (`children`),
 * all in one scroll area. Revoking stops new tasks; tasks already running
 * finish.
 */
export function AgentProfileAccessSection(input: {
	enabled: boolean;
	profileId: string;
	children?: ReactNode;
}) {
	if (!(input.enabled && isMemberAgentsEnabled())) {
		return null;
	}
	return (
		<section aria-labelledby="agent-access-heading" className="max-w-3xl">
			<Accordion>
				<AccordionItem value="access">
					<AccordionTrigger className="py-1">
						<span
							className="block font-medium text-sm"
							id="agent-access-heading"
						>
							Who can use this Agent
						</span>
						<span className="mt-1 block font-normal text-muted-foreground text-sm">
							Colleagues you allowed, and sensitive changes to this Agent.
						</span>
					</AccordionTrigger>
					<AccordionContent>
						<ScrollArea
							className="mt-3 max-h-[28rem]"
							data-slot="agent-access-scroll"
						>
							<div className="grid gap-6 pr-3">
								<AgentProfileAccessList profileId={input.profileId} />
								{input.children}
							</div>
						</ScrollArea>
					</AccordionContent>
				</AccordionItem>
			</Accordion>
		</section>
	);
}

function AgentProfileAccessList(input: { profileId: string }) {
	const grants = useAgentProfileAccessGrants(input.profileId);
	const revoke = useRevokeAgentProfileAccessGrant(input.profileId);
	return (
		<div className="grid gap-3">
			<p className="text-muted-foreground text-sm">
				Colleagues you allowed can start work without asking. Revoking stops new
				work; anything already running finishes.
			</p>
			{grants.isPending ? (
				<SkeletonRows label="Loading access" rows={2} />
			) : null}
			{grants.isError ? (
				<p className="text-destructive text-sm" role="alert">
					Couldn't load who can use this Agent.
				</p>
			) : null}
			{grants.data?.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					No one else can use this Agent without asking you first.
				</p>
			) : null}
			{grants.data && grants.data.length > 0 ? (
				<ul className="divide-y divide-border rounded-lg border border-border">
					{grants.data.map((grant) => (
						<li
							className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
							key={grant.id}
						>
							<span className="min-w-0">
								<span className="block truncate">{grant.granteeName}</span>
								<span className="block text-muted-foreground text-xs">
									{grant.scope === "always"
										? "Always allowed"
										: "Allowed for one chat"}
								</span>
							</span>
							<Button
								disabled={revoke.isPending}
								onClick={() => revoke.mutate(grant.id)}
								size="sm"
								variant="outline"
							>
								Revoke
							</Button>
						</li>
					))}
				</ul>
			) : null}
			{revoke.error ? (
				<p className="text-destructive text-sm" role="alert">
					{revoke.error.message}
				</p>
			) : null}
		</div>
	);
}
