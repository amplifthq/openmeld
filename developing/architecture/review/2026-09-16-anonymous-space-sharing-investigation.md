# Anonymous Read-Only Space Sharing Investigation

## Agent Context

- Purpose: Preserve the incident, second-round source investigation, and proposed
  product behavior for account-free Context sharing to people and external Agents.
- Read this when: Continuing Draft PR #1103, validating the sharing regression,
  or deciding the anonymous-reader and authenticated-Guest experience.
- Update this when: Reproduction evidence or an explicit product decision changes
  the findings, scope, or acceptance conditions.
- Do not use this for: An approved implementation plan, permission to publish an
  existing private Space, or proof of the reported production denial's root cause.
- Source of truth: This file owns the preliminary investigation and proposal only.
  [Space Collaboration](../../product/space-collaboration.md) remains the product
  owner. The [PR description](https://github.com/amplifthq/openmeld/pull/1103)
  retains the exact incident URLs and transcribed screenshot observations.

Status: DRAFT — second-round investigation and product pre-design, September 16,
2026. The user requirement below is explicit; the proposed design is not yet an
approved change to the existing authorization contract.

Remove this file when implementation or investigation disposition is complete
and durable conclusions have been incorporated into the relevant owner documents.

## User requirement and incident

The user wants a supported sharing mode in which an external person or Agent can
open a link and immediately read Context without an OpenMeld account or sign-in.
A person may instead choose to sign in and explicitly join the Space. Anonymous
membership, messaging, reactions, file writes, and Agent execution are out of
scope. Reading must not create an account, Human Profile, or Space membership.

The motivating use case is sharing a message and its conversation context with
an external Agent, not simply showing a landing page to a human browser. The user
recalls this capability existing previously and asks whether the earlier request
was actually implemented.

The reporter enabled **Allow external guests**, retained **Only invited people**,
and saw **Members · 4**, but the other browser displayed **This Space isn't
available**. The screenshots place the visibility option in the Space's own
settings; they do not establish an independent Organization-wide restriction.
The recipient's actual session and the persisted link-access mode remain unknown.
The failure screenshot shows the base Space URL, not a failed message deep link.

## Evidence basis

Current-source inspection is pinned to main
`42ee500ef2af9244c5cb985ec3d09e624302a9a8`. Historical comparisons use the actual
base and head of #921. Main has not been established as the deployed incident
revision. Existing test code was read, not executed. Historical PR validation
below is attributed to those PRs and is not new production evidence.

### Finding 1: Anonymous reading was implemented, and its foundation remains

[PR #636](https://github.com/amplifthq/openmeld/pull/636), merged September 4,
2026, introduced shared Space entry resolution for Web and CLI. Its recorded
isolated localhost smoke includes anonymous reading of a public Space, preserved
message targeting, and non-disclosing rejection of a private Space. It explicitly
scoped itself as a foundation rather than the complete external-sharing product.

Current source still contains:

- A [public Web route](https://github.com/amplifthq/openmeld/blob/42ee500ef2af9244c5cb985ec3d09e624302a9a8/clients/web/src/routes/spaces/%24spaceId.tsx)
  with optional authentication, read-only conversation/thread panels, a Sign in
  action, and an explicit join action for authenticated non-members.
- A bounded [anonymous GET allowlist](https://github.com/amplifthq/openmeld/blob/42ee500ef2af9244c5cb985ec3d09e624302a9a8/services/gateway/src/lib/anonymous-space-read-routes.ts)
  covering entry resolution, status, messages, and thread reads. Admission to
  these routes does not itself authorize reading every Space.
- [Core access checks](https://github.com/amplifthq/openmeld/blob/42ee500ef2af9244c5cb985ec3d09e624302a9a8/services/core/src/space/application/space-access-policy.ts)
  that permit applicable public reads without an authenticated actor and reject
  `anonymous_viewer` through `requireWritableSpaceActor` with
  `space.access.read_only`.
- [Web tests](https://github.com/amplifthq/openmeld/blob/42ee500ef2af9244c5cb985ec3d09e624302a9a8/clients/web/src/routes/spaces/%24spaceId.integration.test.tsx)
  for anonymous content without participation controls and message/thread
  preservation in the sign-in return URL.

Conclusion: this is not a missing anonymous-reading foundation. It is also not
proof that the user's complete current workflow was delivered. The original
request's exact acceptance record was not located, and today's end-to-end
cross-Organization Guest join behavior remains unverified.

### Finding 2: The normal owner settings path lost first-time link enablement

Before [PR #921](https://github.com/amplifthq/openmeld/pull/921), the
[Space settings panel](https://github.com/amplifthq/openmeld/blob/b820b76bb3e4a2f13b09c6db0be36bf17c0d2c74/clients/web/src/components/spaces/space-settings-dialog.tsx)
rendered **Link access** and its editor for an ordinary Space regardless of its
current link-access mode.

At [#921's head](https://github.com/amplifthq/openmeld/blob/7c89d3316890eadba6507ff2bb94e3bb78c34e98/clients/web/src/components/spaces/space-access-settings.tsx),
the new shared settings component renders that editor only when
`accessMode !== "members_only"`, and only in Settings, not Share. The same
component content remains on the inspected main. **Copy Space link** remains
available independently.

This confirms a source-level loss of the first-time enablement path in that
panel: an owner starting from members-only cannot use that panel to enable link
reading. It does not prove there is no other API/CLI path, why the change was
made, or which production fact caused this particular rejection.

#921, merged September 10, added signed-in Guest invitations. Its statement that
anonymous participation is deferred must not be interpreted as deferring
anonymous reading. Those are different product outcomes.

### Finding 3: The existing Guest toggle is not anonymous publication

The [Guest component](https://github.com/amplifthq/openmeld/blob/42ee500ef2af9244c5cb985ec3d09e624302a9a8/clients/web/src/components/spaces/space-guest-access-section.tsx)
changes `allowGuests`; its copy requires sign-in and describes invited Guests
reading history/files, posting, and using Agents. It does not change link access.

The retained [link-access editor](https://github.com/amplifthq/openmeld/blob/42ee500ef2af9244c5cb985ec3d09e624302a9a8/clients/web/src/components/spaces/space-access-editor.tsx)
offers members-only, public view/join, public view with password-to-join, and
password-protected view/join. The [shared policy](https://github.com/amplifthq/openmeld/blob/42ee500ef2af9244c5cb985ec3d09e624302a9a8/packages/space/src/access/space-access-policy.ts)
already separates Organization discovery/joining from link-based reading.

The reported combination is therefore not evidence of mutually exclusive rules.
If this Space actually remains members-only, rejecting an anonymous read would
be consistent with the inspected contract. That condition still needs verification.

### Finding 4: Better Auth's Anonymous plugin is not enabled in current source

The inspected [server plugin array](https://github.com/amplifthq/openmeld/blob/42ee500ef2af9244c5cb985ec3d09e624302a9a8/packages/auth/src/configs/auth.config.ts),
[client plugin configuration](https://github.com/amplifthq/openmeld/blob/42ee500ef2af9244c5cb985ec3d09e624302a9a8/packages/auth/src/configs/auth.client.config.ts),
and [Auth Worker wiring](https://github.com/amplifthq/openmeld/blob/42ee500ef2af9244c5cb985ec3d09e624302a9a8/services/auth/src/lib/better-auth/index.ts)
do not register `anonymous()` or `anonymousClient()`.

[Better Auth's official documentation](https://better-auth.com/docs/plugins/anonymous),
checked September 16, explains that anonymous sign-in creates a user and session
without requiring supplied credentials, with later account linking. That is
anonymous authentication, not account-free resource reading.

Recommendation: do not make this plugin a prerequisite for this read-only
workflow. The existing anonymous-viewer concept is the relevant foundation.
OpenMeld's current user-creation hook also provisions personal Organization and
Human Profile state; adding an anonymous-account lifecycle would need a separate
impact review. That is a prospective risk, not a tested plugin integration.

### Finding 5: Context completeness and continuation need more than an entry fix

The inspected public Web route has three concrete investigation targets:

| Source observation | Consequence to validate |
| --- | --- |
| Initial message query requests the most recent 80 messages; its query is not anchored to the supplied message ID. The public panel declares no earlier history and supplies a no-op earlier-history handler. | An older retained message may be authorized but absent from the reader's feed. Reproduce with a known target outside the initial window. |
| Sign-in carries message/thread targets, but `PublicSpaceJoinAction` receives no focus target and its success navigation passes Space/Profile only. | Join completion is a candidate target-loss boundary distinct from sign-in recovery. Verify using a genuinely joinable external account. |
| Public content queries are browser-enabled; the source has JSON read routes but does not itself prove one-link, non-JavaScript Context delivery. | A generic external Agent may not obtain meaningful Context from the copied page URL. Verify plain HTTP and an external reader, not only an interactive browser. |

A reply-only URL without an explicit thread-root parameter also needs its own
case. The optional parameter's absence is not proof the URL is invalid. Files,
full metadata projections, and all mutation paths were not comprehensively
audited in this preliminary pass.

## Proposed product behavior

### One journey, two voluntary levels of involvement

The proposed new owner-visible sharing option is:

**Anyone with the link — view without signing in; sign in to join.**

This is a product-facing mode, not a prescription for a new schema value. The
existing mode remains available. Enabling invited Guests on an existing Space
must not silently enable anonymous publication or public self-join.

For an explicitly shared Space, show authorized content immediately. Do not put
a mandatory Guest/login chooser in front of reading. Offer **Sign in to join**
as an optional action. After authentication, an eligible non-member still makes
an explicit **Join Space** decision. Authentication alone is not membership.
Canceled sign-in or joining must not take away otherwise permitted reading.

| Reader state in the proposed link-sharing mode | Read shared Context | Participate | Membership change |
| --- | --- | --- | --- |
| No account or session | Yes | No | None |
| Signed in, not joined | Yes | No | None |
| Explicitly joined under the owner's enabled join policy | Yes | Existing Guest permissions only | This Space, not the Organization |

The user-requested self-service option requires the owner to authorize both
anonymous reading and eligible signed-in self-join. Do not quietly replace that
outcome with invitation-only access, and do not equate successful login with
permission to join. Reading audience and joining audience remain distinct facts,
even when one simple preset configures both. More restrictive invited-only
participation can retain its existing workflow; it need not add a new approval
system to this scope.

Organization visibility remains independent. An invite-only Organization
relationship need not make intentionally shared Context unreadable, and a
Space-only Guest must not receive Organization membership or directory access.
Guest participation still follows existing server-side permission and Agent
execution boundaries; joining is not blanket administrative or execution consent.

### Define the publication scope before implementation

Recommended first iteration: explicit sharing of an ordinary Space's retained
conversation and threads, with message URLs locating a position inside that
shared scope. Explain that this includes future conversation while sharing stays
enabled. A message selector is navigation, not a message-only permission boundary.
Do not describe a whole-Space publication action as sharing only one message.

Published message attachments should be an explicit part of the sharing consent
and acceptance scope. The entire standalone file library, member directory,
private Agent activity/tool traces, organization data, and linked private Spaces
must not become shared merely because they are related Context. Settle the
attachment/file boundary explicitly before implementation. Fine-grained
message-only publication and independently managed snapshots are separate work.

Existing retained messages and thread replies must remain reachable, including
those outside the first page. Bounded reads are acceptable; silent omission or
claiming a partial window is the complete Context is not. Preserve the requested
message and thread across first entry, refresh, optional sign-in, explicit join,
and legitimate route transitions. Reading should reflect current edits, recalls,
deletions, and authorization rather than resurrecting private or removed content.

### Treat external Agent reading as a first-class acceptance case

A recipient using ordinary HTTP should obtain meaningful authorized text and
thread relationships from the shared link or a discoverable public representation,
without account creation, session cookies, API keys, CLI installation, device
setup, or membership. A rendered browser view alone is insufficient evidence.

The representation may be HTML, Markdown, JSON, or an existing supported surface;
this proposal does not select a transport or endpoint. Human and machine readers
must share the same publication scope, revocation rules, and authoritative access
decisions. An external Agent reading Context does not become an in-Space Agent
and gains no right to execute, post, or follow private references.

### Keep sharing reversible and its limits honest

Existing Spaces stay at their current audience until an authorized owner
explicitly changes sharing. Copying a URL is not permission to publish. Anonymous
views do not increase the member count or create join activity.

Disabling public reading must deny subsequent anonymous content retrieval and
have a defined effect on open readers, cached content, attachments, and machine
reads. It cannot retrieve copies already exported. Removing one Guest does not
exclude that person from content still readable by anyone after signing out;
public-link revocation and membership removal are different controls. Do not
promise identity-specific exclusion while keeping anonymous reading enabled.

## Next Agent: investigation and acceptance handoff

1. Establish the incident facts through supported, read-only diagnostics: actual
   link-access mode, guest setting, Organization visibility, recipient identity,
   deployed revision, and authoritative entry result. No HTTP response was
   obtained in this environment; do not treat its fetch failure as product evidence.
2. Reproduce first-time sharing from an ordinary members-only Space through the
   owner UI, using a disposable authorized fixture. Compare pre/post-#921 behavior
   and determine whether the removed entry was intentional or an unfulfilled
   product transition. Do not broaden the real incident Space as a shortcut.
3. Confirm the proposed audience, self-join, attachment, and publication-scope
   decisions. Inventory current public and Guest contracts before choosing the
   smallest coherent implementation in #1103. Do not introduce a parallel access
   authority or anonymous-account subsystem merely to expose existing reads.
4. Validate owner enablement through fresh-browser and plain-HTTP reading, with
   no account/Profile/membership creation. Include existing member, accepted
   Guest, signed-in non-member, private Space, disabled sharing, and denied-write
   cases. Prove external self-join remains Space-only and explicitly authorized.
5. Verify the exact message, older-than-initial-window message, thread reply,
   reply-only URL, refresh, sign-in cancellation/return, and join completion.
   Include a real external Context reader and explicit pagination/truncation.
6. Check the complete exposed surface, not just hidden UI controls: mutations,
   attachments, private metadata, cross-Space references, cache isolation, and
   revocation. Attribute any remaining limitation rather than claiming complete
   sharing from one successful public page.

Anonymous joining/interactions remain out of scope. Resolving the current policy
rejection alone does not complete the requested sharing workflow. Conversely,
restoring a public-reading path must not silently weaken private-Space boundaries.

## Validation and delivery limits

This round contains source/history investigation and proposed product behavior,
not an application fix. Credential-free production GET attempts could not obtain
an HTTP response: the web fetcher returned a cache miss and the container failed
hostname resolution. These are investigation-environment limitations, not proof
of an OpenMeld outage or its authorization result.

No application tests or browser smoke were run; no production settings, database,
application code, merge, or deployment were changed. Historical PR smoke and
existing test cases are evidence of prior work, not current acceptance. Keep
#1103 Draft while product decisions and implementation validation remain pending.
