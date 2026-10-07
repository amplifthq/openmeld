import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { TabsSubtle, TabsSubtleItem } from "@openmeld/ui/fluid/tabs-subtle";
import { UsersThreeIcon } from "@phosphor-icons/react";
import { lazy, Suspense, useState } from "react";
import { MessageResponse } from "../../src/components/ai/message-response";
import type { DirectoryHumanProfileRow } from "../../src/components/directory/directory-human-profile-model";
import { TeamHome } from "../../src/components/directory/team-home";
import type { FileSystemItem } from "../../src/components/extend/file-system";
import { SpaceDirectory as ProductSpaceDirectory } from "../../src/components/spaces/space-directory";
import { SpaceWindowHeader } from "../../src/components/spaces/space-header";
import { demoSkill, demoSpaces } from "./demo-data";

const FileSystem = lazy(() =>
	import("../../src/components/extend/file-system").then((m) => ({
		default: m.FileSystem,
	}))
);
const RoutinesPage = lazy(() =>
	import("../../src/components/routines/routines-page").then((m) => ({
		default: m.RoutinesPage,
	}))
);
const SkillDocument = lazy(() =>
	import(
		"../../src/components/organization-skills/organization-skill-document"
	).then((m) => ({ default: m.OrganizationSkillDocument }))
);
const documents: Record<string, string> = {
	"Launch brief.md":
		"# A calmer start to every project\n\n## Who it is for\nSmall product teams that work with coding agents.\n\n## What ships Friday\nA shared launch checklist, a shorter setup flow, and clear handoffs between teammates.\n\n## Decisions\nKeep the first release focused. Publish the setup guide before the announcement. Maya owns the final review.",
	"Customer interviews.md":
		"# What we heard\n\nSix teams described the same handoff problem: useful agent work stays in one person’s terminal.\n\n## Requests\n- Let another teammate continue the conversation.\n- Keep the source files next to the result.\n- Make it clear which agent did the work.\n\n## Next step\nTest the shared launch workflow with three teams.",
	"Weekly review.md":
		"# Weekly project review\n\n## Ready\nThe setup guide and release notes are ready for review.\n\n## Needs a decision\nChoose the first three teams for the pilot.\n\n## Next week\nCollect feedback from the pilot and update the launch brief.",
};
const files: FileSystemItem[] = [
	{ kind: "folder", path: "Team Knowledge", emblem: "knowledge" },
	{
		kind: "file",
		path: "Team Knowledge/Launch brief.md",
		contentType: "text/markdown",
		size: 2400,
	},
	{
		kind: "file",
		path: "Team Knowledge/Customer interviews.md",
		contentType: "text/markdown",
		size: 4600,
	},
	{
		kind: "file",
		path: "Weekly review.md",
		contentType: "text/markdown",
		size: 3200,
	},
];
export function DocumentDialog({
	name,
	onClose,
}: {
	name: string | null;
	onClose: () => void;
}) {
	return (
		<Dialog
			onOpenChange={(open) => {
				if (!open) {
					onClose();
				}
			}}
			open={name !== null}
		>
			<DialogContent className="max-h-[85vh] overflow-auto sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>{name}</DialogTitle>
					<DialogDescription>Atlas demo workspace</DialogDescription>
				</DialogHeader>
				<div className="px-2 py-4">
					<MessageResponse variant="space-message">
						{name ? (documents[name] ?? name) : ""}
					</MessageResponse>
				</div>
			</DialogContent>
		</Dialog>
	);
}
export function SpaceDirectory() {
	const [items, setItems] = useState(demoSpaces);
	return (
		<div className="flex min-h-0 flex-1 flex-col px-6 py-5">
			<div className="mb-5 border-border border-b pb-3 font-medium text-sm">
				Your Spaces
			</div>
			<ProductSpaceDirectory
				accountProfiles={[]}
				accountSpaceItemsById={
					new Map(items.map((item) => [item.spaceId, item]))
				}
				canJoinSpaces={false}
				joinError={null}
				onJoinSpace={() => undefined}
				onTogglePinned={(item) =>
					setItems((current) =>
						current.map((space) =>
							space.spaceId === item.spaceId
								? { ...space, pinnedAt: space.pinnedAt ? null : "2026-10-01" }
								: space
						)
					)
				}
				orgSlug="test"
				pendingJoinSpaceId={null}
				pinActionsPending={false}
				profileId="human"
				savedViewWarning={null}
				spaces={[]}
				tab={0}
			/>
		</div>
	);
}
export function DemoFiles() {
	const [file, setFile] = useState<string | null>(null);
	return (
		<Suspense fallback={null}>
			<FileSystem
				defaultView="icons"
				embedded
				items={files}
				onFileOpen={(item) =>
					setFile(item.name ?? item.path.split("/").at(-1) ?? null)
				}
				title="Team files"
			/>
			<DocumentDialog name={file} onClose={() => setFile(null)} />
		</Suspense>
	);
}
export function TeamScene({
	initial = "Files",
	people,
}: {
	initial?: string;
	people: DirectoryHumanProfileRow[];
}) {
	const [tab, setTab] = useState(initial);
	const [file, setFile] = useState<string | null>(null);
	const [bundle, setBundle] = useState(demoSkill.bundle);
	let content = <RoutinesPage />;
	if (tab === "People") {
		content = (
			<TeamHome
				activityNowMs={1_791_334_800_000}
				computerGroups={[]}
				members={people}
				onSelect={(id) =>
					setFile(people.find((p) => p.id === id)?.name ?? null)
				}
			/>
		);
	}
	if (tab === "Files") {
		content = <DemoFiles />;
	}
	if (tab === "Skills") {
		content = (
			<div className="mx-auto grid max-w-3xl gap-6 py-3">
				<SkillDocument
					bundle={bundle}
					contentGeneration={0}
					onChange={setBundle}
					saving={false}
					skill={demoSkill}
				/>
			</div>
		);
	}
	const tabs = ["People", "Agents", "Plugins", "Skills", "Files", "Routines"];
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<SpaceWindowHeader
				leadingControl={
					<UsersThreeIcon className="size-4 text-muted-foreground" />
				}
				navigation={
					<TabsSubtle
						aria-label="Team view"
						className="h-full shrink-0 gap-5"
						onSelect={(index) => setTab(tabs[index])}
						selectedIndex={tabs.indexOf(tab)}
						variant="underline"
					>
						{tabs.map((name, index) => (
							<TabsSubtleItem
								disabled={index === 1 || index === 2}
								index={index}
								key={name}
								label={name}
								labelClassName="text-sm"
							/>
						))}
					</TabsSubtle>
				}
				title="Team"
			/>
			<div className="min-h-0 flex-1 overflow-auto p-6">
				<Suspense
					fallback={
						<p className="text-muted-foreground text-sm">
							Opening {tab.toLowerCase()}…
						</p>
					}
				>
					{content}
				</Suspense>
			</div>
			<DocumentDialog name={file} onClose={() => setFile(null)} />
		</div>
	);
}
