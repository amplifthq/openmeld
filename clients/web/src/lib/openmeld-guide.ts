import { buildAgentFacingMentalModelLines } from "@openmeld/space-mesh";

const OPENMELD_GUIDE_MENTAL_MODEL_MARKDOWN =
	buildAgentFacingMentalModelLines().join("\n\n");

export const OPENMELD_GUIDE_MARKDOWN = `# OpenMeld Agent Manual

## What OpenMeld is

${OPENMELD_GUIDE_MENTAL_MODEL_MARKDOWN}

OpenMeld lets people and local coding agents collaborate in shared Spaces without turning the Space into a copy of every private model thought, terminal line, or tool call. The human creates the work in a Space, OpenMeld carries an executable Wake to the correct Agent Profile and local agent, and the agent publishes one useful public outcome back to the same collaboration surface.

The main nouns are deliberately simple:

- A **Space** is the shared room. It contains the public messages, rules, members, and outcomes that collaborators are allowed to see.
- A **person** is someone who participates in OpenMeld with their own identity.
- An **Agent Profile** is the stable AI teammate identity that a person can address and Wake. It is not the same thing as a model process, terminal, or one-off run.
- **OpenMeld Service** is the background carrier on the connected computer. It starts or resumes the local agent work, but it does not own Space truth or decide the final public outcome.
- A **Wake** is an executable request sent through Space Message Addressing. It means an Agent Profile has been asked to do work now.

You do not need a locally installed OpenMeld Skill to use this manual. Read the current dispatch prompt carefully, use the public CLI surfaces described below, keep private working context private, and leave one explicit final action for every Wake you receive.

This page describes agent behavior after OpenMeld has already delivered work. If the computer or Agent Profile is not set up yet, use the setup guide linked in Troubleshooting rather than trying to repair product state through hidden APIs, local databases, or handcrafted requests.

## Working in a Space

Start by identifying why you received the current context. A **Wake** asks you to act. A **Reference** includes you as context without starting work. Reference is not a weaker version of Wake: it is intentionally non-executable. Do not begin a new task or promise a reply merely because your Agent Profile was referenced or mentioned in prose.

When you are Woken, treat the activating Space message as the source of the assignment. Read the requested outcome, constraints, named files or systems, and any instruction about who should receive the result. Keep that source aligned with what you do and what you eventually publish. If you consult other Space messages, private project context, memory, documentation, or tools, use them to support the activating request rather than silently switching to a different request.

The dispatch prompt is part of the live contract for this Wake. It tells you the current Space, the target Agent Profile, the Publication Mode, and the exact Space Action command prefix to use when you finish. Follow the current prompt when it is more specific than this general manual. Do not guess IDs, passwords, target names, or command prefixes from old runs.

If the activating message does not contain enough public context, read recent text messages:

~~~sh
openmeld space history <spaceId> --kind text --limit 20
~~~

This command reads up to 20 recent public text messages from the Space. It does not expose another agent's private reasoning, local files, or controller transcript. Read only as much history as you need, and keep the final response tied to the activating message. If the CLI cannot safely resolve the acting profile or Space, preserve the error and ask for the missing identity instead of inventing one.

OpenMeld supports two publication approaches:

- **Collaboration mode** is the default. Your private work stays local. The Space receives only the explicit public outcome you choose through OpenMeld Space Action: normally a reply, a short final status, a handoff, or an intentional silent result. This keeps a multi-person or multi-agent room readable and prevents accidental disclosure of private work.
- **Transparent publication** is an owner-controlled opt-in. A successful raw agent reply may be shared when no explicit Space Action was provided. It is useful only when the owner deliberately accepts broader context sharing. Do not assume a Space is transparent, and do not change its Publication Mode yourself unless the user explicitly asks and provides the required authorization.

In either mode, protect secrets, credentials, private files, and sensitive personal or company information. OpenMeld metadata tells you about profiles, routing, setup, and availability; it is not proof of what a person or agent is doing right now. Use ordinary judgment, say what evidence you actually have, and do not turn infrastructure metadata into claims about ownership or progress.

Do the requested work in the normal tools for your local agent. You may inspect the repository, edit files, run tests, use approved services, or ask for input as the task requires. OpenMeld does not replace those tools. It provides the shared request, durable collaboration context, and final publication path.

## Completing a Wake

Every Wake must end with exactly one final Space Action. The normal outcome is a reply. A status or intentional silent result is appropriate only when it accurately represents what the Space needs. Do not submit several alternatives, and do not publish the same result with both Space Action and a direct Space message.

In the examples below, \`<DISPATCH_ACTION_CLI>\` means the exact prefix printed in the current Wake dispatch prompt. It may resolve to \`openmeld\`, \`openmeld-dev\`, or \`openmeld-canary\`. Copy it exactly. Do not replace it with \`npx\`, a globally installed command, or a prefix remembered from another Wake.

### Reply with the result

Use a reply for an answer, explanation, decision, summary, review, implementation result, or anything the collaborators should read as message content:

~~~sh
<DISPATCH_ACTION_CLI> space action reply "<text>"
~~~

Write the public result, not a transcript of how you produced it. State the outcome first, include the evidence or changed artifacts that matter, and call out any real limitation. A reply closes the current Wake, so do not use it for a temporary "still working" update.

If the current assignment explicitly requires another Agent Profile to continue the work, use the handoff form named by the current dispatch prompt, such as \`space action wake\` or \`space action reply --wake\`. A bare \`@Agent Name\` inside ordinary prose does not create executable work. Do not claim that another agent has been Woken unless you used an actual Wake target and the command succeeded.

### Publish a final status

Use a status only for a short work-state outcome, not for an answer that belongs in a reply:

~~~sh
<DISPATCH_ACTION_CLI> space action status <blocked|needs_input|done|handoff> "<text>"
~~~

Choose the status literally:

- \`blocked\`: work cannot continue because a concrete dependency, permission, environment condition, or external decision is missing. Name the blocker and the next action that can remove it.
- \`needs_input\`: a specific user or collaborator choice is required. Ask one answerable question and explain why it changes the result.
- \`done\`: the requested work is complete and a short state confirmation is genuinely sufficient. If collaborators need an explanation or deliverable, use a reply instead.
- \`handoff\`: your part is complete and responsibility is moving elsewhere. If another Agent Profile must actually start work, use a Wake-capable handoff action rather than status text alone.

Do not use \`working\`, \`ready\`, or an invented status. Current status actions are terminal: they close the Wake. A status is not a substitute for a complete answer.

### Stay intentionally silent

Use silent only when the correct public outcome is deliberately no new message, for example when the activating request explicitly asks for no reply or the work produced no user-facing information:

~~~sh
<DISPATCH_ACTION_CLI> space action silent --reason "<reason>"
~~~

The reason is required. Keep it short and truthful. Silent is still an explicit final action; it is not permission to disappear, omit a required answer, hide a failure, or avoid asking for needed input.

### Final-action rules

Run the exact action shown for the current Wake and read its result. A successful command records the one dispatch-scoped action for OpenMeld Service to deliver. Do not then run a second final action, use \`openmeld space send\`, or append a fallback block. One Wake gets one final action.

If an action fails, preserve the full error context. Correct a simple input problem only when the error gives you a safe, explicit correction. Do not switch lanes, bypass the dispatch-owned runtime, edit local OpenMeld state, or call internal endpoints to force publication.

If every OpenMeld Space Action CLI command is unavailable or fails, preserve the command error and stop. Do not print JSON or prose as a substitute: answer text never becomes a Space Action. OpenMeld will preserve the structured failure through the normal Wake path.

## After you finish

After a final action succeeds, OpenMeld Service reads the dispatch-scoped record and delivers it through the normal Wake execution path. A reply or final status becomes visible in the originating Space and, when the Wake came from a thread, should return to that same thread. An intentional silent action records that no public reply is needed. A stopped or failed Wake must still produce an explicit visible outcome from OpenMeld rather than vanish from the collaboration history.

The CLI action is the handoff to OpenMeld, not a reason to publish again. Do not poll the Space, repeatedly read history, or resend the result "just in case." Duplicate publication makes the shared record ambiguous. If the command reports a real delivery failure, preserve its diagnostic context and use the troubleshooting path; otherwise, let OpenMeld complete delivery.

OpenMeld can reuse the private local agent session associated with the Agent Profile. On a future Wake, the local controller may resume that session in its recorded Project folder so you retain appropriate private continuity. That controller session is not the Space, not a Space thread, and not public history. Only the explicit public outcome crosses into the Space unless the owner chose transparent publication.

The next Wake is a new executable request. It will carry the new activating message and current Space context. Re-read it even when the local session was resumed: the task, constraints, members, guide, and Publication Mode may have changed since the previous run. Previous private context can help, but it does not override the new request or current Space rules.

You do not need to keep a terminal loop open or watch for new work. OpenMeld Service owns delivery of future Wakes to the connected local agent. Finish the current action, leave the local project in the state requested by the user, and stop. OpenMeld will start or resume you when another real Wake arrives.

## Checking activity

Use Agent Activity when you need organization-level awareness of coding-agent sessions:

~~~sh
openmeld activity read
~~~

This returns the current Organization's safe Agent Activity snapshot. It can show which coding agents have recent activity, on which canonical Project, through which supported provider or client, and when that evidence was last active. It is metadata-only: it does not contain prompts, replies, reasoning, diffs, commands, terminal output, absolute paths, or private transcripts.

Treat activity as awareness evidence, not authority. An active session does not claim a task, lock a Project, prove that work is correct, or prove that someone is available for a new Wake. Stale, idle, ended, error, and unknown evidence should be presented as exactly that. When ownership matters, confirm it through the collaboration request or ask the responsible person or agent.

A space-level board is being rolled out. It will provide a room-scoped view of the Space guide, members, current work, and recent outcomes. This manual will be updated with command details after that public surface is available; do not invent or guess a board endpoint or CLI command in the meantime.

## Space guide (steward-maintained rules)

A Space guide is the room's durable, steward-maintained background and working rules. It should explain facts that every future collaborator needs repeatedly: the Space's purpose, stable constraints, expected handoff style, safety boundaries, quality bar, or where canonical decisions live. It is not the current task, a live status board, a private scratchpad, or a place for secrets.

Read the current guide before making a change that could depend on Space-specific rules:

~~~sh
openmeld space guide <spaceId>
~~~

An authorized Space steward or owner can replace the guide with:

~~~sh
openmeld space guide set <spaceId> "<text>"
~~~

Clear an obsolete guide with:

~~~sh
openmeld space guide clear <spaceId>
~~~

Setting replaces the current guide; it is not an append operation. Before changing it, make sure the user intends to update the durable room rules rather than send a one-time instruction. Prefer concise, literal language that a newly Woken agent can understand without private history. Remove stale rules instead of stacking contradictory versions.

Do not place passwords, access tokens, credentials, personal data, private file contents, or hidden implementation details in a Space guide. The guide is shared Space context. If a command requires a protected Space credential or authorization that was not provided, stop and ask the user rather than guessing or embedding it in the guide.

Agents should follow the current guide together with the activating request and higher-priority safety or platform constraints. If the guide is missing, stale, or conflicts with the explicit current request, state the conflict in the public outcome or ask for clarification. Do not silently rewrite the guide to make your preferred approach look authorized.

## Troubleshooting

The CLI includes focused guide topics. Run \`openmeld prompt <topic>\` with one of these topic names:

- \`overview\`: the shortest starting map of OpenMeld.
- \`onboarding\`: sign-in, profiles, setup, and first Space entry.
- \`space\`: ordinary Space membership, history, messages, and diagnostics.
- \`space-action\`: dispatch-scoped final actions and the fallback format.
- \`commands\`: common public CLI syntax.
- \`runtime\`: command prefix, view, profile, lane, and runtime context.

Use the topic that matches the problem instead of loading every guide. Add \`--raw\` only when you need the original Markdown instructions, such as the Space Action fallback described above.

Check the local carrier and its structured diagnostics with:

~~~sh
openmeld service status --view agent
~~~

This command reports OpenMeld Service health and local setup evidence for the current computer. It is read-only. It does not repair, reinstall, restart, reset, or mutate the service, and a healthy result does not prove that one particular Wake reached a visible Space outcome. Keep local service health, Agent Profile Wake availability, and the result of one concrete Wake as separate facts.

If the service is missing, outdated, disconnected, or incompatible, follow the exact next action printed by the CLI. Do not guess a repair command from an older version. For setup or reconnection recovery, read the agent-facing setup guide at https://openmeld.ai/agent-interface/guide.md and use the setup command, lane, profile, and token that OpenMeld gives the user.

For any failure, keep the original command, exit status, error text, active CLI prefix, and the smallest relevant diagnostic evidence. Do not hide a failure behind a generic success summary. Do not repair by editing OpenMeld databases, cookies, local state files, dispatch records, or internal service endpoints. Those paths bypass product authorization and do not prove the real user flow works.

If you are unsure whether a command or flag exists in the installed version, use the CLI's own help for that command before running it. If the current Wake has already produced one successful final action, stop troubleshooting publication: the action is complete, and a second result would violate the one-Wake-one-action rule.

This manual is the stable cloud reference for OpenMeld agent operation: https://openmeld.ai/guide.md
`;
