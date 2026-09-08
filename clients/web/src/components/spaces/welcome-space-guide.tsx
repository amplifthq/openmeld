import { ChatCircleIcon, PlusIcon } from "@phosphor-icons/react";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { EmptyStateSetupActionCard } from "./onboarding-setup-banner";
import type { OnboardingSetupPresentation } from "./onboarding-setup-presentation";
import { useWelcomeSpace } from "./welcome-space-state";

export function WelcomeSpaceLabel({ spaceId }: { spaceId: string }) {
	const { storageScope } = useAppOrganization();
	const step = useWelcomeSpace(storageScope, spaceId);
	return step ? (
		<span className="shrink-0 rounded border px-1.5 py-0.5 font-normal text-muted-foreground text-xs">
			Welcome
		</span>
	) : null;
}

export function WelcomeSpaceGuide(input: {
	presentation: OnboardingSetupPresentation;
	scope: string;
	spaceId: string;
	onAddAgents?: () => void;
	hasRecipients: boolean;
	hasDraft: boolean;
	onPrepareConversation: () => void;
}) {
	const step = useWelcomeSpace(input.scope, input.spaceId);
	if (input.presentation !== "empty-state" || !step || step === "prepare") {
		return null;
	}
	if (step === "done") {
		return null;
	}
	return (
		<section
			aria-label="Welcome Space guide"
			className="mx-auto grid w-full max-w-xl gap-4 py-4"
		>
			{!input.hasRecipients && input.onAddAgents && (
				<EmptyStateSetupActionCard
					description="Choose an existing agent or create one to join this Space."
					icon={<PlusIcon className="size-5" />}
					itemId="welcome-add-agent"
					onClick={input.onAddAgents}
					presentation="centered"
					title="Add your first agent"
				/>
			)}
			{input.hasRecipients && !input.hasDraft && (
				<EmptyStateSetupActionCard
					description="Prepare a message to the members you added. You can edit it before sending."
					icon={<ChatCircleIcon className="size-5" />}
					itemId="welcome-start-conversation"
					onClick={input.onPrepareConversation}
					presentation="centered"
					title="Start a conversation"
				/>
			)}
			{input.hasRecipients && input.hasDraft && (
				<div className="grid gap-2 rounded-md border border-border/70 border-dashed px-6 py-6 text-center">
					<p className="font-medium text-base">Send your first message</p>
					<p className="text-muted-foreground text-sm">
						Your draft is below. Edit it or send it to start the conversation.
					</p>
				</div>
			)}
		</section>
	);
}
