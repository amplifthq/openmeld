import { Button } from "@openmeld/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { XIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useState, useSyncExternalStore } from "react";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationDefaultPath } from "#/lib/organizations/organization-routes";

function subscribe(listener: () => void) {
	window.addEventListener("storage", listener);
	return () => window.removeEventListener("storage", listener);
}

export function PersonalHomeOrganizationHint() {
	const context = useOptionalAppOrganization();
	const key = `openmeld.personal-home-organization-hint.dismissed:${context?.currentUserId ?? ""}`;
	const [dismissedKey, setDismissedKey] = useState<string | null>(null);
	const stored = useSyncExternalStore(
		subscribe,
		() => {
			try {
				return window.localStorage.getItem(key) === "true";
			} catch {
				return false;
			}
		},
		() => true
	);
	if (
		!context?.currentOrganization.isPersonal ||
		stored ||
		dismissedKey === key
	) {
		return null;
	}
	const organizations = context.organizations.filter(
		(item) => !item.isPersonal
	);
	const organization =
		organizations.find((item) => item.id === context.activeOrganization?.id) ??
		organizations[0];
	if (!organization) {
		return null;
	}
	return (
		<div className="-mt-2 inline-flex max-w-full items-center overflow-hidden rounded-full border border-border/60 bg-muted/30 text-muted-foreground shadow-xs">
			<Button
				className="h-7 min-w-0 rounded-none px-2 font-normal text-xs"
				render={<Link to={buildOrganizationDefaultPath(organization.slug)} />}
				variant="ghost"
			>
				<span className="truncate">Go to {organization.name} instead?</span>
			</Button>
			<Tooltip>
				<TooltipTrigger
					render={
						<Button
							aria-label="Don’t show this again"
							className="h-7 w-6 shrink-0 rounded-none p-0"
							onClick={() => {
								setDismissedKey(key);
								try {
									window.localStorage.setItem(key, "true");
								} catch {
									/* Keep dismissal usable when browser storage is blocked. */
								}
							}}
							variant="ghost"
						>
							<XIcon className="size-3" />
						</Button>
					}
				/>
				<TooltipContent side="top">Don’t show this again</TooltipContent>
			</Tooltip>
		</div>
	);
}
