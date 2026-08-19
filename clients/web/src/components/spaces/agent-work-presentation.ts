import type { AgentWorkActivity } from "@openmeld/schemas/types";

type AgentWorkCopy = {
	active: string;
	complete: string;
	failed: string;
};

export type AgentWorkPresentation = {
	status: "active" | "complete" | "failed";
	text: string;
};

const TRAILING_ELLIPSIS_PATTERN = /…$/u;

const workCopy = (
	active: string,
	complete: string,
	failed: string
): AgentWorkCopy => ({
	active,
	complete,
	failed,
});

const AGENT_WORK_COPY = {
	"agent.activity.read": workCopy(
		"Reviewing Agent Activity…",
		"Reviewed Agent Activity",
		"Couldn't review Agent Activity"
	),
	"agent_profile.configure": workCopy(
		"Configuring an Agent Profile…",
		"Configured an Agent Profile",
		"Couldn't configure the Agent Profile"
	),
	"agent_profile.connect": workCopy(
		"Connecting an Agent Profile…",
		"Connected an Agent Profile",
		"Couldn't connect the Agent Profile"
	),
	"agent_profile.connections.read": workCopy(
		"Checking local agent connections…",
		"Checked local agent connections",
		"Couldn't check local agent connections"
	),
	"agent_profile.create": workCopy(
		"Creating an Agent Profile…",
		"Created an Agent Profile",
		"Couldn't create the Agent Profile"
	),
	"agent_profile.enable": workCopy(
		"Enabling an Agent Profile…",
		"Enabled an Agent Profile",
		"Couldn't enable the Agent Profile"
	),
	"agent_profile.readiness.check": workCopy(
		"Checking Agent Profile readiness…",
		"Checked Agent Profile readiness",
		"Couldn't check Agent Profile readiness"
	),
	"agent_profile.settings.update": workCopy(
		"Updating Agent Profile settings…",
		"Updated Agent Profile settings",
		"Couldn't update Agent Profile settings"
	),
	"build.run": workCopy(
		"Building the project…",
		"Built the project",
		"Couldn't build the project"
	),
	"center_agent.activity.read": workCopy(
		"Reviewing Center Agent activity…",
		"Reviewed Center Agent activity",
		"Couldn't review Center Agent activity"
	),
	"center_agent.attention.request": workCopy(
		"Requesting your attention…",
		"Requested your attention",
		"Couldn't request your attention"
	),
	"center_agent.task.create": workCopy(
		"Creating a Task…",
		"Created a Task",
		"Couldn't create the Task"
	),
	"connected_app.action.execute": workCopy(
		"Running a connected app action…",
		"Ran the connected app action",
		"Couldn't run the connected app action"
	),
	"connected_app.actions.read": workCopy(
		"Checking available connected app actions…",
		"Checked available connected app actions",
		"Couldn't check connected app actions"
	),
	"connected_apps.read": workCopy(
		"Checking connected apps…",
		"Checked connected apps",
		"Couldn't check connected apps"
	),
	"dependencies.install": workCopy(
		"Installing project dependencies…",
		"Installed project dependencies",
		"Couldn't install project dependencies"
	),
	"dispatch.history.read": workCopy(
		"Reviewing dispatch history…",
		"Reviewed dispatch history",
		"Couldn't review dispatch history"
	),
	"documentation.read": workCopy(
		"Reviewing documentation…",
		"Reviewed documentation",
		"Couldn't review documentation"
	),
	"documentation.update": workCopy(
		"Updating documentation…",
		"Updated documentation",
		"Couldn't update documentation"
	),
	"environment.check": workCopy(
		"Checking command availability…",
		"Checked command availability",
		"Couldn't check command availability"
	),
	"execution.recovery.conversation.resume": workCopy(
		"Continuing the exact Agent conversation…",
		"Continued the exact Agent conversation",
		"Couldn't continue the exact Agent conversation"
	),
	"execution.recovery.inspect": workCopy(
		"Checking execution recovery options…",
		"Checked execution recovery options",
		"Couldn't check execution recovery options"
	),
	"execution.recovery.result.replay": workCopy(
		"Recovering the retained result…",
		"Recovered the retained result",
		"Couldn't recover the retained result"
	),
	"execution.recovery.retry_as_new_execution": workCopy(
		"Retrying as a new execution…",
		"Started a new execution",
		"Couldn't start a new execution"
	),
	"feedback.create": workCopy(
		"Submitting feedback…",
		"Submitted feedback",
		"Couldn't submit feedback"
	),
	"feedback.read": workCopy(
		"Reviewing feedback…",
		"Reviewed feedback",
		"Couldn't review feedback"
	),
	"feedback.update": workCopy(
		"Updating feedback…",
		"Updated feedback",
		"Couldn't update feedback"
	),
	"github.account.read": workCopy(
		"Checking the GitHub account…",
		"Checked the GitHub account",
		"Couldn't check the GitHub account"
	),
	"github.branches.read": workCopy(
		"Reviewing GitHub branches…",
		"Reviewed GitHub branches",
		"Couldn't review GitHub branches"
	),
	"github.checks.read": workCopy(
		"Reviewing GitHub checks…",
		"Reviewed GitHub checks",
		"Couldn't review GitHub checks"
	),
	"github.code.search": workCopy(
		"Searching GitHub code…",
		"Searched GitHub code",
		"Couldn't search GitHub code"
	),
	"github.commits.compare": workCopy(
		"Comparing GitHub commits…",
		"Compared GitHub commits",
		"Couldn't compare GitHub commits"
	),
	"github.commits.read": workCopy(
		"Reviewing GitHub commits…",
		"Reviewed GitHub commits",
		"Couldn't review GitHub commits"
	),
	"github.commits.search": workCopy(
		"Searching GitHub commits…",
		"Searched GitHub commits",
		"Couldn't search GitHub commits"
	),
	"github.directory.read": workCopy(
		"Reviewing a GitHub directory…",
		"Reviewed a GitHub directory",
		"Couldn't review the GitHub directory"
	),
	"github.file.delete": workCopy(
		"Deleting a GitHub file…",
		"Deleted a GitHub file",
		"Couldn't delete the GitHub file"
	),
	"github.file.read": workCopy(
		"Reviewing a GitHub file…",
		"Reviewed a GitHub file",
		"Couldn't review the GitHub file"
	),
	"github.file.update": workCopy(
		"Updating a GitHub file…",
		"Updated a GitHub file",
		"Couldn't update the GitHub file"
	),
	"github.issue.assignees.update": workCopy(
		"Updating GitHub issue assignees…",
		"Updated GitHub issue assignees",
		"Couldn't update GitHub issue assignees"
	),
	"github.issue.comment": workCopy(
		"Commenting on a GitHub issue…",
		"Commented on a GitHub issue",
		"Couldn't comment on the GitHub issue"
	),
	"github.issue.create": workCopy(
		"Creating a GitHub issue…",
		"Created a GitHub issue",
		"Couldn't create the GitHub issue"
	),
	"github.issue.labels.update": workCopy(
		"Updating GitHub issue labels…",
		"Updated GitHub issue labels",
		"Couldn't update GitHub issue labels"
	),
	"github.issue.update": workCopy(
		"Updating a GitHub issue…",
		"Updated a GitHub issue",
		"Couldn't update the GitHub issue"
	),
	"github.issues.read": workCopy(
		"Reviewing GitHub issues…",
		"Reviewed GitHub issues",
		"Couldn't review GitHub issues"
	),
	"github.issues.search": workCopy(
		"Searching GitHub issues…",
		"Searched GitHub issues",
		"Couldn't search GitHub issues"
	),
	"github.pull_request.branch.update": workCopy(
		"Updating a pull request branch…",
		"Updated a pull request branch",
		"Couldn't update the pull request branch"
	),
	"github.pull_request.comment": workCopy(
		"Commenting on a pull request…",
		"Commented on a pull request",
		"Couldn't comment on the pull request"
	),
	"github.pull_request.create": workCopy(
		"Creating a pull request…",
		"Created a pull request",
		"Couldn't create the pull request"
	),
	"github.pull_request.merge": workCopy(
		"Merging a pull request…",
		"Merged a pull request",
		"Couldn't merge the pull request"
	),
	"github.pull_request.review": workCopy(
		"Reviewing a pull request…",
		"Reviewed a pull request",
		"Couldn't review the pull request"
	),
	"github.pull_request.reviewers.update": workCopy(
		"Updating pull request reviewers…",
		"Updated pull request reviewers",
		"Couldn't update pull request reviewers"
	),
	"github.pull_request.update": workCopy(
		"Updating a pull request…",
		"Updated a pull request",
		"Couldn't update the pull request"
	),
	"github.pull_requests.read": workCopy(
		"Reviewing pull requests…",
		"Reviewed pull requests",
		"Couldn't review pull requests"
	),
	"github.ref.create": workCopy(
		"Creating a GitHub ref…",
		"Created a GitHub ref",
		"Couldn't create the GitHub ref"
	),
	"github.repositories.read": workCopy(
		"Reviewing GitHub repositories…",
		"Reviewed GitHub repositories",
		"Couldn't review GitHub repositories"
	),
	"github.repository.read": workCopy(
		"Reviewing a GitHub repository…",
		"Reviewed a GitHub repository",
		"Couldn't review the GitHub repository"
	),
	"github.workflow.rerun": workCopy(
		"Rerunning a GitHub workflow…",
		"Reran a GitHub workflow",
		"Couldn't rerun the GitHub workflow"
	),
	"github.workflows.read": workCopy(
		"Reviewing GitHub workflows…",
		"Reviewed GitHub workflows",
		"Couldn't review GitHub workflows"
	),
	"image.generate": workCopy(
		"Generating an image…",
		"Generated an image",
		"Couldn't generate the image"
	),
	"image.inspect": workCopy(
		"Inspecting an image…",
		"Inspected an image",
		"Couldn't inspect the image"
	),
	"navigation.prepare": workCopy(
		"Preparing a navigation link…",
		"Prepared a navigation link",
		"Couldn't prepare the navigation link"
	),
	"organization.document.draft": workCopy(
		"Drafting an Organization Document…",
		"Drafted an Organization Document",
		"Couldn't draft the Organization Document"
	),
	"organization.documents.manage": workCopy(
		"Organizing Organization Documents…",
		"Organized Organization Documents",
		"Couldn't organize Organization Documents"
	),
	"organization.documents.read": workCopy(
		"Reviewing Organization Documents…",
		"Reviewed Organization Documents",
		"Couldn't review Organization Documents"
	),
	"organization.invite.create": workCopy(
		"Creating an organization invitation…",
		"Created an organization invitation",
		"Couldn't create the organization invitation"
	),
	"organization.invite.read": workCopy(
		"Reviewing an organization invitation…",
		"Reviewed an organization invitation",
		"Couldn't review the organization invitation"
	),
	"organization.member_research.start": workCopy(
		"Starting to learn about you…",
		"Started learning about you",
		"Couldn't start learning about you"
	),
	"organization.member_computers.read": workCopy(
		"Checking a member's Computers…",
		"Checked a member's Computers",
		"Couldn't check the member's Computers"
	),
	"organization.member_service_status.read": workCopy(
		"Checking member OpenMeld Service status…",
		"Checked member OpenMeld Service status",
		"Couldn't check member OpenMeld Service status"
	),
	"organization.skills.install": workCopy(
		"Installing an Organization Skill…",
		"Installed an Organization Skill",
		"Couldn't install the Organization Skill"
	),
	"organization.skills.read": workCopy(
		"Reviewing Organization Skills…",
		"Reviewed Organization Skills",
		"Couldn't review Organization Skills"
	),
	"organization.members.read": workCopy(
		"Reviewing organization members…",
		"Reviewed organization members",
		"Couldn't review organization members"
	),
	"organization.memory.update": workCopy(
		"Updating organization memory…",
		"Updated organization memory",
		"Couldn't update organization memory"
	),
	"organization.settings.update": workCopy(
		"Updating organization settings…",
		"Updated organization settings",
		"Couldn't update organization settings"
	),
	"project.create": workCopy(
		"Creating a Project…",
		"Created a Project",
		"Couldn't create the Project"
	),
	"project.default.set": workCopy(
		"Setting the default Project…",
		"Set the default Project",
		"Couldn't set the default Project"
	),
	"project.remove": workCopy(
		"Removing a Project…",
		"Removed a Project",
		"Couldn't remove the Project"
	),
	"project.remove.prepare": workCopy(
		"Preparing to remove a Project…",
		"Prepared to remove a Project",
		"Couldn't prepare to remove the Project"
	),
	"project.update": workCopy(
		"Updating a Project…",
		"Updated a Project",
		"Couldn't update the Project"
	),
	"projects.read": workCopy(
		"Reviewing Projects…",
		"Reviewed Projects",
		"Couldn't review Projects"
	),
	"quality.check": workCopy(
		"Checking project quality…",
		"Checked project quality",
		"Couldn't complete the project quality check"
	),
	"repository.check": workCopy(
		"Checking the repository…",
		"Checked the repository",
		"Couldn't check the repository"
	),
	"repository.clone": workCopy(
		"Cloning the repository…",
		"Cloned the repository",
		"Couldn't clone the repository"
	),
	"repository.inspect": workCopy(
		"Inspecting the repository…",
		"Inspected the repository",
		"Couldn't inspect the repository"
	),
	"routine.create": workCopy(
		"Creating a Routine…",
		"Created a Routine",
		"Couldn't create the Routine"
	),
	"routine.delete": workCopy(
		"Deleting a Routine…",
		"Deleted a Routine",
		"Couldn't delete the Routine"
	),
	"routine.pause": workCopy(
		"Pausing a Routine…",
		"Paused a Routine",
		"Couldn't pause the Routine"
	),
	"routine.resume": workCopy(
		"Resuming a Routine…",
		"Resumed a Routine",
		"Couldn't resume the Routine"
	),
	"routine.update": workCopy(
		"Updating a Routine…",
		"Updated a Routine",
		"Couldn't update the Routine"
	),
	"routines.read": workCopy(
		"Reviewing Routines…",
		"Reviewed Routines",
		"Couldn't review Routines"
	),
	"slack.channel.history.read": workCopy(
		"Reviewing Slack channel history…",
		"Reviewed Slack channel history",
		"Couldn't review Slack channel history"
	),
	"slack.channel.members.read": workCopy(
		"Reviewing Slack channel members…",
		"Reviewed Slack channel members",
		"Couldn't review Slack channel members"
	),
	"slack.channels.read": workCopy(
		"Reviewing Slack channels…",
		"Reviewed Slack channels",
		"Couldn't review Slack channels"
	),
	"slack.members.read": workCopy(
		"Reviewing Slack members…",
		"Reviewed Slack members",
		"Couldn't review Slack members"
	),
	"slack.message.post": workCopy(
		"Posting a Slack message…",
		"Posted a Slack message",
		"Couldn't post the Slack message"
	),
	"slack.messages.search": workCopy(
		"Searching Slack messages…",
		"Searched Slack messages",
		"Couldn't search Slack messages"
	),
	"source.read": workCopy(
		"Reviewing source files…",
		"Reviewed source files",
		"Couldn't review source files"
	),
	"source.search": workCopy(
		"Searching the codebase…",
		"Searched the codebase",
		"Couldn't search the codebase"
	),
	"source.update": workCopy(
		"Updating source files…",
		"Updated source files",
		"Couldn't update source files"
	),
	"space.agents.add": workCopy(
		"Adding an Agent Profile to the Space…",
		"Added an Agent Profile to the Space",
		"Couldn't add the Agent Profile to the Space"
	),
	"space.agents.remove": workCopy(
		"Removing an Agent Profile from the Space…",
		"Removed an Agent Profile from the Space",
		"Couldn't remove the Agent Profile from the Space"
	),
	"space.agents.wake": workCopy(
		"Waking an Agent Profile…",
		"Woke an Agent Profile",
		"Couldn't wake the Agent Profile"
	),
	"space.context.read": workCopy(
		"Reviewing Space context…",
		"Reviewed Space context",
		"Couldn't review Space context"
	),
	"space.create": workCopy(
		"Creating a Space…",
		"Created a Space",
		"Couldn't create the Space"
	),
	"space.members.add": workCopy(
		"Adding members to the Space…",
		"Added members to the Space",
		"Couldn't add members to the Space"
	),
	"space.message.post": workCopy(
		"Posting a Space message…",
		"Posted a Space message",
		"Couldn't post the Space message"
	),
	"space.settings.update": workCopy(
		"Updating Space settings…",
		"Updated Space settings",
		"Couldn't update Space settings"
	),
	"spaces.read": workCopy(
		"Checking available Spaces…",
		"Checked available Spaces",
		"Couldn't check available Spaces"
	),
	"task.delegate": workCopy(
		"Delegating a task…",
		"Delegated a task",
		"Couldn't delegate the task"
	),
	"task.watch": workCopy(
		"Starting a task watch…",
		"Started a task watch",
		"Couldn't start the task watch"
	),
	"tasks.read": workCopy(
		"Checking recent Agent tasks…",
		"Checked recent Agent tasks",
		"Couldn't check recent Agent tasks"
	),
	"tests.run": workCopy(
		"Running project tests…",
		"Ran project tests",
		"Couldn't run project tests"
	),
	"web.data.extract": workCopy(
		"Extracting webpage data…",
		"Extracted webpage data",
		"Couldn't extract webpage data"
	),
	"web.links.read": workCopy(
		"Reviewing webpage links…",
		"Reviewed webpage links",
		"Couldn't review webpage links"
	),
	"web.search": workCopy(
		"Searching the web…",
		"Searched the web",
		"Couldn't search the web"
	),
	"webpage.read": workCopy(
		"Reading a webpage…",
		"Read a webpage",
		"Couldn't read the webpage"
	),
	"webpage.scrape": workCopy(
		"Collecting webpage content…",
		"Collected webpage content",
		"Couldn't collect webpage content"
	),
	"webpage.screenshot": workCopy(
		"Capturing a webpage screenshot…",
		"Captured a webpage screenshot",
		"Couldn't capture the webpage screenshot"
	),
} satisfies Record<AgentWorkActivity["key"], AgentWorkCopy>;

export function resolveAgentWorkPresentation(
	work: AgentWorkActivity,
	state: "input-available" | "output-available" | "output-error",
	isLive: boolean
): AgentWorkPresentation {
	const copy = resolveAgentWorkCopy(work);
	if (state === "output-error") {
		return { status: "failed", text: copy.failed };
	}
	if (state === "input-available" && isLive) {
		return { status: "active", text: copy.active };
	}
	if (state === "input-available") {
		return {
			status: "complete",
			text: `Started: ${copy.active.replace(TRAILING_ELLIPSIS_PATTERN, "")}`,
		};
	}
	return { status: "complete", text: copy.complete };
}

function resolveAgentWorkCopy(work: AgentWorkActivity): AgentWorkCopy {
	if (!work.subject?.label) {
		return AGENT_WORK_COPY[work.key];
	}
	if (work.key === "repository.clone") {
		const repository = work.subject.label;
		return workCopy(
			`Cloning ${repository}…`,
			`Cloned ${repository}`,
			`Couldn't clone ${repository}`
		);
	}
	if (work.key === "connected_app.action.execute") {
		const action = work.subject.label;
		return workCopy(
			`Running ${action}…`,
			`Ran ${action}`,
			`Couldn't run ${action}`
		);
	}
	if (work.key === "connected_app.actions.read") {
		const app = work.subject.label;
		return workCopy(
			`Checking ${app} actions…`,
			`Checked ${app} actions`,
			`Couldn't check ${app} actions`
		);
	}
	const copy = AGENT_WORK_COPY[work.key];
	const subject = work.subject.label;
	return workCopy(
		`${copy.active.replace(TRAILING_ELLIPSIS_PATTERN, "")} — ${subject}…`,
		`${copy.complete} — ${subject}`,
		`${copy.failed} — ${subject}`
	);
}
