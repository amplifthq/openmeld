import { OpenMeldLogoStrong } from "@openmeld/ui/components/openmeld-logo-strong";
import { TooltipProvider } from "@openmeld/ui/components/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { MessageResponse } from "../../src/components/ai/message-response";
import { APP_APPLICATION_RAIL_CLASS_NAME } from "../../src/components/app/app-nav-item-style";
import {
	AppRailNavigationGroup,
	buildAppRailGroups,
} from "../../src/components/app/app-rail-navigation";
import { AppSurfaceLayout } from "../../src/components/app/app-surface-layout";
import { ConversationsSidebar } from "../../src/components/spaces/conversations-sidebar";
import { Bubble } from "../../src/components/spaces/primitives/bubble";
import {
	Message,
	MessageContent,
	MessageHeader,
} from "../../src/components/spaces/primitives/message";
import { SpaceComposer } from "../../src/components/spaces/space-composer";
import type { SpaceComposerEditorHandle } from "../../src/components/spaces/space-composer-editor";
import { SpaceWindowHeader } from "../../src/components/spaces/space-header";
import { resolveSpaceMessageBubblePresentationClass } from "../../src/components/spaces/space-message-bubble-style";
import { SpaceMessageProfileAvatar } from "../../src/components/spaces/space-message-profile-avatar";
import { SpaceMessageSurface } from "../../src/components/spaces/space-message-surface";
import { SpaceMessageTime } from "../../src/components/spaces/space-message-time";
import "../sidebar-preview/preview.css";

// Capture-only composition. Every product surface is imported from Web.
// Only the conversation content and account/query transport are fixtures.
const transcript = [
	{
		name: "Maya Chen",
		kind: "human" as const,
		controller: null,
		text: "Can we ship the new onboarding flow on Friday? Review the implementation and flag anything we need to fix first.",
	},
	{
		name: "Codex",
		kind: "agent" as const,
		controller: "codex",
		text: "Found a retry that sends the welcome email twice. Added a guard and a regression test. The draft PR is ready for review.",
	},
	{
		name: "Claude Code",
		kind: "agent" as const,
		controller: "claude-code",
		text: "Reviewed the patch. The duplicate email is covered.\n\n**Before Friday:** Test sign-in on mobile and confirm the welcome email copy.\n\nNothing merged or deployed.",
	},
];
const client = new QueryClient({
	defaultOptions: { queries: { retry: false } },
});
function Preview() {
	const composerRef = useRef<SpaceComposerEditorHandle>(null);
	const [text, setText] = useState("");
	return (
		<QueryClientProvider client={client}>
			<TooltipProvider>
				<AppSurfaceLayout
					globalControls={null}
					initialModuleSidebarState={{ tier: "expanded", width: "260px" }}
					moduleNavigation={<ConversationsSidebar />}
					moduleNavigationKey="conversations"
					moduleNavigationLabel="Spaces"
					outerRail={
						<aside className={APP_APPLICATION_RAIL_CLASS_NAME}>
							<div className="flex h-16 items-center justify-center">
								<OpenMeldLogoStrong pointerTracking="element" size={1.2} />
							</div>
							<div className="flex-1 px-1">
								{buildAppRailGroups({
									orgSlug: "test",
									centerAgentUnreadCount: 0,
									spacesUnreadCount: 0,
									prefetchCenterAgentConversation: () => undefined,
								}).map((group, index) => (
									<AppRailNavigationGroup
										activeDestination="directMessages"
										group={group}
										key={group.id}
										position={index}
										tier="icon"
									/>
								))}
							</div>
						</aside>
					}
				>
					<section className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
						<SpaceWindowHeader
							subtitleItems={[
								{ key: "members", node: "Maya Chen, Codex, Claude Code" },
							]}
							title="Release planning"
						/>
						<div className="min-h-0 flex-1 overflow-auto px-6 py-8">
							<div className="mx-auto flex max-w-3xl flex-col gap-6">
								{transcript.map((item, index) => (
									<Message className="px-3 py-2" key={item.name}>
										<MessageContent className="w-full min-w-0 gap-0">
											<MessageHeader className="items-center gap-2 px-0">
												<SpaceMessageProfileAvatar
													agentControllerRef={
														item.controller
															? `builtin:${item.controller}`
															: null
													}
													displayName={item.name}
													profileId={`capture-${index}`}
													profileKind={item.kind}
												/>
												<span className="text-foreground">{item.name}</span>
												<SpaceMessageTime
													createdAtMs={1_791_334_800_000 + index * 120_000}
													isDirectMessage={false}
													placement="header"
												/>
											</MessageHeader>
											<Bubble>
												<SpaceMessageSurface
													bubbleClassName={resolveSpaceMessageBubblePresentationClass(
														{ isSelf: index === 0 }
													)}
												>
													<MessageResponse variant="space-message">
														{item.text}
													</MessageResponse>
												</SpaceMessageSurface>
											</Bubble>
										</MessageContent>
									</Message>
								))}
							</div>
						</div>
						<div className="mx-auto w-full max-w-3xl px-6 pb-6">
							<SpaceComposer
								actions={{
									onEditorChange: (change) => setText(change.text),
									onSubmit: () => undefined,
								}}
								availability={{
									canSendMessage: true,
									fileLimitReached: false,
									isSendingMessage: false,
									sendBlocked: false,
								}}
								centerAgentProfileId={null}
								composerRef={composerRef}
								content={{
									addressingTargets: [],
									authoredMentions: [],
									files: [],
									mentionPickerItems: [],
									text,
								}}
								context={{
									conversationKind: "space",
									placement: "conversation",
								}}
							/>
						</div>
					</section>
				</AppSurfaceLayout>
			</TooltipProvider>
		</QueryClientProvider>
	);
}
const route = createRootRoute({ component: Preview });
const router = createRouter({
	routeTree: route.addChildren([
		createRoute({
			getParentRoute: () => route,
			path: "$",
			component: () => null,
		}),
	]),
});
const root = document.getElementById("root");
if (root) {
	createRoot(root).render(<RouterProvider router={router} />);
}
