import { buttonVariants } from "@openmeld/ui/components/button";
import { ChatCircleTextIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { AppModuleSidebar } from "#/components/app/app-module-sidebar";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationSpacesPath } from "#/lib/organizations/organization-routes";
import type { AppSidebarPersistedStates } from "#/lib/sidebar-width-cookie";
import { SpaceWindowShell } from "./app-space-shell";
import { ConversationsSidebar } from "./conversations-sidebar";

/** The conversation list is the home page, not a hidden navigation drawer. */
export function ConversationsHome(input: {
	initialSidebarStates?: AppSidebarPersistedStates;
}) {
	const { currentOrganization, currentUserId } = useAppOrganization();
	return (
		<SpaceWindowShell
			defaultModuleSidebarOpen={false}
			initialOuterSidebarState={input.initialSidebarStates?.outer}
			sidebarPreferenceKey="spaces"
		>
			<main aria-label="Chats" className="flex min-h-0 min-w-0 flex-1">
				<div className="min-h-0 min-w-0 flex-1 lg:w-88 lg:flex-none">
					<AppModuleSidebar
						label="Conversations"
						scrollKey={`${currentUserId}:${currentOrganization.id}:conversations`}
					>
						<ConversationsSidebar home />
					</AppModuleSidebar>
				</div>
				<section className="hidden min-w-0 flex-1 flex-col items-center justify-center gap-3 px-8 text-center lg:flex">
					<ChatCircleTextIcon
						aria-hidden="true"
						className="mb-1 size-10 text-muted-foreground"
					/>
					<h1 className="font-medium text-xl">Pick a conversation</h1>
					<p className="max-w-sm text-muted-foreground text-sm">
						Your Spaces and direct messages, together. Choose a chat to pick up
						where you left off.
					</p>
					<Link
						className={buttonVariants({ variant: "outline", size: "sm" })}
						search={{ view: "spaces" }}
						to={buildOrganizationSpacesPath(currentOrganization.slug)}
					>
						Browse Spaces
					</Link>
				</section>
			</main>
		</SpaceWindowShell>
	);
}
