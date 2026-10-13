# Comparison evidence

Reviewed 2026-10-13. This is a capability comparison, not a measured performance
benchmark. `comparison-section.tsx` owns the displayed snapshot. Keep evidence
here rather than adding research notes or a symbol legend to the landing page.
Recheck sources before changing a cell. Public source proves implementation,
not deployment or hands-on acceptance. An undocumented feature stays unknown.

## Row scope

- Native team chat means multiple people can exchange messages with agents
  inside the product; an issue comment or external Slack route is narrower.
- Team knowledge means maintained shared reference material. Agent files,
  Skills, and an optional Wiki plugin are named explicitly when those are the
  verified mechanisms; they do not imply a separate native knowledge library.
- Persistent memory means information retained across conversations. Runtime
  and SDK restrictions remain visible. Memory need not be enabled by default.
- Reusable Skills includes runtime-provided Skills; it does not promise every
  product has a central organization-owned skill library.
- Shared files and folders means a managed team library, not attachments or a
  coding workspace. Version history excludes Git. Deliverables, documents,
  and Pages have explicit scope labels.
- Required task review means a configurable reviewer acceptance gate before
  completion, not tool permission or a manually editable review status.
- Coding-agent dispatch means the product starts work through a user's Codex
  or Claude Code runtime. A CLI calling the product in the reverse direction
  is not sufficient evidence.
- Hosted execution means vendor-provided execution, not a control plane that
  requires the customer to supply a computer or cloud VM.
- Plugin counts are vendor/service catalog entries, not individual API tools,
  coding runtimes, connected accounts, or documentation pages. A dash is an
  unverified comparable total, not zero.
- MIT concerns core code. It does not assert identical hosted/enterprise terms.

## OpenMeld

### Cloud Computer comparison (reviewed 2026-10-13)

The two leading rows distinguish a free vendor-hosted Computer from using that
Computer through local and remote agents. They do not promise free model tokens,
unlimited compute, an always-running VM, or a human remote desktop. A boolean
negative in the second row means no vendor-provided Computer to share, not that
agents cannot share a customer's own machine.

- OpenMeld: `developing/product/remote-agent-runtime.md`, Personal cloud Computer,
  defines one default Computer per human account across Organizations, Agents,
  and conversations. Center, personal Remote, and optional Local Agents use the
  same operation contract and persistent `/computer` files. The existing
  homepage offer explicitly includes a free Computer for each user. Local
  access is optional and authorized, not an automatic move of local work.
- Raft: [product FAQ](https://raft.build/) defines Computer as a process on the
  user's machine. [External agents](https://docs.raft.build/features/agents/external/)
  also run on customer-supplied infrastructure. Free software is not free compute.
- Multica: [Cloud quickstart](https://multica.ai/docs/cloud-quickstart) requires
  connecting a computer with installed coding tools; agents execute on those
  connected computers. Hosted management does not provide a free execution VM.
- Paperclip: [homepage](https://paperclip.ing/) offers a Cloud waitlist and a
  local installation, not a currently available free hosted Computer.
- Dust: [Computer lifecycle](https://dust.tt/academy/computer/chapter/computer)
  is a Linux VM per conversation, deleted after seven inactive days; output
  files remain with that conversation. [Pricing](https://dust.tt/home/pricing)
  offers 500 lifetime starter credits rather than a replenishing compute grant.
  External callers can work through Dust agents; direct local-agent access to
  the same VM was not established. Hence the narrower `Via Dust agents` label.
- Viktor: [Plans and credits](https://viktor.com/docs/plans-and-credits) gives
  one-time starter credits; work pauses when exhausted.
  [Public API script runs](https://viktor.com/docs/public-api) execute in the
  key owner's workspace sandbox and see the same files as chat. A local caller
  can use that API, but this is not a verified native local-agent integration.
- OpenHands: [current pricing](https://www.openhands.dev/pricing) advertises a
  free Individual cloud tier (10 daily conversations); model usage is BYOK or
  at cost. Do not call this only a trial or mark free cloud access absent.
  [CloudWorkspace source](https://github.com/OpenHands/software-agent-sdk/blob/main/openhands-workspace/openhands/workspace/cloud/workspace.py)
  supports starting or resuming a sandbox through the Cloud API from an SDK
  client. This is not proof of one persistent free personal Computer shared
  automatically across arbitrary agents; retain `Free cloud tier` / `Via SDK`.

These are documented product offers and access paths, not hands-on acceptance
in paid competitor accounts. OpenMeld's personal Computer contract is stronger
than the narrower alternatives, but those alternatives must remain visible.

Current product evidence: `clients/docs/content/docs/work/messages.mdx`,
`work/files.mdx`, `work/tasks.mdx`, `work/memory.mdx`, `work/routines.mdx`,
`work/cloud-computer.mdx`, `team/knowledge.mdx`, and `team/skills.mdx`.
These establish native conversations, managed file revisions/Trash, independent
task review, member/Organization memory, approved knowledge, and versioned Skills.
When a reviewer is assigned, a new submitted result needs a fresh acceptance.

The row explicitly compares public catalog size. It shares `plugin-catalog.ts`
with the homepage Plugin showcase: entries marked available in the public
catalog, rounded down to tens. This currently displays 60+. It does not claim
account-specific connection readiness or successful integration tests.

Earlier normal production UI inspection found 56 Personal and 52 Organization
Plugin entries, which justified 50+ in the design proposal. Do not sum those
overlapping sets or confuse account-visible entries with the public catalog.
The implemented page now uses one explicitly named public-catalog basis in
both sections, rather than displaying two differently scoped counts.

The source LICENSE is MIT. The advertised public repository returned 404 to
anonymous research; resolve public access before publishing an open-source
availability claim. This remains the existing public-launch condition recorded
in `developing/clients/website.md`.

## Raft

- [Native channels and DMs](https://docs.raft.build/features/server/).
- [Workspace knowledge](https://docs.raft.build/features/agents/workspace/) and
  [runtime memory/Skills](https://github.com/botiverse/raft-source/blob/main/manual/agent-knowledge/runtime.md).
- [Immutable uploaded attachments](https://github.com/botiverse/raft-source/blob/main/manual/agent-knowledge/attachment.md)
  and [attachment routes](https://github.com/botiverse/raft-source/blob/main/packages/server/src/routes/attachments.ts):
  no native attachment revisions/restore; the Files tab collects chat attachments.
- [Task transitions](https://github.com/botiverse/raft-source/blob/main/manual/agent-knowledge/task.md):
  manual review and send-back exist, but work can transition straight to Done.
- [Customer-connected computers](https://docs.raft.build/features/server/computers/)
  and [recurring reminders](https://docs.raft.build/features/agents/reminders/).
  Reminders support built-in agents; external-agent scheduling has limits.
- [FSL license](https://github.com/botiverse/raft-source/blob/main/LICENSE), not MIT.

## Multica

- [Chat](https://multica.ai/docs/chat) is one person and one agent. Team discussion
  exists in issues; this is not a claim that Multica lacks collaboration.
- [Shared Skills](https://multica.ai/docs/skills) carry reference material.
- [Hermes memory](https://github.com/multica-ai/multica/blob/main/server/internal/daemon/execenv/hermes_memory.go)
  and [Codex memory policy](https://github.com/multica-ai/multica/blob/main/server/internal/daemon/execenv/codex_memory.go)
  establish runtime-specific persistence.
- [Deliverable version UI](https://github.com/multica-ai/multica/blob/main/packages/views/issues/components/deliverables/attachment-versions.tsx)
  and [version grouping](https://github.com/multica-ai/multica/blob/main/packages/core/attachments/deliverables.ts)
  retain same-name/type issue outputs; generic team-file restoration is unverified.
- [Issue states](https://multica.ai/docs/issues#status) allow humans or agents to
  change state directly. Review is manual, not an enforced independent gate.
- [Runtimes](https://multica.ai/docs/daemon-runtimes) are customer-connected;
  [Autopilots](https://multica.ai/docs/autopilots) provide scheduled work.
- [License](https://multica.ai/licensing) has commercial conditions, not MIT.

## Paperclip

- [Agent Chat](https://docs.paperclip.ing/experimental/agent-chat/) allows its
  human owner to send while teammates read; shared task discussion also exists.
- [Official Wiki plugin](https://docs.paperclip.ing/reference/plugins/llm-wiki/)
  is optional and alpha.
- [Memory Skill](https://github.com/paperclipai/paperclip/blob/master/skills/para-memory-files/SKILL.md)
  and [memory connectors](https://docs.paperclip.ing/connectors/memory-connectors/)
  provide durable knowledge with setup, not automatic universal memory sync.
- [Skills](https://docs.paperclip.ing/guides/org/skills/),
  [read-only artifacts](https://docs.paperclip.ing/guides/day-to-day/artifacts/),
  and [keyed document revisions/restore](https://docs.paperclip.ing/guides/day-to-day/issues/#keyed-documents).
- [Review policy](https://github.com/paperclipai/paperclip/blob/master/server/src/services/issue-review-policy.ts)
  enforces configured reviewer rules for approve/reject; default is unrestricted.
- [Product](https://paperclip.ing/) advertises local/remote agents and a managed
  Cloud waitlist. [Core source](https://github.com/paperclipai/paperclip) is MIT.

## Dust

- [Pod conversations](https://docs.dust.tt/docs/user-documentation/pods/conversations),
  [files/folders and searchable knowledge](https://docs.dust.tt/docs/user-documentation/pods/files),
  [Skills](https://docs.dust.tt/docs/user-documentation/agents/skills/skills-management).
- [Durable user memory](https://github.com/dust-tt/dust/blob/edc135fec983e32aef526057b682daca57b4bc31/front/lib/api/actions/servers/user_memory/metadata.ts)
  is shared across the user's agents; not independently exercised in production.
- [Tasks](https://docs.dust.tt/docs/user-documentation/pods/tasks) and
  [task schema](https://github.com/dust-tt/dust/blob/edc135fec983e32aef526057b682daca57b4bc31/front/types/project_task.ts)
  permit direct agent completion, without a native pre-completion reviewer gate.
- File revision counters provide conflict protection, not proof of history UI.
  Generic file version recovery remains unverified.
- [Dust CLI](https://docs.dust.tt/docs/developer-platform/dust-cli/dust-cli)
  supports local files; reverse dispatch into coding agents remains unverified.
- [Product](https://dust.tt/) reports 70+ connectors. Hosted Computer and scheduled
  work are documented; [core source](https://github.com/dust-tt/dust) is MIT.

## Viktor

- [Skills](https://viktor.com/docs/skills) and
  [personalization](https://viktor.com/docs/personalize-viktor) retain personal
  and shared procedures/preferences across conversations.
- [Hosted Pages](https://viktor.com/docs/hosted-pages) keep 10 prior versions
  with preview/restore. Do not extrapolate to general uploaded files.
- [Chat](https://viktor.com/docs/talk-to-viktor) establishes Slack/Teams team use.
  Native human group chat and a general team file library remain unverified.
- [Scheduled tasks](https://viktor.com/docs/scheduled-tasks) establish agent jobs,
  not a human-assignee board. [Approvals](https://viktor.com/docs/approvals) are
  action permissions, not established deliverable acceptance.
- [Local-file limitation](https://viktor.com/blog/viktor-vs-claude-cowork),
  [hosted workspace API](https://viktor.com/docs/public-api), and
  [MCP](https://viktor.com/docs/mcp-server). Reverse coding-agent dispatch is unknown.
- [Integrations](https://viktor.com/integrations): 27 native plus 3,200+ managed
  connector apps; [license terms](https://viktor.com/legal/license-terms) are proprietary.
- Web-app and scheduled-task docs conflict about Slack-independent web access;
  the table deliberately omits that earlier proposed row.

## OpenHands

- [ACP agents](https://docs.openhands.dev/openhands/usage/agent-canvas/acp-agents)
  launch installed Codex/Claude Code runtimes; this is not attachment to any
  arbitrary running terminal session.
- [Persistent memory](https://docs.openhands.dev/sdk/guides/persistent-memory)
  is SDK opt-in and off by default. [Skills](https://docs.openhands.dev/overview/skills)
  provide repository and procedural knowledge.
- [Conversations](https://docs.openhands.dev/openhands/usage/agent-canvas/conversations)
  expose workspace files; a shared team drive and non-Git file history are unknown.
- Agent tasks, Critic feedback, tool approvals, and GitHub PR review do not prove
  native human task assignment or a deliverable reviewer gate.
- [Core source](https://github.com/OpenHands/OpenHands) documents local/cloud
  execution, automations, and MIT licensing. Plugin bundles exist, but no
  comparable verified catalog total was established.
