import { ChatCircleTextIcon } from "@phosphor-icons/react";
import { AppModuleSidebar } from "#/components/app/app-module-sidebar";
import { useAppOrganization } from "#/lib/organizations/organization-context";
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
			conversationList="home"
			defaultModuleSidebarOpen={false}
			initialOuterSidebarState={input.initialSidebarStates?.outer}
			sidebarPreferenceKey="spaces"
		>
			<main aria-label="Messages" className="flex min-h-0 min-w-0 flex-1">
				<div className="min-h-0 min-w-0 flex-1 lg:w-88 lg:flex-none">
					<AppModuleSidebar
						label="Messages"
						scrollKey={`${currentUserId}:${currentOrganization.id}:conversations`}
					>
						<ConversationsSidebar home />
					</AppModuleSidebar>
				</div>
				<ConversationSelectionPrompt />
			</main>
		</SpaceWindowShell>
	);
}

export function ConversationSelectionPrompt() {
	return (
		<section className="hidden min-w-0 flex-1 flex-col items-center justify-center gap-3 px-8 text-center lg:flex">
			<ChatCircleTextIcon
				aria-hidden="true"
				className="mb-1 size-10 text-muted-foreground"
			/>
			<h1 className="font-medium text-xl">Pick a conversation</h1>
		</section>
	);
}
