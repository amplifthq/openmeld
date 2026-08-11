# Give OpenMeld Tools one clear update action

Written against: `d04540aec7a9418272d4a1e80f51157914605ac1`

## Evidence chain

- Surface: the authenticated Computer detail page, rendered by `clients/web/src/components/agents/agents-page-openmeld-service.tsx::CurrentLocalRuntimeServiceFacts`.
- Problem: the card currently presents `Update OpenMeld Service` as a card-level action while presenting `Update OpenMeld CLI` and `Update OpenMeld skills` inside otherwise parallel component columns. A new user has to understand the internal difference between CLI, Service, and skill before choosing an action.
- Problem: the card-level status is Service-specific (`OpenMeld Service is connected`) even when the action and warning are about the broader OpenMeld Tools installation. This creates a mixed message when the Service is connected but another component needs an update.
- Runtime evidence: `CurrentLocalRuntimeServiceFacts` already receives the canonical Core `localComponents` projection for Service, CLI, and skills. `clients/web/src/lib/openmeld-tools-update.ts` already treats an actionable update in any of those components as one OpenMeld Tools update. No second browser-owned update source is required.
- Workflow evidence: the Web macOS setup bootstrap resolves the current release manifest, reuses a byte-identical signed managed CLI when possible, otherwise downloads and verifies the release archive, installs the managed CLI, updates an older global `openmeld` command when needed, and then runs setup to align the local Service and managed skills. The current `Update OpenMeld Service` path therefore already does more than update only the Service.
- CLI-only evidence: the current CLI action runs `openmeld upgrade --yes`; its user-facing description says OpenMeld updates the CLI and checks local Service alignment. The two visible actions overlap rather than representing independent user goals.
- Product evidence: `developing/product/product-model.md` says the user should experience one reliable loop rather than unrelated setup, service, routing, and diagnostic systems. `developing/product/experience-principles.md` requires one current outcome and exactly one recommended next action instead of parallel choices.
- Contract evidence: `developing/clients/web.md` makes Core's local component projection the single update truth and requires one primary action per scenario. `developing/architecture/local-openmeld-service.md` says Service and skill alignment flow through setup rather than separate user-facing state chains.
- Owner: Core owns component update facts; Web owns this card's aggregate presentation and action selection; CLI/setup owns the actual alignment work.
- Scope and affected surfaces: the OpenMeld Tools card on Computer detail, its component tests, and the Web owner documentation for this aggregate card. Other Service-specific recovery surfaces keep their existing component-specific labels.
- Uncertainty: none in the desired user outcome. The implementation must still preserve the current distinct destinations under one visible action: Web setup for full alignment and a command dialog for a CLI-only advisory.

## Design decision

Turn the top section into the status and action owner for the whole **OpenMeld Tools** card. Show exactly one top-right action, named **Update OpenMeld Tools**, whenever any installed OpenMeld component has an actionable update. Keep the three component columns as equal, read-only detail: they explain which component is current or behind, but they do not ask the user to choose an upgrade mechanism.

Use these aggregate states and actions:

1. While setup completion is being confirmed, show **Checking OpenMeld Tools** and no action.
2. When Core reports a required Service update, show **OpenMeld Tools need an update** and enter the existing Service-update setup flow. This must take priority over a stale disconnected presentation because reconnecting an incompatible Service cannot restore readiness.
3. Otherwise, when the Service is missing or disconnected, keep the specific recovery action **Connect OpenMeld Service** or **Reconnect OpenMeld Service**. This is connectivity recovery, not an update.
4. When Service or skills alignment is otherwise actionable, show **OpenMeld Tools need an update** for a required update or **OpenMeld Tools update available** for an advisory update. The single **Update OpenMeld Tools** action enters the existing Web setup/alignment flow. That flow also aligns an older CLI, so a combined Service/CLI/skills update remains one operation.
5. When only the CLI advisory is actionable, show **OpenMeld Tools update available**. The same **Update OpenMeld Tools** label opens the existing command dialog with `openmeld upgrade --yes`.
6. When no component needs action, show **OpenMeld Tools are ready** and no action.

The top status may summarize the card because the card represents one user outcome: whether OpenMeld Tools on this computer are ready and current. The component columns remain the precise diagnostic path required by the experience principles.

## Reuse

- `clients/web/src/lib/openmeld-tools-update.ts`: retain the canonical actionable-update predicates over the Core projection.
- `clients/web/src/components/agents/agents-page-openmeld-service.tsx::OpenMeldToolsCommandDialogAction`: reuse the existing command, copy, and manual-fallback behavior for the CLI-only case.
- Existing Connect/setup routes: retain `setupPath` and `serviceUpdatePath`; do not add a browser-executed local command or a second update workflow.
- Existing `Button`, `Link`, `Dialog`, tone helpers, and component detail grid: preserve the current primitives and responsive layout.
- Existing Core `localComponents` projection: do not reconstruct component freshness from version strings in Web.

## Changes

1. `clients/web/src/components/agents/agents-page-openmeld-service.tsx`
   - Replace the Service-only `CurrentLocalRuntimeServiceDisplay` with an OpenMeld Tools card display that resolves one aggregate status, description, tone, and optional primary action from Service connectivity plus the canonical Service/CLI/skills projections.
   - Represent the primary action as an explicit discriminated union (`link` or `command`) instead of separate label/path fields. This lets the one top-right control route to Web setup for alignment or reuse the command dialog for a CLI-only advisory without implicit branching in JSX.
   - Apply action precedence explicitly: confirmation in progress; confirmed required Service update; Service connect/reconnect; other required Service or skills alignment; available Service or skills alignment; CLI-only update; healthy/no action.
   - Use the native English labels in the design decision. Keep failure descriptions precise and preserve the existing diagnostic context.
   - Preserve Service connectivity truth separately from update truth. A connected Service may coexist with an aggregate update advisory, but the card must not imply that connected means every tool is current.

2. `clients/web/src/components/agents/agents-page-openmeld-service.tsx`
   - Remove `action` from the Service/CLI/skill detail-item model and stop rendering component-level action controls.
   - Keep the three columns equal in structure: component label, installed/current value, latest or status description, and existing skill help disclosure.
   - Preserve per-component tones so the user can see exactly which component caused the aggregate action.

3. `clients/web/src/components/agents/agents-page-openmeld-service.test.tsx`
   - Add behavior coverage for Service-only, CLI-only, skills-only, combined, required, available, disconnected, confirming, and fully healthy states.
   - Assert there is never more than one visible primary action in the OpenMeld Tools card.
   - Assert Service/skills or combined updates use **Update OpenMeld Tools** and the existing Web alignment route.
   - Assert a CLI-only update uses the same visible label but opens the existing dialog with `openmeld upgrade --yes`.
   - Assert component columns retain exact status/version detail and no longer contain their own update buttons.
   - Preserve existing coverage for required-update confirmation, connection recovery, command copying, lane-specific commands, and healthy version display.

4. `developing/clients/web.md`
   - Document **Update OpenMeld Tools** as the aggregate Computer-detail-card action when one or more local components need alignment.
   - Preserve **Update OpenMeld Service** on Service-specific setup, Space, Agent Profile, and recovery surfaces. This is a scoped aggregate label, not a repository-wide rename.
   - Record the action routing rule: Web setup for Service/skills or combined alignment; command dialog for a CLI-only advisory; one visible action in either case.

## Scope

- Inherit: desktop and narrow/mobile layouts of the same Computer detail card receive the single-action model together.
- Verify: healthy; checking; Service disconnected; Service update available/required; CLI update available/required; skills update available/required; and every combined update state.
- Exclude: local component schemas, Core update calculation, CLI upgrade behavior, setup implementation, Service lifecycle, local controller update actions, Agent Profile recovery cards, Space readiness actions, and visual motion changes.

## Validation

- Product: a user who does not know the difference between CLI, Service, and skill can identify one current outcome and one next action without choosing an internal mechanism.
- Interface: verify the top action remains obvious without crowding the status at desktop and narrow widths; verify long versions/descriptions do not misalign the three component columns.
- Behavior: verify the CLI-only dialog copies the production-lane command and that Service/skills or combined states navigate to the existing setup/alignment route.
- Contract: confirm Web reads only the Core local component projection and that setup completion still waits for both CLI and Service projections where required.
- Repository: `pnpm --filter openmeld-web exec vitest run --config vitest.config.ts src/components/agents/agents-page-openmeld-service.test.tsx`.
- Repository: `pnpm run check:affected`.
- Repository: `git diff --check -- clients/web/src/components/agents developing/clients/web.md design-plans/computer-openmeld-tools-single-update-action.md`.
- Real interface: after implementation and deployment, use the authenticated production Computer detail page to smoke healthy, CLI-only advisory, aggregate update, reconnect, and post-update confirmed-ready states through user-accessible entry points.

## Stop conditions

- Stop if the full Web setup path cannot guarantee alignment of every actionable Service/skills component; fix the owning setup contract instead of labeling a partial operation as **Update OpenMeld Tools**.
- Stop if Web must infer freshness from version strings because the Core projection lacks a component fact; extend the owning projection rather than adding browser-owned update state.
- Stop if a combined actionable state would require two visible commands. The product contract is one next action; add one orchestrated setup operation at the owner boundary instead of returning two buttons.
- Stop if the implementation would change Wake availability, RuntimeCoordinator execution truth, Service lifecycle, or component update calculation. Those are outside this presentation correction and require their owner documents and contract tests.

## Design documentation

- Update `developing/clients/web.md` in the implementation change because the current document requires `Update OpenMeld Service` across all Web surfaces. The new rule must distinguish an aggregate OpenMeld Tools card from a Service-specific recovery surface so terminology remains stable rather than drifting.
