import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { TabItem, Tabs, TabsList } from "@openmeld/ui/fluid/tabs";
import { useRouterState } from "@tanstack/react-router";
import { lazy, Suspense, useState } from "react";
import { MessageResponse } from "../../src/components/ai/message-response";
import type { DirectoryHumanProfileRow } from "../../src/components/directory/directory-human-profile-model";
import { TeamHeader } from "../../src/components/directory/team-header";
import type { FileSystemItem } from "../../src/components/extend/file-system";
import { useTeamFilesView } from "../../src/components/organizations/team-files-navigation";
import { SpaceDirectory as ProductSpaceDirectory } from "../../src/components/spaces/space-directory";
import { SpaceWindowHeader } from "../../src/components/spaces/space-header";
import { demoSkill, demoSpaces } from "./demo-data";
import { DemoPeople } from "./demo-people";

const DemoAgents = lazy(() =>
	import("./demo-team").then((m) => ({ default: m.DemoAgents }))
);

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
const SkillsList = lazy(() =>
	import(
		"../../src/components/organization-skills/organization-skills-list-page"
	).then((m) => ({ default: m.OrganizationSkillsListPage }))
);
const SkillDetail = lazy(() =>
	import(
		"../../src/components/organization-skills/organization-skill-detail-page"
	).then((m) => ({ default: m.OrganizationSkillDetailPage }))
);
const SkillDocument = lazy(() =>
	import(
		"../../src/components/organization-skills/organization-skill-document"
	).then((m) => ({ default: m.OrganizationSkillDocument }))
);
const Plugins = lazy(() =>
	import("../../src/components/organizations/organization-plugins-page").then(
		(m) => ({ default: m.OrganizationPluginsPage })
	)
);
const documents: Record<string, string> = {
	"Launch brief.md":
		"# A calmer start to every project\n\n## Who it is for\nSmall product teams that work with coding agents.\n\n## What ships Friday\nA shared launch checklist, a shorter setup flow, and clear handoffs between teammates.\n\n## Decisions\nKeep the first release focused. Publish the setup guide before the announcement. Maya owns the final review.",
	"Customer interviews.md":
		"# What we heard\n\nSix teams described the same handoff problem: useful agent work stays in one person’s terminal.\n\n## Requests\n- Let another teammate continue the conversation.\n- Keep the source files next to the result.\n- Make it clear which agent did the work.\n\n## Next step\nTest the shared launch workflow with three teams.",
	"Weekly review.md":
		"# Weekly project review\n\n## Ready\nThe setup guide and release notes are ready for review.\n\n## Needs a decision\nChoose the first three teams for the pilot.\n\n## Next week\nCollect feedback from the pilot and update the launch brief.",
	"Product brief.md":
		"# Shared work, from the start\n\nHelp a small product team work with its existing coding agents. Keep the brief, discussion, and finished work in one Space.\n\n## First release\nA shorter setup flow, clear agent ownership, and a shared launch checklist.",
	"Customer research.md":
		"# Customer research\n\nSix teams want to continue each other’s agent work without copying context between tools.\n\n## Next interviews\nAsk how teams review the result and choose the next step.",
	"Brand guidelines.md":
		"# Brand guidelines\n\nUse clear English. Show the product at work. Keep one main action in each view.\n\n## Release notes\nDescribe what changed for the customer and include one concrete example.",
	"Launch checklist.md":
		"# Launch checklist\n\n- Check the setup guide against the shipped commands.\n- Review the release notes.\n- Choose the three pilot teams.\n- Publish after Maya’s final review.",
	"Pricing research.md":
		"# Pricing research\n\nThe pilot teams already pay for their local agents. Keep those subscriptions and explain cloud usage separately.\n\n## Open question\nReview the first week of pilot usage before deciding on a plan.",
};
const files = (
	[
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
		...[
			["Product brief.md", 5400],
			["Customer research.md", 8600],
			["Brand guidelines.md", 4100],
			["Launch checklist.md", 2700],
			["Pricing research.md", 6200],
		].map(([path, size]) => ({
			kind: "file" as const,
			path: String(path),
			contentType: "text/markdown",
			size: Number(size),
		})),
	] satisfies FileSystemItem[]
).map((item, index) => ({
	...item,
	updatedAt: new Date(Date.UTC(2026, 9, 7 - (index % 4), 16)).toISOString(),
}));
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
					<DialogDescription className="sr-only">
						OpenMeld workspace document
					</DialogDescription>
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
export function DemoFiles({
	team = false,
	showcase = false,
}: {
	team?: boolean;
	showcase?: boolean;
}) {
	const [file, setFile] = useState<string | null>(null);
	const [scope] = useTeamFilesView();
	let title = "Team files";
	if (team && scope === "my") {
		title = "My files";
	}
	if (team && (scope === "trash" || scope === "trash-my")) {
		title = "Trash";
	}
	return (
		<Suspense fallback={null}>
			<FileSystem
				className={showcase ? "h-[390px]" : "h-full min-h-0 flex-1"}
				defaultExpandedPaths={showcase ? ["Team Knowledge/"] : undefined}
				defaultView={showcase ? "list" : "icons"}
				embedded
				items={!team || scope === "team" || scope === "knowledge" ? files : []}
				onFileOpen={(item) =>
					setFile(item.name ?? item.path.split("/").at(-1) ?? null)
				}
				reserveBreadcrumbSpace={team && !showcase}
				title={title}
			/>
			<DocumentDialog name={file} onClose={() => setFile(null)} />
		</Suspense>
	);
}
export function TeamScene({
	people,
	selectedPerson,
	onSelectPerson,
}: {
	people: DirectoryHumanProfileRow[];
	selectedPerson: string | null;
	onSelectPerson: (id: string | null) => void;
}) {
	const path = useRouterState({ select: (s) => s.location.pathname });
	const tab = path.split("/")[3] as
		| "people"
		| "agents"
		| "plugins"
		| "skills"
		| "files"
		| "routines";
	const detail = path.split("/")[4];
	let content = <RoutinesPage />;
	if (tab === "people") {
		content = (
			<DemoPeople
				onSelectPerson={onSelectPerson}
				people={people}
				selectedPerson={selectedPerson}
			/>
		);
	}
	if (tab === "files") {
		content = <DemoFiles team />;
	}
	if (tab === "agents") {
		content = <DemoAgents />;
	}
	if (tab === "plugins") {
		content = (
			<div className="space-y-6">
				<Plugins selectedService={detail ?? null} />
			</div>
		);
	}
	if (tab === "skills") {
		content = detail ? <SkillDetail skillId={detail} /> : <SkillsList />;
	}
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<header className="h-[var(--space-conversation-header-height)] w-full shrink-0 border-border border-b bg-background">
				{tab === "routines" ? (
					<SpaceWindowHeader renderFrame={false} title="Routines" />
				) : (
					<TeamHeader active={tab} />
				)}
			</header>
			<div
				className={`min-h-0 flex-1 overflow-auto p-6 ${tab === "files" ? "flex flex-col" : ""}`}
			>
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
		</div>
	);
}

export function FocusedTeamScene({ scene }: { scene: string }) {
	const path = useRouterState({ select: (state) => state.location.pathname });
	const [tab, setTab] = useState("files");
	const detail = path.split("/")[4];
	if (scene === "ShowcaseFiles") {
		return (
			<div className="flex min-h-0 flex-1 flex-col p-6">
				<DemoFiles showcase team />
			</div>
		);
	}
	if (scene === "ShowcaseSkill") {
		return (
			<div className="grid gap-5 p-8">
				<Suspense fallback={null}>
					<SkillDocument
						bundle={demoSkill.bundle}
						contentGeneration={0}
						onChange={() => undefined}
						saving={false}
						skill={demoSkill}
					/>
				</Suspense>
			</div>
		);
	}
	if (scene === "Schedule" || scene === "ShowcaseRoutines") {
		return (
			<div className="p-6">
				<Suspense fallback={null}>
					<RoutinesPage />
				</Suspense>
			</div>
		);
	}
	return (
		<div className="flex min-h-0 flex-1 flex-col p-6">
			<Tabs onValueChange={setTab} value={tab}>
				<TabsList aria-label="Shared knowledge" className="mb-5 w-fit">
					<TabItem label="Files" value="files" />
					<TabItem label="Skills" value="skills" />
				</TabsList>
			</Tabs>
			<Suspense fallback={null}>
				{tab === "files" ? (
					<DemoFiles team />
				) : (
					<div className="min-h-0 flex-1 overflow-auto">
						{detail ? <SkillDetail skillId={detail} /> : <SkillsList />}
					</div>
				)}
			</Suspense>
		</div>
	);
}
