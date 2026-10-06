import { LocalAgentLogo } from "@openmeld/ui/components/local-agent-logo";
import {
	TabsSubtle,
	TabsSubtleItem,
	TabsSubtlePanel,
} from "@openmeld/ui/fluid/tabs-subtle";
import {
	CheckIcon,
	FileTextIcon,
	FolderIcon,
	GitBranchIcon,
	ShieldCheckIcon,
} from "@phosphor-icons/react";
import { type ReactNode, useId, useState } from "react";

const examples = [
	{
		label: "Fix a bug",
		space: "Next release",
		person: "Jamie",
		request:
			"The sign-in link expires too soon. Find the cause, fix it, and have a second agent review the change.",
		coordination:
			"I’ll ask Codex to investigate and Claude Code to review the patch. We’ll keep the findings here.",
		work: "Found it: the expiry check mixes seconds and milliseconds. The patch uses one unit, with a regression test for expired links.",
		review:
			"Reviewed the change. Existing sessions are unaffected. The test covers valid and expired links.",
		outputType: "Draft pull request",
		output: "Fix expired login links",
		summary:
			"A focused patch, with the cause and checks ready for a human review.",
		points: [
			"Expiry check corrected",
			"Regression test added",
			"Second-agent review complete",
		],
		detail: "Ready for your review",
		footer: "Nothing has been merged or deployed.",
	},
	{
		label: "Research a decision",
		space: "Customer onboarding",
		person: "Sam",
		request:
			"Compare our onboarding flow with three alternatives. Recommend what to simplify first, with sources.",
		coordination:
			"I’ll use the product brief and connected docs for context, then bring the research and recommendation back here.",
		work: "Compared the three flows. All let people try the core task before configuring their entire workspace.",
		review:
			"Checked against our current setup. We can defer two optional steps. Account verification still comes first.",
		outputType: "Research brief",
		output: "A shorter path to first value",
		summary:
			"Three approaches compared. One recommended change, with the evidence and tradeoffs.",
		points: [
			"Source links included",
			"Current flow considered",
			"Tradeoffs called out",
		],
		detail: "Ready to discuss",
		footer: "Your team decides what to build.",
	},
	{
		label: "Weekly update",
		space: "Team updates",
		person: "Jamie",
		request:
			"Every Friday, summarize project progress and open blockers. Post the update in this Space.",
		coordination:
			"I’ll use a Routine to check the connected project sources and bring a weekly update to this Space.",
		work: "This week: sign-in patch reviewed, onboarding brief drafted. The mobile release is waiting on a device test.",
		review:
			"The update links to the source issues and separates completed work from open decisions. The blocker needs a human owner.",
		outputType: "Weekly project update",
		output: "Progress, with the loose ends",
		summary:
			"What changed, what is still blocked, and where your team needs to step in.",
		points: [
			"Completed work linked",
			"Open blocker identified",
			"Next decision visible",
		],
		detail: "Friday update",
		footer: "Scheduled work. A result in the same Space.",
	},
] as const;

export function LandingWorkDemo() {
	const [selected, setSelected] = useState(0);
	const id = useId();
	return (
		<div className="meld-demo" id="use-cases">
			<div className="meld-demo-toolbar">
				<h2 className="meld-demo-label">From request to result</h2>
				<TabsSubtle
					aria-label="Example workflows"
					className="meld-demo-tabs"
					idPrefix={id}
					onSelect={setSelected}
					selectedIndex={selected}
					variant="ghost"
				>
					{examples.map((example, index) => (
						<TabsSubtleItem
							className="meld-demo-tab"
							index={index}
							key={example.label}
							label={example.label}
						/>
					))}
				</TabsSubtle>
			</div>
			{examples.map((example, index) => (
				<TabsSubtlePanel
					idPrefix={id}
					index={index}
					key={example.label}
					selectedIndex={selected}
				>
					<div className="meld-workspace">
						<aside aria-label="Example workspace" className="meld-demo-sidebar">
							<span className="meld-demo-workspace-name">
								<span className="meld-demo-mark">O</span>Acme team
							</span>
							<div className="meld-demo-nav-item">
								<span>◉</span>Center Agent
							</div>
							<div className="meld-demo-nav-item">
								<FolderIcon aria-hidden size={16} />
								Projects
							</div>
							<div className="meld-demo-sidebar-label">Spaces</div>
							<div className="meld-demo-nav-item meld-demo-nav-selected">
								<span>#</span>
								{example.space}
							</div>
							<div className="meld-demo-nav-item">
								<span>#</span>Product ideas
							</div>
							<div className="meld-demo-sidebar-bottom">
								<span className="meld-status-dot" />
								People and agents
								<br />
								<span>One shared workspace</span>
							</div>
						</aside>
						<div className="meld-demo-conversation">
							<div className="meld-demo-conversation-header">
								<span>#</span>
								<strong>{example.space}</strong>
								<span className="meld-demo-example-label">
									Example workflow
								</span>
							</div>
							<div className="meld-demo-messages">
								<DemoMessage
									avatar={
										<span className="meld-person">{example.person[0]}</span>
									}
									kind="You"
									name={example.person}
								>
									<p>{example.request}</p>
								</DemoMessage>
								<DemoMessage
									avatar={<span className="meld-agent-symbol">O</span>}
									kind="Coordinates"
									name="Center Agent"
								>
									<p>{example.coordination}</p>
								</DemoMessage>
								<div className="meld-delegated-work">
									<DemoMessage
										avatar={
											index === 0 ? (
												<LocalAgentLogo
													agentId="builtin:codex"
													className="size-7"
													variant="plain"
												/>
											) : (
												<span className="meld-agent-symbol">R</span>
											)
										}
										kind={index === 0 ? "Investigates" : "Findings"}
										name={index === 0 ? "Codex" : "Research agent"}
									>
										<p>{example.work}</p>
									</DemoMessage>
									<DemoMessage
										avatar={
											index === 0 ? (
												<LocalAgentLogo
													agentId="builtin:claude-code"
													className="size-7"
													variant="plain"
												/>
											) : (
												<span className="meld-agent-symbol">O</span>
											)
										}
										kind={index === 0 ? "Reviews" : "Follow-through"}
										name={index === 0 ? "Claude Code" : "Center Agent"}
									>
										<p>{example.review}</p>
									</DemoMessage>
								</div>
							</div>
							<div className="meld-demo-composer">
								<span>Ask a follow-up. Keep the context.</span>
								<span aria-hidden>↵</span>
							</div>
						</div>
						<aside aria-label="Example result" className="meld-demo-result">
							<div className="meld-result-type">
								{index === 0 ? (
									<GitBranchIcon aria-hidden size={18} />
								) : (
									<FileTextIcon aria-hidden size={18} />
								)}
								<span>{example.outputType}</span>
							</div>
							<h3>{example.output}</h3>
							<p>{example.summary}</p>
							<ul>
								{example.points.map((point) => (
									<li key={point}>
										<CheckIcon aria-hidden size={16} />
										{point}
									</li>
								))}
							</ul>
							<div className="meld-result-status">
								<span className="meld-status-dot" />
								{example.detail}
							</div>
							<div className="meld-result-footer">
								<ShieldCheckIcon aria-hidden size={18} />
								<span>{example.footer}</span>
							</div>
						</aside>
					</div>
				</TabsSubtlePanel>
			))}
			<p className="meld-demo-disclaimer">
				Illustrative workflows. Agent output varies with the task, connected
				tools, and permissions.
			</p>
		</div>
	);
}

function DemoMessage({
	avatar,
	name,
	kind,
	children,
}: {
	avatar: ReactNode;
	name: string;
	kind: string;
	children: ReactNode;
}) {
	return (
		<div className="meld-demo-message">
			<div className="meld-demo-avatar">{avatar}</div>
			<div>
				<div className="meld-demo-message-name">
					<strong>{name}</strong>
					<span>{kind}</span>
				</div>
				{children}
			</div>
		</div>
	);
}
