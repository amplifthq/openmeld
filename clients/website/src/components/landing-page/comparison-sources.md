# Comparison evidence

Reviewed **2026-10-15**: seven products × 16 features = **112 cells**.
`comparison-section.tsx` owns the website snapshot; README repeats its values.
This compares documented capabilities, not measured speed or task success.

The audit combines direct first-party documentation and public-source review
with a separate local Grok CLI review (`grok-4.7`, `xhigh`). Final conclusions
reconcile both reviews against the sources below. Model output is not evidence.
No paid competitor account or end-to-end competitor workflow was tested.
Public source proves implementation, not deployment or account entitlement.
Missing documentation means **unknown**, not **No**.

Keep these notes beside the component rather than adding a research legend to
the landing page. Recheck first-party evidence before changing a cell.

## Corrections from the October 13 snapshot

| Finding | Previous | Correction |
| --- | --- | --- |
| Raft public sharing understated | Member links | Artifacts app supports public links without sign-in. Channels remain member-scoped. |
| Raft file history false negative | No | Artifacts app retains versions; message attachments are unversioned. |
| Dust public sharing understated | Member links | Frames support public external links. |
| Dust version recovery omitted | Unknown | Frames support reverting edits and restoring earlier versions. |
| OpenHands public sharing omitted | Unknown | Cloud API and viewer support public conversations; source evidence, not account acceptance. |
| Narrower collaboration hidden | Multica/Paperclip team chat: No | Name their shared Issue threads. |
| Narrower files omitted | Multica/Viktor: Unknown | Name Issue files and Chat files without implying full folder libraries. |
| Paperclip history incomplete | Docs only | Docs plus revision history in the optional Wiki plugin. |
| Integration units inconsistent | Counts for three products; dashes for four | Name connection methods for all products; no comparable count does not mean no integrations. |
| Optional features looked universal | Approval/memory checkmarks; Raft scheduling checkmark | Configurable approval; named memory mechanisms; managed-agent schedules. |
| Execution scope unclear | Raft/Multica/Paperclip hosted agents: No | Own compute / Own compute / Cloud waitlist. |
| License differences hidden | MIT Yes/No | Name actual licenses and additional terms. |

Raft's Joint Channels do **not** establish anonymous sharing. Server-public
channels are readable by that server's members; Joint Channels require members
added across servers. The verified public-link product is the **Artifacts app**:
private by default, public after a human owner/admin enables it. Comments and
history have separate controls. Do not confuse live HTML artifact previews
with public access to a live channel.

## Common row definitions

| Feature | Scope |
| --- | --- |
| Run your local agents | Launch supported local coding runtimes such as Codex/Claude Code. A local CLI calling a hosted agent in reverse is insufficient. |
| Built-in team chat | Multi-human/agent messaging inside the product. Name Issue threads and external chat as narrower alternatives. |
| Tasks for people & agents | Human and agent assignees. Agent-only work is labeled. |
| Require task approval | Configurable acceptance gate before completion, not tool permission or a freely editable review status. |
| Shared files & folders | Managed shared file areas; explicitly name attachments, issue/chat files, and coding workspaces as narrower alternatives. |
| Public sharing links | View intentionally shared work without joining the team. Name the object; an artifact link does not make the workspace public. |
| Hosted cloud agents | Vendor execution; distinguish customer computers/cloud deployments. |
| Free personal cloud computer | Free vendor-hosted personal execution. Starter credits/free cloud tiers are narrower offers. No promise of free models, unlimited compute, or an always-running VM. |
| Work in your local folders | Direct authorized local-folder access; uploads alone do not qualify. |
| Team knowledge base | Maintained shared references; name Skills, agent files, project context, or optional Wiki where applicable. |
| Memory across chats | Retained information across conversations; show runtime/setup/SDK limits. |
| Saved instructions (Skills) | Reusable instructions, including runtime Skills; not necessarily a central team library. |
| Previous file versions | Retained revisions or restore, excluding Git; name the supported object. |
| Run tasks on a schedule | Scheduled agent work, subject to runtime availability. |
| Apps & plugins | Connection methods, not incomparable counts of apps/connectors/tools/accounts. |
| Core license | Core source license, not every asset or enterprise/hosted-service term. |

**Yes** means supported in this scope; **No** is a supported negative in this
scope; **?** is unresolved. Text identifies support, setup, or availability
limits. The seven tables below cover every displayed cell.

## OpenMeld — 16 cells

Repository paths refer to this checkout. The repository was verified public
during this audit; the older anonymous-404 observation is no longer current.

| Feature | Value | Evidence and limits |
| --- | --- | --- |
| Run your local agents | Yes | `clients/docs/content/docs/local-agents/index.mdx`: supported tools on a connected computer. |
| Built-in team chat | Yes | `developing/product/space-collaboration.md`: Space messages/Threads for humans and Agents. |
| Tasks for people & agents | Yes | `clients/docs/content/docs/work/tasks.mdx`: human or Agent assignee. |
| Require task approval | Configurable | Task guide and `services/core/src/space/application/space-task-workflow.ts`: a reviewer must accept each submitted result when assigned; otherwise submission completes the task. |
| Shared files & folders | Yes | `developing/product/files.md`: Team, member-private, and Space roots, folders, permissions, revisions, Trash. |
| Public sharing links | Spaces | Space collaboration owner: public reading without membership and password-protected modes. Not public links for individual private Team/My files. |
| Hosted cloud agents | Yes | `developing/product/remote-agent-runtime.md`: hosted Center/Remote Agents and personal Computer. |
| Free personal cloud computer | Yes | Homepage offer and runtime owner: one default Computer per human account, persistent `/computer` files. Processes/packages/browser sessions need not survive recreation; models are billed separately. |
| Work in your local folders | Yes | Local Agents guide: selected authorized project folder on connected computer. |
| Team knowledge base | Yes | `clients/docs/content/docs/team/knowledge.mdx`: approved shared knowledge, distinct from attachments. |
| Memory across chats | Center Agent | `clients/docs/content/docs/work/memory.mdx`: Center Agent member/Organization memory; not universal local-runtime memory. |
| Saved instructions (Skills) | Yes | `clients/docs/content/docs/team/skills.mdx`: shared versioned instructions. |
| Previous file versions | Yes | `clients/docs/content/docs/work/files.mdx`: revision history and restore. |
| Run tasks on a schedule | Yes | `clients/docs/content/docs/work/routines.mdx`: local/remote executors; local computer must be available. |
| Apps & plugins | Plugin catalog | `packages/product-catalog/src/plugins.ts` and homepage `plugin-catalog.ts`: available catalog entries, not account-specific connection readiness. |
| Core license | MIT | Root `LICENSE`; third-party/hosted terms remain separate. |

## Raft — 16 cells

Source inspected at `a98ae003246a0360872a77d76dec2fccd0347ef7`.
The live [Artifacts service][r-artifacts] and [manifest][r-manifest] independently
document public access and version actions.

| Feature | Value | Evidence and limits |
| --- | --- | --- |
| Run your local agents | Yes | [External agents][r-external], [runtime manual][r-runtime]: coding runtimes on customer computers. |
| Built-in team chat | Yes | [Servers][r-server]: channels, threads, DMs for people and agents. |
| Tasks for people & agents | Yes | [Task manual][r-task]: human/agent claims. |
| Require task approval | Manual | [Task transitions][r-task] permit in-progress directly to done; review/send-back is not mandatory acceptance. |
| Shared files & folders | Attachments / app | [Files][r-files] collects attachments; [Artifacts][r-attachment] is a separate app, not a native managed folder library. |
| Public sharing links | Artifacts app | [Manifest][r-manifest]: public without sign-in after human admin enables it. [Joint Channels][r-joint] remain member-scoped. |
| Hosted cloud agents | Own compute | [Product][r-home]: Computer is a local process; [Computer manual][r-computer] lists Cloud Computer as coming soon. |
| Free personal cloud computer | No | Same Computer sources: no current vendor execution offer; free software is not free compute. |
| Work in your local folders | Yes | [Workspace][r-workspace]: local files on connected computer. |
| Team knowledge base | Agent files | [Workspace][r-workspace]: agent notes/files, not a separate team reference library. |
| Memory across chats | Yes | [Runtime manual][r-runtime]: persistent memory files; full reset clears them. |
| Saved instructions (Skills) | Yes | [Runtime manual][r-runtime]: runtime Skills; handling varies by runtime. |
| Previous file versions | Artifacts app | [Attachment manual][r-attachment]/[manifest][r-manifest]: retained versions, stable/per-version URLs. Message attachments are unversioned. Superseded CI artifact versions have a 24-hour grace period. |
| Run tasks on a schedule | Managed agents | [Reminders][r-reminders]; [external-agent manual][r-external-manual] rejects external-agent reminders. |
| Apps & plugins | App marketplace | [Apps][r-apps]: marketplace, private-shared, server-local apps. |
| Core license | FSL-1.1-ALv2 | [License][r-license]: competing-use restriction and future Apache conversion terms; not MIT. |

[r-home]: https://raft.build/
[r-server]: https://docs.raft.build/features/server/
[r-external]: https://docs.raft.build/features/agents/external/
[r-workspace]: https://docs.raft.build/features/agents/workspace/
[r-files]: https://docs.raft.build/features/collaboration/files.md
[r-joint]: https://docs.raft.build/features/messaging/joint-channels/
[r-reminders]: https://docs.raft.build/features/agents/reminders/
[r-apps]: https://github.com/botiverse/raft-source/blob/a98ae003246a0360872a77d76dec2fccd0347ef7/manual/agent-knowledge/integration.md
[r-artifacts]: https://raft-artifacts.com/
[r-manifest]: https://raft-artifacts.com/.well-known/raft-agent-manifest.json
[r-runtime]: https://github.com/botiverse/raft-source/blob/a98ae003246a0360872a77d76dec2fccd0347ef7/manual/agent-knowledge/runtime.md
[r-task]: https://github.com/botiverse/raft-source/blob/a98ae003246a0360872a77d76dec2fccd0347ef7/manual/agent-knowledge/task.md
[r-computer]: https://github.com/botiverse/raft-source/blob/a98ae003246a0360872a77d76dec2fccd0347ef7/manual/agent-knowledge/computer.md
[r-attachment]: https://github.com/botiverse/raft-source/blob/a98ae003246a0360872a77d76dec2fccd0347ef7/manual/agent-knowledge/attachment.md
[r-external-manual]: https://github.com/botiverse/raft-source/blob/a98ae003246a0360872a77d76dec2fccd0347ef7/manual/agent-knowledge/external-agent.md
[r-license]: https://github.com/botiverse/raft-source/blob/a98ae003246a0360872a77d76dec2fccd0347ef7/LICENSE

## Multica — 16 cells

| Feature | Value | Evidence and limits |
| --- | --- | --- |
| Run your local agents | Yes | [Cloud quickstart][m-cloud], [runtimes][m-runtime]: installed coding tools on connected computers. |
| Built-in team chat | Issue threads | [Comments][m-comments]: shared issue discussions/mentions. [Chat][m-chat] itself is private one-human/one-agent. |
| Tasks for people & agents | Yes | [Issues][m-issues]: human and agent assignees. |
| Require task approval | Manual | [Issues][m-issues]: directly editable states; review status does not establish an enforced gate. |
| Shared files & folders | Issue files | [Comments][m-comments] and [deliverables][m-deliverables]: attachments/outputs, not managed room folders. |
| Public sharing links | ? | No anonymous-sharing contract established; public runtimes mean workspace routing access, not anonymous links. |
| Hosted cloud agents | Own compute | [Cloud quickstart][m-cloud]: hosted management with customer-connected execution. |
| Free personal cloud computer | No | Same quickstart requires customer computer; no vendor execution VM in this offer. |
| Work in your local folders | Yes | [Project resources][m-resources]: linked local directory edited in place. |
| Team knowledge base | Skills / projects | [Skills][m-skills] reference files and [projects][m-projects] shared descriptions/context; not a separate knowledge service. |
| Memory across chats | By runtime | [Hermes][m-hermes] and [Codex][m-codex] source: runtime-specific persistence; Codex native memory requires opt-in. |
| Saved instructions (Skills) | Yes | [Skills][m-skills]: workspace and runtime Skills. |
| Previous file versions | Deliverables | [Grouping][m-deliverables] and [UI][m-versions], source evidence: same filename/type outputs form versions; generic team-file restore unverified. |
| Run tasks on a schedule | Yes | [Autopilots][m-autopilots]: schedules/webhooks; requires available runtime. |
| Apps & plugins | Chat / Git / MCP | [CLI][m-cli]: workspace/agent MCP configuration; official docs list chat/Git integrations. |
| Core license | Apache + terms | [License][m-license]: Apache 2.0 plus commercial conditions, including external-hosting restrictions. |

[m-cloud]: https://multica.ai/docs/cloud-quickstart
[m-runtime]: https://multica.ai/docs/daemon-runtimes
[m-comments]: https://multica.ai/docs/comments
[m-chat]: https://multica.ai/docs/chat
[m-issues]: https://multica.ai/docs/issues
[m-resources]: https://multica.ai/docs/project-resources
[m-projects]: https://multica.ai/docs/projects
[m-skills]: https://multica.ai/docs/skills
[m-autopilots]: https://multica.ai/docs/autopilots
[m-cli]: https://multica.ai/docs/cli
[m-license]: https://multica.ai/licensing
[m-hermes]: https://github.com/multica-ai/multica/blob/main/server/internal/daemon/execenv/hermes_memory.go
[m-codex]: https://github.com/multica-ai/multica/blob/main/server/internal/daemon/execenv/codex_memory.go
[m-deliverables]: https://github.com/multica-ai/multica/blob/main/packages/core/attachments/deliverables.ts
[m-versions]: https://github.com/multica-ai/multica/blob/main/packages/views/issues/components/deliverables/attachment-versions.tsx

## Paperclip — 16 cells

| Feature | Value | Evidence and limits |
| --- | --- | --- |
| Run your local agents | Yes | [Product][p-home]: local coding-agent adapters. |
| Built-in team chat | Issue threads | [Issues][p-issues] support shared discussion; [Agent Chat][p-chat] allows teammates to read but only owner to send. |
| Tasks for people & agents | Yes | [Issues][p-issues], [work modes][p-work]: human and agent work assignment. |
| Require task approval | Configurable | [Execution policy][p-policy]: configured stages intercept completion and route to reviewer/approver; stages are optional. |
| Shared files & folders | Issue files | [Artifacts][p-artifacts]: attachments, workspace browser, company shelf; not room-owned folder library. |
| Public sharing links | ? | Artifact/comment deep links do not establish anonymous access. |
| Hosted cloud agents | Cloud waitlist | [Homepage][p-home]: managed Cloud waitlist; customer-hosted/local execution available. |
| Free personal cloud computer | No | Same offer: no currently available free vendor computer. |
| Work in your local folders | Yes | [Artifacts][p-artifacts], [Skills][p-skills]: project workspaces and approved local roots. |
| Team knowledge base | Wiki plugin | [LLM Wiki][p-wiki]: optional alpha plugin with local Markdown wiki. |
| Memory across chats | Skills / connectors | [Memory Skill][p-memory-skill], [connectors][p-memory]: explicit setup; not automatic universal sync. |
| Saved instructions (Skills) | Yes | [Skills][p-skills]: company library and version restore. |
| Previous file versions | Docs / Wiki | [Keyed documents][p-issues]: revisions/diff/restore; [Wiki][p-wiki]: page revision history. Not every attachment. |
| Run tasks on a schedule | Yes | [Routines][p-routines]: scheduled work; Wiki routines start paused. |
| Apps & plugins | Connectors / plugins | [Connectors][p-connectors] and [Wiki][p-wiki]: integrations and plugin runtime. |
| Core license | MIT | [LICENSE][p-license]; hosted terms separate. |

[p-home]: https://paperclip.ing/
[p-issues]: https://docs.paperclip.ing/guides/day-to-day/issues/
[p-work]: https://docs.paperclip.ing/guides/day-to-day/work-modes/
[p-chat]: https://docs.paperclip.ing/experimental/agent-chat/
[p-policy]: https://docs.paperclip.ing/guides/power/execution-policy/
[p-artifacts]: https://docs.paperclip.ing/guides/day-to-day/artifacts/
[p-skills]: https://docs.paperclip.ing/guides/org/skills/
[p-wiki]: https://docs.paperclip.ing/reference/plugins/llm-wiki/
[p-memory]: https://docs.paperclip.ing/connectors/memory-connectors/
[p-memory-skill]: https://github.com/paperclipai/paperclip/blob/master/skills/para-memory-files/SKILL.md
[p-routines]: https://docs.paperclip.ing/guides/projects-workflow/routines/
[p-connectors]: https://docs.paperclip.ing/connectors/
[p-license]: https://github.com/paperclipai/paperclip/blob/master/LICENSE

## Dust — 16 cells

| Feature | Value | Evidence and limits |
| --- | --- | --- |
| Run your local agents | ? | [CLI][d-cli] and Skills let local agents call Dust; reverse direction does not establish launching local coding agents. |
| Built-in team chat | Yes | [Pod conversations][d-chat]: members and agents share messages. |
| Tasks for people & agents | Yes | [Pod tasks][d-tasks]: human and agent assignments. |
| Require task approval | No | [Tasks][d-tasks]: agents can mark own tasks done; no pre-completion reviewer gate. Tool approval is separate. |
| Shared files & folders | Yes | [Pod Files][d-files]: folders/uploads/linked company data. |
| Public sharing links | Frames | [Frames][d-frames]: external links, public sharing on by default, admin controls. Token-bearing URL does not require workspace membership; not public Pod access. |
| Hosted cloud agents | Yes | [Computer][d-computer]: hosted Linux execution. |
| Free personal cloud computer | Starter credits | [Pricing][d-pricing]: 500 lifetime credits; [Computer][d-computer] per conversation, deleted after seven inactive days; output files remain. |
| Work in your local folders | Via CLI | [CLI][d-cli]: local filesystem tools in chat with edit permissions; not merely uploads. |
| Team knowledge base | Yes | [Pod Files][d-files]: shared searchable references/connected company data. |
| Memory across chats | Memory tool | [Agent memory][d-memory]: configured persistent memory tool; cross-agent scope disputed between docs/source, so no cross-agent claim. |
| Saved instructions (Skills) | Yes | [Skills][d-skills]: reusable instructions. |
| Previous file versions | Frames | [Frames][d-frames]: revert edits/restore earlier versions; generic Pod-file history unverified. |
| Run tasks on a schedule | Yes | [Schedules][d-schedules]: configured agent runs. |
| Apps & plugins | Connectors / MCP | [Product][d-home], official [docs index][d-index]: connectors/MCP tools; totals not compared. |
| Core license | MIT | [LICENSE][d-license]: MIT grant, not identical hosted terms. |

[d-home]: https://dust.tt/
[d-index]: https://docs.dust.tt/llms.txt
[d-chat]: https://docs.dust.tt/docs/user-documentation/pods/conversations
[d-tasks]: https://docs.dust.tt/docs/user-documentation/pods/tasks
[d-files]: https://docs.dust.tt/docs/user-documentation/pods/files
[d-frames]: https://docs.dust.tt/docs/user-documentation/agents/frames/overview
[d-computer]: https://dust.tt/academy/computer/chapter/computer
[d-pricing]: https://dust.tt/home/pricing
[d-cli]: https://docs.dust.tt/docs/developer-platform/dust-cli/dust-cli
[d-memory]: https://docs.dust.tt/docs/user-documentation/agents/tools/agent-memory
[d-skills]: https://docs.dust.tt/docs/user-documentation/agents/skills/skills-management
[d-schedules]: https://docs.dust.tt/docs/user-documentation/agents/triggers/schedules
[d-license]: https://github.com/dust-tt/dust/blob/main/LICENSE

## Viktor — 16 cells

| Feature | Value | Evidence and limits |
| --- | --- | --- |
| Run your local agents | ? | [API][v-api]/[MCP][v-mcp] expose hosted execution to callers, not verified local coding-agent dispatch. |
| Built-in team chat | Via Slack / Teams | [Chat][v-chat]: external team rooms. [Web app][v-web] also has personal chat; no absence claim about web chat. |
| Tasks for people & agents | Agent tasks | [Tasks][v-tasks]: agent/script jobs; human-assignee board unverified. |
| Require task approval | ? | [Approvals][v-approvals] are action permissions, not established task acceptance. |
| Shared files & folders | Chat files | [Files][v-files]: attachments/sandbox files, not verified room folders. |
| Public sharing links | Pages & apps | [Pages][v-pages]/[Spaces][v-spaces]: intentional public publishing; not whole workspace. |
| Hosted cloud agents | Yes | [API][v-api]: execution in key owner's workspace sandbox. |
| Free personal cloud computer | Starter credits | [Plans][v-plans]: one-time credits; work pauses when exhausted. |
| Work in your local folders | No | [Official comparison][v-local] explicitly distinguishes cloud sandbox from local laptop access; uploads do not qualify. |
| Team knowledge base | Skills | [Skills][v-skills]/[personalization][v-memory]: shared team facts/instructions, separate personal scope. |
| Memory across chats | Yes | [Personalization][v-memory]: stored preferences/shared team facts. |
| Saved instructions (Skills) | Yes | [Skills][v-skills]: personal/shared instruction files. |
| Previous file versions | Pages only | [Pages][v-pages]: ten previous versions with preview/restore; not general uploads. |
| Run tasks on a schedule | Yes | [Tasks][v-tasks]: recurring agent/script jobs, subject to credits/spending limits. |
| Apps & plugins | Native / connectors | [Integrations][v-integrations]: native and managed connector apps; unlike plugin catalog units. |
| Core license | Proprietary | [Terms][v-license]: proprietary service license; no MIT core established. |

[v-chat]: https://viktor.com/docs/talk-to-viktor
[v-web]: https://viktor.com/docs/viktor-web-app
[v-tasks]: https://viktor.com/docs/scheduled-tasks
[v-approvals]: https://viktor.com/docs/approvals
[v-files]: https://viktor.com/docs/files-and-email
[v-pages]: https://viktor.com/docs/hosted-pages
[v-spaces]: https://viktor.com/docs/spaces
[v-api]: https://viktor.com/docs/public-api
[v-mcp]: https://viktor.com/docs/mcp-server
[v-plans]: https://viktor.com/docs/plans-and-credits
[v-local]: https://viktor.com/blog/viktor-vs-claude-cowork
[v-skills]: https://viktor.com/docs/skills
[v-memory]: https://viktor.com/docs/personalize-viktor
[v-integrations]: https://viktor.com/integrations
[v-license]: https://viktor.com/legal/license-terms

## OpenHands — 16 cells

| Feature | Value | Evidence and limits |
| --- | --- | --- |
| Run your local agents | Yes | [ACP][o-acp]: launch installed coding runtimes locally; not attach to any running terminal. |
| Built-in team chat | ? | [Conversations][o-conversations] describes agent sessions, not verified native multi-human chat. |
| Tasks for people & agents | Agent tasks | [Conversations][o-conversations]/[automations][o-automations]: agent work; human-assignee board unverified. |
| Require task approval | ? | Tool permissions, Critic feedback, GitHub review do not establish internal task acceptance. |
| Shared files & folders | Workspace | [Conversations][o-conversations]: workspace tree, not shared team drive. |
| Public sharing links | Conversations | [Cloud API][o-sharing], [API source][o-source], [viewer][o-viewer]: public conversations accessible to anyone; organization automation access separately authenticated. Source evidence, not deployed-account smoke. |
| Hosted cloud agents | Yes | [Pricing][o-pricing]/[CloudWorkspace][o-cloud]: vendor sandboxes. |
| Free personal cloud computer | Free cloud tier | [Pricing][o-pricing]: free Individual tier, BYOK/at-cost models. Not proof of one persistent cross-agent computer; no daily allowance asserted. |
| Work in your local folders | Yes | [ACP][o-acp]/[process sandbox][o-local]: local workspace execution. |
| Team knowledge base | Skills | [Skills][o-skills]: repository/project/user instructions/reference files, not separate team knowledge service. |
| Memory across chats | SDK opt-in | [Memory][o-memory]: `load_memory=True`, off by default. |
| Saved instructions (Skills) | Yes | [Skills][o-skills]: reusable instructions/repository guidance. |
| Previous file versions | ? | Non-Git history/restore not established in reviewed workspace docs. |
| Run tasks on a schedule | Yes | [Automations][o-automations]: scheduled agent conversations. |
| Apps & plugins | Plugins / MCP | [Plugins][o-plugins]: plugin bundles/MCP; local catalog does not promise identical cloud catalog. |
| Core license | MIT | [LICENSE][o-license]: core, separate enterprise/hosted terms. |

[o-acp]: https://docs.openhands.dev/openhands/usage/agent-canvas/acp-agents
[o-conversations]: https://docs.openhands.dev/openhands/usage/agent-canvas/conversations
[o-automations]: https://docs.openhands.dev/openhands/usage/automations/overview
[o-sharing]: https://docs.openhands.dev/openhands/usage/cloud/api-reference/sharing/batch-get-shared-conversations
[o-source]: https://github.com/OpenHands/OpenHands/blob/5958302c1c5dbdc441cbb7d85dc650ffc4d606bd/src/api/cloud/shared-conversation-service.api.ts
[o-viewer]: https://github.com/OpenHands/OpenHands/blob/5958302c1c5dbdc441cbb7d85dc650ffc4d606bd/src/routes/shared-conversation.tsx
[o-pricing]: https://www.openhands.dev/pricing
[o-cloud]: https://github.com/OpenHands/software-agent-sdk/blob/main/openhands-workspace/openhands/workspace/cloud/workspace.py
[o-local]: https://docs.openhands.dev/openhands/usage/sandboxes/process
[o-skills]: https://docs.openhands.dev/overview/skills
[o-memory]: https://docs.openhands.dev/sdk/guides/persistent-memory
[o-plugins]: https://docs.openhands.dev/openhands/usage/agent-canvas/plugins
[o-license]: https://github.com/OpenHands/OpenHands/blob/main/LICENSE

## Remaining evidence limits

- Unknown cells stay unknown: Dust/Viktor local coding-agent dispatch;
  Multica/Paperclip anonymous sharing; Viktor/OpenHands task acceptance;
  OpenHands native team chat and non-Git file history.
- Dust's current memory help page says per-agent user memory; the previously
  reviewed `user_memory/metadata.ts` at `edc135fe` says shared across that user's
  agents. The table claims the tool, not either disputed sharing scope.
- Multica deliverable versions and OpenHands anonymous conversations have
  source evidence, without independent deployed-account acceptance.
- Failed legacy page fetches are not product limitations. Use current docs,
  public source, or an explicit unknown rather than inferring absence.
- Keep optional apps/plugins, configured gates, runtime restrictions, starter
  offers, and commercial license conditions visible in future updates.
