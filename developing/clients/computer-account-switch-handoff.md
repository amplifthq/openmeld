# Computer account-switch repair handoff

## Agent Context

- Purpose: Reserve one implementation PR for the account-alignment/advisory-update routing defect reached by Desktop Switch account.
- Status: Investigation handoff only; no product fix is implemented here.
- Read this when: Taking over `codex/fix-computer-account-switch-service-refresh`.
- Source of truth: The associated PR's English investigation and implementation comments contain the evidence, scoped correction, regression guidance, and historical-incident limits.
- Lifecycle: Remove this temporary marker once the implementation is complete; update existing owner documents only where durable behavior changes.

## Bounded finding

At main `a9e0fa1f1c8148a077a7bad8d6f7a3572475451f`, a ready Service with a version advisory enters version-only maintenance before the participation gate checks the requested account. That maintenance path does not carry the target account/profile handoff. A successful identity-preserving update can therefore leave Service A running while the post-update gate requires B, producing a failed setup and the existing rollback.

The same gate blob was checked on #1128 at `b1b22ab9b617c5830633e25944ac699af0ba5d53`. This is separate from #1131's renderer/native-interaction repairs. Recheck refs and affected source at takeover.

This conditional code defect is supported by source tracing and an isolated control-flow probe with test doubles. It is not yet proven to be the cause of the original Mac incident: the incident's first failure, installed CLI/Service versions, and pre-attempt advisory state were not available.

## Scope

Preserve the authorized account-switch intent when Service version maintenance is also needed, using existing handoff and lifecycle owners. Keep same-account maintenance, consent fences, rollback, account checks, and controlled drain intact. Do not require Forget, transfer cloud ownership, weaken authorization, or add a new synchronization/update framework. Follow Practical Engineering and the scoped Desktop/CLI/local-Service owner documents.

No product code, native smoke, production account/Service operation, signing, packaging, merge, deployment, or release is authorized by this handoff marker.
