import {
	createSpaceMemberAgentSnapshot,
	createSpaceMemberHumanSnapshot,
	createSpaceMembersSnapshot,
} from "@openmeld/schemas/testing";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Plate, usePlateEditor } from "platejs/react";
import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { MarkdownEditor } from "../../src/components/editor/markdown-editor";
import { Editor } from "../../src/components/editor/ui/editor";
import {
	SpaceComposerEditor,
	type SpaceComposerEditorHandle,
} from "../../src/components/spaces/space-composer-editor";
import {
	buildSpaceComposerAddressingTargets,
	buildSpaceMentionTargetItems,
} from "../../src/components/spaces/use-space-mention-authoring";
import { useComposerDraft } from "../../src/hooks/use-composer-draft";
import { createComposerDraftRecord } from "../../src/lib/composer-draft-storage";

const client = new QueryClient({
	defaultOptions: { queries: { retry: false } },
});
const initialDraft = createComposerDraftRecord(
	{
		text: "alpha bravo charlie delta",
		authoredMentions: [],
		replyToSignalId: null,
	},
	1
);
const scope = {
	kind: "space",
	ownerAccountId: "browser-fixture",
	profileId: "browser-fixture",
	spaceId: "browser-fixture",
} as const;
const AGENT_PROFILE_ID = "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const snapshot = createSpaceMembersSnapshot({
	agents: [
		createSpaceMemberAgentSnapshot({
			profileId: AGENT_PROFILE_ID,
			profileName: "Runner",
		}),
	],
	humans: [
		createSpaceMemberHumanSnapshot({
			profileId: "22222222-2222-4222-8222-222222222222",
			profileName: "Felix",
		}),
	],
});
const mentionPickerItems = buildSpaceMentionTargetItems({
	query: "",
	snapshot,
});

function Fixture() {
	const { content, setContent } = useComposerDraft({ scope, initialDraft });
	const composerRef = useRef<SpaceComposerEditorHandle | null>(null);
	const [markdown, setMarkdown] = useState("alpha bravo charlie delta");
	const [revision, setRevision] = useState(0);
	const [sent, setSent] = useState(0);
	const documentMode = new URLSearchParams(location.search).has("document");
	const decoratedMode = new URLSearchParams(location.search).has("decorated");
	// The Center Agent's Wake ghost shows while the draft is empty, as in a Space.
	const wakeGhost =
		new URLSearchParams(location.search).has("wake") &&
		!content.text &&
		content.authoredMentions.length === 0;
	const decoratedEditor = usePlateEditor({
		value: [{ type: "p", children: [{ text: "alpha bravo charlie delta" }] }],
	});
	// A parent snapshot can render between native selection movement and Slate's
	// deferred selectionchange handler. The test controls that scheduling boundary.
	window.refreshEditor = () =>
		flushSync(() => setRevision((value) => value + 1));
	window.replaceDraft = (text) =>
		flushSync(() =>
			setContent({ text, authoredMentions: [], replyToSignalId: null })
		);
	window.restoreAgentDraft = (text) =>
		flushSync(() =>
			setContent({
				text: `@Runner ${text}`,
				authoredMentions: [
					{
						start: 0,
						end: 7,
						text: "@Runner",
						profileId: AGENT_PROFILE_ID,
						relation: "wake",
					},
				],
				replyToSignalId: null,
			})
		);
	window.selectEditor = (start, end) =>
		composerRef.current?.selectTextRange({ start, end });
	return (
		<QueryClientProvider client={client}>
			<main style={{ padding: 40, fontSize: 20 }}>
				<output data-testid="revision">{revision}</output>
				{decoratedMode ? (
					<Plate
						editor={decoratedEditor}
						onValueChange={({ editor }) => setMarkdown(editor.api.string([]))}
					>
						<Editor
							aria-label="Message"
							decorate={({ entry: [node, path] }) =>
								revision % 2 && "text" in node
									? [
											{
												anchor: { path, offset: 0 },
												focus: { path, offset: 5 },
												bold: true,
											},
										]
									: []
							}
							role="textbox"
							variant="none"
						/>
					</Plate>
				) : null}
				{documentMode && (
					<MarkdownEditor
						ariaLabel="Message"
						maxChars={10_000}
						onChange={setMarkdown}
						value={markdown}
					/>
				)}
				{!(documentMode || decoratedMode) && (
					<SpaceComposerEditor
						addressingTargets={buildSpaceComposerAddressingTargets({
							mentions: content.authoredMentions,
							snapshot,
						})}
						ariaLabel="Message"
						authoredMentions={content.authoredMentions}
						centerAgentProfileId={AGENT_PROFILE_ID}
						composerRef={composerRef}
						mentionPickerItems={mentionPickerItems}
						onChange={(change) => setContent({ ...content, ...change })}
						onSend={() => setSent((value) => value + 1)}
						placeholder="Message"
						text={content.text}
						wakeRecommendation={
							wakeGhost
								? {
										profileId: AGENT_PROFILE_ID,
										onAccept: () => undefined,
										onDismiss: () => undefined,
									}
								: undefined
						}
					/>
				)}
				<output data-testid="draft">
					{documentMode || decoratedMode ? markdown : content.text}
				</output>
				<output data-testid="mentions">
					{JSON.stringify(content.authoredMentions)}
				</output>
				<output data-testid="sent">{sent}</output>
				<input aria-label="Other control" />
			</main>
		</QueryClientProvider>
	);
}

declare global {
	// biome-ignore lint/style/useConsistentTypeDefinitions: Augment the browser Window interface.
	interface Window {
		refreshEditor: () => void;
		replaceDraft: (text: string) => void;
		restoreAgentDraft: (text: string) => void;
		selectEditor: (start: number, end: number) => void;
	}
}

const root = document.getElementById("root");
if (!root) {
	throw new Error("Missing fixture root");
}
createRoot(root).render(<Fixture />);
