# Local Agent Directory Access Controls Research

## Agent Context

- Purpose: Preserve the dated controller-capability research that informed the
  approved Computer file-access boundary.
- Read this when: Evaluating provider enforcement capabilities or implementing
  the settled Computer file-access contract.
- Update this when: Dated capability evidence needs correction before the
  feature ships; contract changes belong in the owner documents instead.
- Do not use this for: Current production behavior, implementation status, or
  authoritative product and architecture requirements.
- Source of truth: This file is research evidence only;
  `developing/decisions.md` and the linked owner documents are authoritative.

Date: 2026-08-10

Status: DECISION INCORPORATED — the product and architecture direction is now
recorded in the owner documents. This file makes no production change.

Remove when: The Computer file-access boundary ships and any enduring provider
capability guidance has been incorporated into its owner documents.

## Question

OpenMeld can start, continue, repair, or recover a Local Agent execution on a
member's Computer. The Computer owner needs an optional policy that either:

- allows OpenMeld-started Local Agent work only in selected folders; or
- blocks OpenMeld-started Local Agent work in selected folders.

The policy must not pretend that a prompt is a security boundary, silently run
without protection, or unnecessarily make an otherwise useful Agent Profile
permanently unavailable.

## Confirmed Product Scope

- The policy applies only to Local Agent executions started, continued,
  repaired, or recovered by OpenMeld, including their child processes.
- It does not govern the owner's direct use of Codex, Claude Code, Cursor,
  OpenCode, or OpenClaw outside OpenMeld.
- OpenMeld Service owner-triggered Project discovery, Agent Activity
  observation, and diagnostics remain under their own privacy contracts.
- The policy belongs to one Computer and applies to every Organization, Agent
  Profile, Project, Space, and requester using that Computer.
- Absolute local paths remain device-local. They must not become Project or
  Agent Profile cloud identity and must not be uploaded in activity or
  diagnostics.
- Projects can suggest convenient folders to select, but a Project is not the
  authority for the Computer policy.

This agrees with the existing model: a Project never contains an absolute local
path, while a Local Project Connection and Working Folder are device-local
execution facts (`developing/product/projects.md`). Agent Controller Permission
Mode also remains a controller-native Binding setting, not a generic OpenMeld
permission policy (`developing/product/agent-profiles.md`).

## Enforcement Conclusion

OpenMeld Service should not attempt to inspect or approve every file read and
write. It cannot reliably observe all controller tools, shell processes, MCP
servers, plugins, browser automation, or future provider capabilities.

The clean split is:

1. The Computer owns the human policy.
2. OpenMeld Service is the local admission point. Before every start, continue,
   repair, and recovery path, it resolves the effective policy and verifies the
   selected controller's capability.
3. A provider adapter compiles the policy into the controller's official
   sandbox, permissions, or supported isolated runtime.
4. The controller's OS sandbox, container, or native tool permission layer
   performs the actual enforcement.
5. OpenMeld records whether enforcement was verified for this execution, but
   does not become a second filesystem monitor.

The Service therefore remains the trust boundary and execution carrier defined
by `developing/architecture/local-openmeld-service.md`, while enforcement stays
with the system that can actually constrain the process.

OpenMeld should also inject a provider-neutral instruction so the model
understands the experience:

> This OpenMeld run is restricted by the Computer owner's file-access policy.
> Treat denied access as intentional. Do not try to bypass it or ask the
> requester to broaden it. Only the Computer owner can approve an exception.

That instruction improves explanations and reduces repeated attempts. It is
not part of the security guarantee. Exact protected paths should remain in
local provider configuration rather than being copied into cloud prompts.

## Official Controller Capability Matrix

### Codex

Codex is the strongest direct fit. Beta Permission Profiles in Codex 0.138 and
later support path rules with `read`, `write`, and `deny`; narrower rules can
override broader rules. OpenAI documents a workspace-only profile that denies
the filesystem root, keeps the minimum runtime paths readable, and grants the
workspace roots access. The App Server can discover profiles and pass a named
profile to a thread.

This is actual OS sandbox enforcement: Seatbelt on macOS and a Linux sandbox
using bubblewrap and seccomp/Landlock. Current source and regression tests also
canonicalize paths and cover symlink aliases. Legacy `workspace-write` alone is
not a strict read allowlist because it normally leaves broad read access.

OpenMeld's current Codex adapter still maps its permission modes to the legacy
`read-only`, `workspace-write`, and `danger-full-access` sandbox values. It does
not yet compile the proposed Computer policy into a Permission Profile or
restricted readable roots.

Sources: [Codex Permission Profiles](https://learn.chatgpt.com/docs/permissions),
[Codex App Server](https://developers.openai.com/codex/app-server), and
[Codex sandbox security](https://learn.chatgpt.com/docs/agent-approvals-security).

### Claude Code

Claude Code can provide a strong boundary by combining two official layers:

- `Read` and `Edit` permission rules for built-in file tools; and
- the Bash sandbox's `allowRead`, `denyRead`, `allowWrite`, and `denyWrite`
  rules for shell commands and their child processes.

A strict OpenMeld run must enable the sandbox, fail if it is unavailable,
disallow unsandboxed commands, and prevent user or project settings from
silently weakening the run. Native Windows is not supported by this sandbox;
WSL2 is supported. MCP and Computer Use remain separate capabilities and must
be independently disabled or constrained when OpenMeld promises a strict file
boundary.

OpenMeld's current Claude SDK adapter passes a working directory, additional
directories, permission mode, and normal user/project/local setting sources.
It does not yet supply a trusted strict sandbox configuration.

Sources: [Claude Code permissions](https://code.claude.com/docs/en/permissions),
[Claude Code sandboxing](https://code.claude.com/docs/en/sandboxing), and
[Claude Agent SDK permissions](https://code.claude.com/docs/en/agent-sdk/permissions).

### Cursor CLI

Cursor exposes official `Read(pathOrGlob)` and `Write(pathOrGlob)` permission
rules and an OS sandbox for shell child processes. Its documented sandbox is
strong for writes and network access. However, the public contract does not
currently establish a strict workspace-only read allowlist or fully document
symlink behavior for read rules.

A local test of Cursor CLI `2026.08.04-aaa8809` reinforced this limitation:
out-of-workspace writes were denied, but ordinary and symlinked reads outside
the workspace succeeded. This test is implementation evidence, not a public
guarantee. OpenMeld should not label Cursor as strict read-isolated until an
official capability and a local preflight prove it.

Sources: [Cursor CLI permissions](https://cursor.com/docs/cli/reference/permissions),
[Cursor sandbox parameters](https://cursor.com/docs/cli/reference/parameters#sandbox),
and [Cursor Agent Sandboxing](https://cursor.com/blog/agent-sandboxing).

### OpenCode

OpenCode has real built-in permission gates for `read`, `edit`,
`external_directory`, and `bash`. OpenMeld already passes OpenCode's official
permission JSON without translating it into another controller's modes.

OpenCode does not provide an OS process sandbox. Its shell tool scans some
static path arguments and then starts a host shell; dynamic paths, child
processes, and shell network access do not inherit a complete directory
boundary. With shell enabled, OpenCode cannot prove the proposed strict policy.
OpenMeld would need to disable shell or run OpenCode inside a separately managed
container or OS sandbox.

Sources: [OpenCode permissions](https://opencode.ai/docs/permissions) and
[OpenCode V2 permission boundaries](https://opencode.ai/v2/docs/permissions).

### OpenClaw

OpenClaw can provide a strong boundary when its sandbox is explicitly enabled
for all work. Docker or another supported sandbox backend can use read-only or
read-write workspace access plus validated bind mounts for selected folders.
The boundary covers file tools, commands, and child processes; network is off by
default. Elevated execution, plugins, and MCP still require separate policy.

The limitation is configuration scope: OpenMeld's current gateway call does
not pass a per-run sandbox policy. Strict support therefore requires the bound
OpenClaw agent to already match the Computer policy, or a dedicated OpenMeld
OpenClaw agent/configuration. The installed local OpenClaw version must be
checked independently from the newer documented behavior before OpenMeld
attests support.

Sources: [OpenClaw sandboxing](https://docs.openclaw.ai/sandboxing),
[sandbox, tool policy, and elevated mode](https://docs.openclaw.ai/gateway/sandbox-vs-tool-policy-vs-elevated),
and [OpenClaw security](https://docs.openclaw.ai/gateway/security).

## Proposed Product Behavior When Enforcement Is Not Available

The policy should be off by default for existing users. Enabling a strict
policy must not silently preserve unprotected behavior, but one unsupported
controller also must not make the Computer or Agent Profile permanently
unavailable.

For each execution, OpenMeld should derive one of these local outcomes:

- **Protected**: the exact policy is active through a verified native or OS
  boundary. Start automatically.
- **Needs setup**: the controller supports the boundary, but the installed
  version, platform, or configuration cannot apply it yet. Hold this Wake and
  give the owner one repair action.
- **Owner approval required**: OpenMeld cannot prove the boundary for this
  controller or tool surface. Hold only this Wake and ask the Computer owner
  whether to run this request once without the folder boundary, switch or
  update the controller, or cancel.

A one-time exception should be bound to the exact task, dispatch, controller,
and Computer; expire immediately; and never become a saved grant. Other
Organization members cannot approve it. Audit records can retain policy and
decision identifiers without uploading absolute paths.

This is deliberately different from both blanket rejection and warning-only
execution. A strict setting remains truthful, while the Computer owner retains
an explicit escape hatch for a valuable request.

Changes affect future executions and future turns. OpenMeld cannot safely add a
sandbox around a process that is already running; the UI should offer **Stop
now** when a new policy conflicts with active work.

## Required Architecture Seam

The enforcement check must be one shared local execution-admission contract,
called by every start, continue, repair, and recovery path before provider
dispatch. The contract returns the effective policy revision, enforcement
capability, compiled provider policy, and admission outcome.

Placing this only in the shared process spawn helper is insufficient. Claude's
SDK and OpenClaw do not use the same spawn path, and recovery currently has a
separate controller resume path. Provider adapters should consume the shared
admission result rather than independently resolving product policy.

The contract must treat shell, MCP, plugins, Computer Use, and any provider
escape mechanism as part of capability attestation. A file-tool rule alone is
not enough to claim the whole OpenMeld run is protected.

## Product Placement And Naming

Recommended first-level placement:

```text
Computers
  <Computer>
    File access for OpenMeld runs
      Unrestricted
      Only selected folders
      Block selected folders
```

Only the Computer owner can edit it. Agent Profile and Project surfaces may
show the effective status and link back to the Computer setting, but must not
store competing overrides in the first version.

The promise must say **OpenMeld runs**, not “your local agents” or “this
Computer.” Direct controller use, Service discovery, Agent Activity, MCP,
plugins, and browser tools are not automatically covered by a filesystem policy.

## Skills Used To Challenge The Design

The installed Matt Pocock skills were useful as a sequence rather than as an
implementation shortcut:

- `research` forced verification against current official controller docs,
  source, installed versions, and OpenMeld's actual adapter code;
- `grilling` separated factual capability questions from the three product
  decisions that require owner judgment; and
- `domain-modeling` exposed the overloaded word “global” and kept Computer
  policy, Project identity, Binding permission mode, and per-Wake admission as
  four distinct concepts.

If this product direction is confirmed, `to-spec` is the useful next skill.
`tdd`, `implement`, and `code-review` belong after the contract and product
behavior are settled, not before.
