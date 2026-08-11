# Local Agent Install Guidance (Zero-Agent Onboarding) — MVP Brief

## Agent Context

- Purpose: Record the shipped zero-agent onboarding brief — CLI setup
  zero-agent prompt and public web install guide pages.
- Read this when: Changing the zero-agent setup prompt, install guide pages,
  or supported-agent install instructions.
- Update this when: The zero-agent flow, guide routes, or supported agent
  list changes.
- Do not use this for: Setup/readiness semantics (`developing/product/onboarding.md`)
  or CLI command boundaries (`developing/clients/cli.md`).
- Source of truth: This review file owns only the dated MVP implementation
  record below; owner documents own current behavior.

Status: IMPLEMENTED (2026-07-02); AMENDED FOR CURSOR ACP (2026-07-18). Remove
this review file when its durable rules are absorbed into the onboarding and
CLI owner documents.
Owner: Felix. Designed/reviewed by Claude Code (Control Tower). Executor: Codex.
Scope: CLI setup zero-agent prompt + public web install guide pages.

## 1. Problem

A brand-new user with **no supported local agent CLI installed** (no Codex,
Claude Code, Cursor CLI, or OpenCode) can complete `openmeld setup`, get an
account, join a Space — and then nothing works, with **zero explanation**.
Today the only
signal is a single progress line ("No supported local agents found. Setup
will continue without local agents.") and setup silently continues. There is
no confirmation, no pointer to how to install an agent CLI, and no page on
our site that explains it.

Goal (MVP): when zero agents are detected, (a) tell the user explicitly,
(b) ask for confirmation before continuing a mostly-useless setup, and
(c) point them to one canonical URL on our site that walks them through
installing each supported agent CLI. All clients (CLI, Web, Desktop) point
to the same URL.

## 2. Verified current facts (read these files first)

CLI setup & detection:
- Setup entry: `clients/openmeld-cli/src/commands/setup.ts` — `runSetup()` (~L68)
  → `runSetupUnlocked()` (~L84). Agent readiness collected ~L145-153,
  selection resolved ~L160-164 (`resolveSetupLocalAgentIds`, empty-array
  return ~L416-419), enable step skipped when zero selected (~L166-182).
  Setup **does not fail** on zero agents.
- Web-generated `curl | sh` path: `clients/openmeld-cli/src/commands/prepare-session-executor.ts`
  — zero-agent branch at ~L309-314 emits the progress line quoted above and
  returns `[]`; ~L233-237 completes immediately when zero selected.
- Interactive terminal plumbing (from commit 46d0d683d):
  `clients/openmeld-cli/src/ui/controlling-terminal.ts` —
  `resolveControllingTerminalSession()` (~L39) opens `/dev/tty` when stdin is
  piped (`curl | sh`); returns `null` on win32 / headless / CI. The existing
  agent multiselect (`resolveTerminalInteractiveLocalAgentSelection`,
  prepare-session-executor.ts ~L302-359) already has a **cancel path** that
  throws and tells the user to fetch a fresh setup command from OpenMeld Web —
  reuse it.
- Existing flags: `--local-agents all|none` and `--local-agent <id...>`
  (setup.ts ~L366-383). `--local-agents none` is the existing escape hatch.
- Detection SSOT: `config/agents/registry.json` (embedded; parsed by
  `clients/openmeld-cli/src/agents/registry-source.ts`). Active
  runtime-supported agents are `codex`, `claude-code`, `cursor`, and
  `opencode`; `openclaw` is `lifecycle.status: "suspended"`. Detection is
  provider-specific. Cursor requires the exact `cursor-agent` executable and
  checks `PATH`, `~/.local/bin/cursor-agent`, and
  `~/.cursor/bin/cursor-agent`; it must never accept the unrelated generic
  `agent` command. Other registry entries may still use provider config paths.
  The registry has no install-URL metadata today.
- Web-origin derivation already exists in the CLI:
  `clients/openmeld-cli/src/space/web-url.ts` `buildSpaceWebUrl()` maps the
  gateway baseUrl to the web origin (`gateway.openmeld.ai` → `openmeld.ai`,
  loopback `:8080` → `:3000`).

Web app:
- `clients/web` — TanStack Router file routes. Public-page precedents:
  `/` (landing) and `/desktop` (`components/desktop-download/desktop-download-page.tsx`
  — use this page as the layout template: `PublicPageHeader`, steps card,
  requirements card, CTA buttons).
- Agent logos exist for all five builtin agents:
  `packages/ui/src/components/local-agent-logo.tsx` (`builtin:claude-code`,
  `builtin:codex`, `builtin:cursor`, `builtin:opencode`,
  `builtin:openclaw`).
- Site origin SSOT: `clients/web/src/lib/site.ts` (`siteConfig.url`,
  default `https://openmeld.ai`).
- Local agents settings card: `clients/web/src/components/agents/agents-page-local-agents.tsx`
  (Settings → Computers), fed by `localAgentCatalog` entries with a
  `detected` boolean.
- Connect page: `clients/web/src/routes/app/connect.tsx` (+ helpers in
  `lib/connect/connect-route.ts`).

## 3. Design decisions (with rationale — do not silently deviate)

D1. **The CLI links to ONE stable URL on our own domain, never to vendor
    install pages directly.** CLI releases are expensive and irreversible
    (npm publish); vendor install URLs churn. All churn lives on the web
    side, which redeploys cheaply. The CLI hardcodes only the path
    `/guides/local-agents` on our own web origin.

D2. **Guide content lives in a static web-side module, NOT in
    `config/agents/registry.json`.** The registry is the detection/runtime
    SSOT consumed by the CLI; the web app never reads it, and adding vendor
    URLs there would couple marketing copy to CLI releases (violates D1).
    MVP does not touch registry.json at all.

D3. **Guide coverage set = runtime-supported AND lifecycle-active agents**:
    `codex`, `claude-code`, `cursor`, and `opencode`. `openclaw` is
    suspended — omit it (do not show "coming soon" pages).

D4. **Zero-agent confirmation is interactive-only and fail-open.** Headless /
    CI / no-tty flows must NEVER block on a prompt (same principle as the
    existing all-agents fallback). Explicit `--local-agents none` means the
    user already decided — no prompt.

D5. **Default answer is Continue (recommended).** Rationale: the rest of
    setup (service, account link, and Center Agent guidance) still has value;
    aborting strands a novice mid-`curl|sh` with a broken-feeling flow. The
    prompt's job is to inform + hand over the guide URL, not to gatekeep.
    Declining is supported and reuses the existing cancel path.

D6. **Web origin for the URL is derived from the configured gateway baseUrl**
    using the same mapping as `buildSpaceWebUrl` (extract the origin-mapping
    into a shared helper; do not duplicate the gateway→web rewrite rules).
    This keeps dev (`localhost:3000`) and prod (`openmeld.ai`) both correct.

## 4. Deliverables

### Batch 1 — Web: public install guide pages (deploy FIRST)

New static data module `clients/web/src/lib/local-agent-install-guides.ts`:
one record per covered agent, keyed by registry agent id (`codex`,
`claude-code`, `cursor`, `opencode`), fields: `displayName`, `logoAgentId`
(`builtin:<id>` for `LocalAgentLogo`), `summary` (one sentence),
`installSteps` (short ordered list incl. example install command),
`officialInstallUrl`, `officialDocsUrl` (optional), `verifyCommand`
(e.g. `claude --version`), `postInstallNote`.

New public routes (no auth, follow `/desktop` page structure +
`PublicPageHeader`):

1. `/guides/local-agents` (index):
   - Why you need an agent CLI: 2–3 sentences. OpenMeld connects agents that run
     ON YOUR computer; OpenMeld itself does not ship Codex, Claude Code,
     Cursor CLI, or OpenCode — you
     install the agent CLI once, then OpenMeld detects and transports it.
   - Card per covered agent (`LocalAgentLogo` + name + summary) linking to
     the detail page.
   - Footer CTA: "Already installed one? Re-run your setup command, or go to
     Connect" → `/app/connect`.
2. `/guides/local-agents/$agentId` (detail; unknown id → notFound):
   - What it is (1–2 sentences).
   - Install: our short steps + prominent external link to the official
     install page (`target="_blank" rel="noopener"`). **Verify the official
     URLs at implementation time** (candidates to verify, do not trust
     blindly: Codex CLI — developers.openai.com/codex; Claude Code —
     code.claude.com/docs or docs.anthropic.com claude-code; Cursor CLI —
     cursor.com/docs/cli; OpenCode — opencode.ai/docs).
   - **Critical must-include note**: explain the provider's actual detection
     and sign-in contract. Cursor detection requires `cursor-agent`, and
     Cursor CLI has a separate login from Cursor IDE; users must run
     `cursor-agent login`. For config-directory-based providers, run the CLI
     once and complete login so the expected directory exists.
   - Verify: the `verifyCommand`.
   - Next step: re-run the setup command from OpenMeld Web, or (already set up)
     Settings → Computers → "Check Local Agents".

Entry-point links (static, no new state):
- `agents-page-local-agents.tsx`: when the catalog is empty or every entry
  has `detected: false`, render a helper line linking to
  `/guides/local-agents`.
- `/app/connect` page: one persistent helper line ("No agent CLIs installed
  yet? See the install guide") linking to the same route.

### Batch 2 — CLI: zero-agent notice + confirmation (after Batch 1 is live)

1. New helper (suggested `clients/openmeld-cli/src/guides/local-agents-guide-url.ts`):
   `buildLocalAgentsGuideUrl(baseUrl): string` → `<webOrigin>/guides/local-agents`,
   reusing the extracted gateway→web origin mapping from `web-url.ts` (D6).
   Unit-test prod + loopback mappings.
2. Zero-agent behavior in BOTH entry paths (`setup.ts` direct path and
   `prepare-session-executor.ts` curl|sh path):

   | Situation (0 detected) | Behavior |
   |---|---|
   | Explicit `--local-agents none` | No prompt. Continue (unchanged). |
   | Explicit `--local-agent <id>` / `--local-agents all` | Keep existing behavior; append guide URL to the resulting message. |
   | Interactive terminal available (TTY stdio or `/dev/tty`) | Print notice block: no supported agent CLI detected + covered-agent names + guide URL, then confirm: `Continue setting up the OpenMeld service without any local agents? [Y/n]`. Yes/Enter → continue exactly as today. No → abort via the EXISTING cancel path (same error + "install an agent, then re-run the setup command from OpenMeld Web" guidance), and print the guide URL again. |
   | No terminal (headless/CI/win32 fallback) | NEVER prompt. Print warning + guide URL, continue (fail-open, unchanged flow). |

3. Setup-complete summary (human view, `emitSetupComplete` in setup.ts):
   when `selectedLocalAgentIds` is empty, the "Agents" card says no local
   agents are connected and shows the guide URL (hyperlinked via the existing
   `formatTerminalHyperlink`). **Agent view: no new fields** — consumers can
   already infer from `selectedLocalAgentIds: []`. Do not touch the
   `packages/schemas` CLI json-output envelopes in this MVP.

### Batch 3 (optional follow-up, not MVP-blocking)
- Desktop GUI: `AgentsView` empty state (all `detected: false` or empty)
  renders the same message + button opening the guide URL via
  `shell.openExternal`.
- Consider `installDocsUrl` metadata in registry.json only if a future
  consumer needs it programmatically (D2 says not now).

## 5. Red lines / gotchas for the executor

- **Do NOT touch the `/setup` script endpoint, `/v1/prepare/*` wire paths,
  `x-openmeld-prepare-token`, or `openMeldDaemon_prepare_*`** — load-bearing for published
  CLIs.
- **No new required fields on any shared strictObject wire schema.** The
  confirm prompt is purely CLI-local. If a new prepare progress line is
  needed, reuse the existing `state`/`text` shape.
- Keep builtin brand IDs and supported-controller unions aligned with the
  shared schemas and registry instead of preserving stale fixed-size lists.
- openmeld-cli test gate: `pnpm test:integration` (plain `test -- <file>` excludes
  integration specs and is a false green) + `tsc` 0 errors.
- Run `pnpm exec ultracite fix` before committing.
- Deploy order: **web first** (URL live), then CLI version bump + release
  with `updatePolicy: available` (NOT required).
- Copy tone: plain English, novice-friendly, no internal jargon
  ("controller", "wake route", "lease" must not appear in guide copy).

## 6. Acceptance (per repo hard rule + production smoke)

Owner-doc question (MANDATORY in delivery): "Does this change violate any
rule in the owner documents under `developing/architecture/`?" Expected
answer: No — no liveness/availability/Wake-routing semantics change; the
zero-agent confirm only gates whether setup proceeds, before any service
lifecycle state is created. State the answer explicitly with reasoning.

Production smoke (real user behavior, not unit tests):
1. Simulated clean machine (temporarily move `~/.claude`, `~/.codex`,
   `~/.config/opencode` aside): run the Web-generated `curl | sh` setup →
   notice block + confirm appear; Enter continues; setup completes; summary
   shows the guide URL.
2. Same, answer `n` → abort message + guide URL; the Web connect page ends in
   its existing cancelled/retry state (must not spin forever).
3. Headless run (stdin from /dev/null, no controlling tty) → no prompt,
   warning + URL printed, setup completes.
4. `--local-agents none` on a clean machine → no prompt.
5. Regression: machine WITH agents detected → flow byte-identical to today
   (no new prompt).
6. Prod web: `/guides/local-agents` + 4 detail pages render; official links
   verified manually; links from Settings → Computers empty state and
   `/app/connect` navigate correctly.
