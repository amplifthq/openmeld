import { buildOrganizationSpacePath } from "@openmeld/schemas";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { LocalAgentLogo } from "@openmeld/ui/components/local-agent-logo";
import {
	Popover,
	PopoverContent,
	PopoverTitle,
	PopoverTrigger,
} from "@openmeld/ui/components/popover";
import {
	ArrowRightIcon,
	CheckIcon,
	FileTextIcon,
	GitDiffIcon,
	StarIcon,
	UsersThreeIcon,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import "./key-projects.css";

// Illustrative project updates with explicitly selected real Space destinations.
// No requests, polling, publication, or model calls until the viewer navigates.
// These IDs stand in for canonical Projects; this is not a new Project model.
const projects = [
	{
		id: "demo-openmeld",
		name: "OpenMeld",
		space: {
			orgSlug: "amplift",
			spaceId:
				"8824251cb668f85552a023ce35477ce55907bb1e374762a35251a930184856dd",
		},
		goal: "Make human–Agent teamwork visible.",
		stage: "Design review",
		kind: "milestone",
		title: "A shared view of the work that matters.",
		summary:
			"The Team homepage centers on selected projects, with a short catch-up from each contributing Agent.",
		nextLabel: "Decision needed",
		next: "Choose the homepage direction.",
		nextOwner: "Monica",
		artifact: "Homepage changes",
		artifactKind: "diff",
		source: "Shared design review",
		time: "Today, 10:24",
		detailTitle: "What changed",
		detail: [
			"Before: an undifferentiated grid of Agent activity.",
			"After: selected projects, one key outcome, and the next milestone.",
			"Small fixes and routine maintenance stay out of the overview.",
		],
		agents: [
			{
				name: "Monica’s Codex",
				owner: "Monica",
				controller: "builtin:codex",
				work: "Preparing the key-project homepage for design review.",
			},
			{
				name: "Design partner",
				owner: "MingYoo",
				controller: "builtin:claude-code",
				work: "Checking the project hierarchy and short hover summaries.",
			},
		],
	},
	{
		id: "demo-tonebird",
		name: "ToneBird",
		space: {
			orgSlug: "amplift",
			spaceId:
				"1f4ba0fb33cebc99c1912cdefad304fadc5fc7d89ea281acab775f59063d8fd2",
		},
		goal: "Bring the creator launch to market.",
		stage: "Launch preparation",
		kind: "delivery",
		title: "The launch story is ready for review.",
		summary:
			"The product walkthrough and creator brief tell one consistent story. Both are ready for the team’s final pass.",
		nextLabel: "Next milestone",
		next: "Approve the launch package.",
		nextOwner: "Carol",
		artifact: "Launch brief",
		artifactKind: "document",
		source: "Shared launch brief",
		time: "Today, 09:40",
		detailTitle: "Launch package",
		detail: [
			"A short product walkthrough built around a real creator workflow.",
			"One brief covering the audience, product promise, and call to action.",
			"Next: review the package together before scheduling the launch.",
		],
		agents: [
			{
				name: "Launch partner",
				owner: "Carol",
				controller: "builtin:claude-code",
				work: "Bringing the walkthrough and launch brief into one review package.",
			},
			{
				name: "Production assistant",
				owner: "Justin",
				controller: "builtin:codex",
				work: "Checking the demo against the launch brief.",
			},
		],
	},
	{
		id: "demo-routine",
		name: "Routine maintenance",
		goal: "Keep the app tidy.",
		stage: "Complete",
		kind: "small-fix",
		title: "Corrected a button label.",
		summary: "Minor text correction.",
		nextLabel: "Next",
		next: "None",
		nextOwner: "Team",
		artifact: "Change",
		artifactKind: "diff",
		source: "Maintenance",
		time: "Today",
		detailTitle: "Small fix",
		detail: [],
		agents: [],
	},
] as const;
type Project = (typeof projects)[number];
const eligible = projects.filter((project) => project.kind !== "small-fix");
const preferenceKey = "openmeld-key-projects-design-preview-following-v1";
const headlines: Record<string, string> = {
	"demo-openmeld":
		"Key projects replace the Agent activity grid on the homepage.",
	"demo-tonebird": "The product walkthrough and creator brief are ready.",
};
function readFollowing(): string[] {
	try {
		const saved = JSON.parse(localStorage.getItem(preferenceKey) ?? "null");
		if (Array.isArray(saved)) {
			return eligible.filter((p) => saved.includes(p.id)).map((p) => p.id);
		}
	} catch {
		/* A blocked browser store leaves the preview usable in memory. */
	}
	return eligible.map((p) => p.id);
}

function AgentCatchup({ agent }: { agent: Project["agents"][number] }) {
	return (
		<Popover>
			<PopoverTrigger
				aria-label={`${agent.name} · ${agent.owner}`}
				className="focus-agent"
				delay={150}
				openOnHover
			>
				<LocalAgentLogo
					agentId={agent.controller}
					className="h-[30px] w-[30px]"
					variant="tile"
				/>
			</PopoverTrigger>
			<PopoverContent className="w-72 rounded-xl p-4" side="top">
				<PopoverTitle>{agent.name}</PopoverTitle>
				<span className="text-muted-foreground text-xs">
					{agent.owner} · Shared project update
				</span>
				<p className="text-sm leading-6">{agent.work}</p>
			</PopoverContent>
		</Popover>
	);
}

export function KeyProjectsPreview() {
	const [selected, setSelected] = useState<string[]>(readFollowing);
	const [removed, setRemoved] = useState<Project | null>(null);
	const [choosing, setChoosing] = useState(false);
	const [detail, setDetail] = useState<Project | null>(null);
	const visible = eligible.filter((p) => selected.includes(p.id));
	useEffect(() => {
		try {
			localStorage.setItem(preferenceKey, JSON.stringify(selected));
		} catch {
			/* Preview remains usable without persistence. */
		}
	}, [selected]);
	return (
		<div className="focus-shell">
			<aside aria-label="App navigation" className="focus-rail">
				<b className="focus-logo">▣</b>
				<span>Inbox</span>
				<span>Spaces</span>
				<span className="focus-current">
					<UsersThreeIcon size={22} />
					Team
				</span>
				<span>Routines</span>
				<span className="focus-account">M</span>
			</aside>
			<main className="focus-main">
				<header className="focus-header">
					<strong>
						<UsersThreeIcon size={18} />
						Team
					</strong>
					<div className="focus-tabs">
						<span aria-current="page">Key projects</span>
						<span>People</span>
						<span>Agents</span>
						<span>Files</span>
						<span>Skills</span>
						<span>Plugins</span>
					</div>
				</header>
				<section aria-labelledby="focus-title" className="focus-content">
					<div className="focus-heading">
						<div>
							<div className="focus-eyebrow">TEAM PRIORITIES</div>
							<h1 id="focus-title">
								Key projects
								<span className="focus-count">{visible.length}</span>
							</h1>
							<p>The projects you follow. Only the updates that matter.</p>
						</div>
						<Button onClick={() => setChoosing(true)} variant="outline">
							<StarIcon />
							Manage following
						</Button>
					</div>
					{removed ? (
						<output className="focus-notice">
							<span>{removed.name} removed from your homepage.</span>
							<Button
								onClick={() => {
									setSelected((current) =>
										current.includes(removed.id)
											? current
											: [...current, removed.id]
									);
									setRemoved(null);
								}}
								size="sm"
								variant="ghost"
							>
								Undo
							</Button>
						</output>
					) : null}
					{visible.length === 0 ? (
						<div className="focus-empty">
							<StarIcon size={28} />
							<h2>Choose what matters now.</h2>
							<p>Select the projects you want to follow here.</p>
							<Button onClick={() => setChoosing(true)}>Choose projects</Button>
						</div>
					) : (
						<div className="focus-projects">
							{visible.map((project, index) => (
								<article className="focus-project" key={project.id}>
									<div className="focus-identity">
										<span className="focus-index">0{index + 1}</span>
										<h2>{project.name}</h2>
										<p>{project.goal}</p>
										<div className="focus-contributors">
											<div className="focus-avatars">
												{project.agents.map((agent) => (
													<AgentCatchup agent={agent} key={agent.name} />
												))}
											</div>
											<span>{project.agents.length} Agents</span>
										</div>
									</div>
									<div className="focus-outcome">
										<div className="focus-time">{project.time}</div>
										<h3>{headlines[project.id]}</h3>
										{project.nextLabel === "Decision needed" ? (
											<p className="focus-action-needed">
												<span className="focus-dot" />
												{project.next}
											</p>
										) : null}
										<Button
											aria-haspopup="dialog"
											className="mt-4"
											onClick={() => setDetail(project)}
											size="sm"
											variant="outline"
										>
											{project.artifactKind === "diff" && <GitDiffIcon />}
											{project.artifactKind === "document" && <FileTextIcon />}
											{project.artifact}
										</Button>
									</div>
									<div className="focus-project-actions">
										<a
											aria-label={`Open ${project.name} Space`}
											className="focus-open-space"
											href={
												new URL(
													buildOrganizationSpacePath(project.space),
													"https://app.openmeld.ai"
												).href
											}
										>
											Open Space
											<ArrowRightIcon />
										</a>
										<button
											aria-label={`Unfollow ${project.name}`}
											className="focus-unfollow"
											onClick={() => {
												setSelected((current) =>
													current.filter((id) => id !== project.id)
												);
												setRemoved(project);
											}}
											title="Remove from your homepage"
											type="button"
										>
											Unfollow
										</button>
									</div>
								</article>
							))}
						</div>
					)}
					<footer className="focus-footer">
						<span>
							<StarIcon weight="fill" />
							Selected projects only · milestones, decisions, and key learnings
						</span>
						<span>Hover an Agent for a quick catch-up</span>
					</footer>
				</section>
				<div className="focus-demo">
					DESIGN PREVIEW · Illustrative content. Following preferences are saved
					in this browser only.
				</div>
			</main>
			<Dialog onOpenChange={setChoosing} open={choosing}>
				<DialogContent className="rounded-xl p-6 sm:max-w-md">
					<DialogTitle className="text-lg">Projects you follow</DialogTitle>
					<DialogDescription>
						Unfollow to remove a project from your homepage. The project stays
						available to the team. Follow it again here at any time.
					</DialogDescription>
					<div className="focus-choices">
						{eligible.map((project) => (
							<label key={project.id}>
								<input
									checked={selected.includes(project.id)}
									onChange={(event) =>
										setSelected((current) =>
											event.target.checked
												? [...current, project.id]
												: current.filter((id) => id !== project.id)
										)
									}
									type="checkbox"
								/>
								<span>
									<strong>{project.name}</strong>
									<small>{project.goal}</small>
								</span>
							</label>
						))}
					</div>
					<Button onClick={() => setChoosing(false)}>
						<CheckIcon />
						Done
					</Button>
				</DialogContent>
			</Dialog>
			<Dialog
				onOpenChange={(open) => {
					if (!open) {
						setDetail(null);
					}
				}}
				open={detail !== null}
			>
				<DialogContent className="rounded-xl p-6 sm:max-w-xl">
					<DialogTitle className="text-xl">
						{detail?.name} · {detail?.detailTitle}
					</DialogTitle>
					<DialogDescription>
						{detail?.source} · Illustrative content
					</DialogDescription>
					<ul className="focus-detail">
						{detail?.detail.map((line) => (
							<li key={line}>{line}</li>
						))}
					</ul>
					<p className="text-muted-foreground text-xs">
						In the product, this opens an explicitly shared source that you have
						permission to view.
					</p>
				</DialogContent>
			</Dialog>
		</div>
	);
}
