import { ArrowLeftIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";

/**
 * A MemberAgent link that no longer resolves (another Organization, removed
 * Agent): says so and offers the same local return as other Agent detail
 * pages.
 */
export function UnknownMemberAgentNotice(input: { agentsPath: string }) {
	return (
		<div className="grid min-h-full place-items-center px-6 py-12 text-center text-muted-foreground text-sm">
			<div className="grid justify-items-center gap-3">
				<p>This Agent isn’t available in this Organization.</p>
				<Link
					className="inline-flex items-center gap-2 text-muted-foreground text-sm hover:text-foreground"
					to={input.agentsPath}
				>
					<ArrowLeftIcon aria-hidden="true" />
					Back to Agents
				</Link>
			</div>
		</div>
	);
}
