# Phase 3 follow-up · Path guidance for colleague-rooted tasks — external review

Package: smoke round 2b finding R2B-01, under §4.6 (prompt-level judgment)
and §4.10 (paths and machine identity are owner-only) of
[the MemberAgent program](../member-agent-program.md).
Branch: `claude/map-3-path-guidance`, reviewed diff `e2d523c5b..a780e4424`.

## Review run

- 2026-10-19, Codex CLI (`gpt-6-astra`, reasoning `medium`, `--sandbox read-only`).
- Questions: any way a path, home directory, computer name or account id
  reaches the prompt through this change; any non-owner prompt path without
  the guidance; any owner-rooted prompt that changed; whether the personal
  Remote Agent owner check misclassifies; other prompt paths reaching a
  non-owner audience.

## Findings and disposition

| # | Finding | Verified | Disposition |
| --- | --- | --- | --- |
| 1 | A folder display name that passes the separator filter can still be identity: the default name of `/Users/felix` is `felix`; `C:private` and email-like names pass. | Yes | Fixed. The renderer also drops drive-qualified and `@` names; the Service drops a name matching this computer's home directory, OS account or host name and uses "the working folder". Tests for each. |
| 2 | Delivery repair and reply reconsideration replace the task prompt, and Cursor repair starts a fresh session without the guidance. | Yes | Fixed. Both replacement prompts append the guidance for non-owner roots (`appendNonOwnerAudienceGuidance`). |
| 3 | Pre-existing prompt inputs still carry local paths for operations (installed Skill path, isolated workspace directory, image attachment path); the owner's account id is the owner-name fallback. | Yes | Account id fixed: a non-owner prompt shows "unknown" instead. Operational paths not changed: the Agent needs them to read its Skill, find its copy and open images; the guidance forbids repeating them. Reported as a follow-up (move operational paths to adapter parameters). |
| 4 | Exact-conversation recovery uses a fixed prompt without requester context. | Yes | Not changed: the recovery frame carries no requester classification, and conversations started after this change already contain the guidance. Reported as a follow-up for conversations started before it. |
| 5 | The personal Remote Agent treats an owner request delegated through the Center Agent (sender is an Agent) as non-owner, and the text then claimed that someone else asked. | Yes | Partly fixed. The guidance now says OpenMeld did not verify an owner request, which is true for both cases, so an owner-delegated turn gets accurate, more cautious guidance. Passing Core's root verification to the Remote worker needs a worker contract field; reported as a follow-up. |
| — | Ordinary local initial, resumed and redelivered Wakes; native instructions and fallback prompt; owner-rooted local prompts. | — | No issue found: they share one builder; owner-verified prompts are unchanged. |
| — | Hosted Center Agent prompt. | — | Not changed: organization-owned, no Binding owner, not run on members' computers; its turn envelope already carries audience and information-handling rules. |
