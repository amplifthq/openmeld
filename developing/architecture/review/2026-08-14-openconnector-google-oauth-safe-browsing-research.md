# OpenConnector, Google OAuth, and Safe Browsing Research

## Agent Context

- Purpose: Preserve dated evidence for diagnosing the Chrome `Dangerous site`
  interstitial on an OpenMeld Gmail App page and the separate Google OAuth
  production-verification gap.
- Read this when: Investigating the August 2026 OpenMeld Gmail connection
  incident, preparing a Safe Browsing review, or preparing the Google OAuth
  brand and restricted-scope verification submission.
- Update this when: New incident evidence, a production OpenConnector version,
  or an official Google review result changes a conclusion below.
- Do not use this for: Secret values, production configuration changes,
  authorization to submit reviews, or a durable replacement for the owning
  App/runtime architecture documents.
- Source of truth: This file is dated research and diagnostic evidence only;
  current production configuration, Google consoles, and the linked official
  sources remain authoritative.

Date: 2026-08-14

Status: LIVE EVIDENCE AND REVIEW ACTIONS CAPTURED. The Google account changes
and submissions listed below were performed through the authenticated
Organization-managed Chrome profile. No production code, deployed service,
OAuth secret, credential, or provider data was changed.

Remove when: Both the Safe Browsing incident and the Google OAuth verification
work are closed and any durable operating guidance has been incorporated into
the appropriate owner documents.

## Executive Conclusion

Two independent Google systems are involved:

1. The Chrome red `Dangerous site` interstitial is a Google Safe Browsing
   classification. Google documents this under Search Console **Security
   Issues**, including `Deceptive pages`, phishing, malware, harmful downloads,
   and embedded third-party resources.
2. Google Auth Platform brand and data-access verification governs whether an
   OAuth app may publicly request sensitive or restricted Google scopes without
   an `Unverified app` warning, `access_denied`, or related user limits.

Self-hosting OpenConnector does not, by itself, cause a Safe Browsing
`Deceptive pages` classification. It does make OpenMeld the operator of the
Google OAuth client, callback, token store, and Gmail data path, so OpenMeld is
responsible for Google OAuth brand verification, restricted-scope verification,
and any applicable annual security assessment. The two review tracks can be
open at the same time, but completing one does not clear the other.

No official OpenConnector source or Google documentation was found that says
that using a self-hosted connector, requesting Gmail scopes, or leaving OAuth
verification incomplete automatically generates a site-wide Safe Browsing red
screen.

## Evidence Boundary

This investigation used:

- the official OpenConnector repository and immutable source revisions;
- current Google Help and Google for Developers documentation;
- tracked non-secret OpenMeld production configuration; and
- read-only production and Google Console observations captured in the parent
  investigation.

The live follow-up did submit the exact URL through Google's Safe Browsing
false-positive form and submit the `openmeld.ai` Search Console security review.
It also saved Branding and Data Access draft/configuration changes described
below. It did not submit Google OAuth verification because the Console blocks
the submission without the required demo video. It did not change an OAuth
client, production configuration, or any secret or credential value.

## OpenConnector Upstream and Self-Hosted Architecture

### Canonical upstream

The canonical project is
[`oomol-lab/open-connector`](https://github.com/oomol-lab/open-connector). The
`amplifthq/open-connector` repository is a fork of that upstream, not a separate
canonical implementation.

The source snapshot used for current-`main` evidence is
[`50912b40567ba797ec97574732ad4e9255672e2e`](https://github.com/oomol-lab/open-connector/commit/50912b40567ba797ec97574732ad4e9255672e2e).
The latest formal release observed during this investigation was
[`v1.3.5`](https://github.com/oomol-lab/open-connector/releases/tag/v1.3.5),
commit `5719a69468c698c7cb8108e062ff64ecef8a2e65`. Release behavior must not be
inferred from a later `main` snapshot.

The OpenMeld fork's `main` resolved to
`ff44aed728792441ca86a4ce723d5abc96665029` during the live follow-up. No
production response or release record exposed an immutable OpenConnector
deployment SHA, so this audit does not claim that the fork tip is the version
currently serving `connectors.openmeld.ai`. Provider behavior is based on live
production runs; source-level observations are identified separately.

### Self-hosting responsibilities

OpenConnector is the credential and provider-action boundary between the
calling application and Gmail. The upstream README says self-hosters manage
their own OAuth applications and that provider secrets stay inside the
OpenConnector runtime rather than being exposed to the calling agent:

- [Upstream deployment and self-hosting overview](https://github.com/oomol-lab/open-connector/blob/50912b40567ba797ec97574732ad4e9255672e2e/README.md#L24-L37)
- [Upstream credential boundary](https://github.com/oomol-lab/open-connector/blob/50912b40567ba797ec97574732ad4e9255672e2e/README.md#L108-L125)
- [Cloudflare storage model](https://github.com/oomol-lab/open-connector/blob/50912b40567ba797ec97574732ad4e9255672e2e/docs/cloudflare.md#L3-L9)
- [Credential and token storage](https://github.com/oomol-lab/open-connector/blob/50912b40567ba797ec97574732ad4e9255672e2e/docs/credentials.md#L1-L18)

The supported self-hosted shapes include a Node.js/SQLite deployment and a
Cloudflare Workers deployment backed by D1 plus R2/KV-style storage. For Google
OAuth, the self-hoster supplies the client configuration, Google consent-screen
configuration, verified domains, and review materials. OpenConnector does not
obtain Google's approval on the operator's behalf:

- [Gmail OAuth SDK guide](https://github.com/oomol-lab/open-connector/blob/50912b40567ba797ec97574732ad4e9255672e2e/docs/gmail-oauth-sdk.md#L1-L15)

### Callback contract

OpenConnector derives the callback as:

```text
${OOMOL_CONNECT_ORIGIN}/oauth/callback
```

The callback derivation is visible in
[`oauth-client-config-service.ts`](https://github.com/oomol-lab/open-connector/blob/50912b40567ba797ec97574732ad4e9255672e2e/src/oauth/oauth-client-config-service.ts#L63-L70).
The upstream local example follows the same contract in
[`examples/local-http/gmail.ts`](https://github.com/oomol-lab/open-connector/blob/50912b40567ba797ec97574732ad4e9255672e2e/examples/local-http/gmail.ts#L1-L26).

OpenMeld's tracked production configuration sets `OOMOL_CONNECT_ORIGIN` to
`https://connectors.openmeld.ai`. The exact callback is therefore:

```text
https://connectors.openmeld.ai/oauth/callback
```

This callback must match the Google OAuth client's authorized redirect URI
exactly. The Center Agent page at
`https://openmeld.ai/o/amplift/center-agent/apps/gmail` is an OpenMeld product
page, not the OAuth callback.

## Current Gmail Scope Behavior

### Upstream version difference

The formal `v1.3.5` release requests seven Gmail scopes by default, including
the administrative-only `gmail.settings.sharing`:

- [v1.3.5 Gmail scopes](https://github.com/oomol-lab/open-connector/blob/5719a69468c698c7cb8108e062ff64ecef8a2e65/src/providers/gmail/scopes.ts#L1-L25)

Upstream subsequently removed `gmail.settings.sharing` in
[PR #293](https://github.com/oomol-lab/open-connector/pull/293) and removed
redundant scopes in [PR #310](https://github.com/oomol-lab/open-connector/pull/310).
At the pinned current-`main` snapshot, the defaults are only:

```text
https://www.googleapis.com/auth/gmail.modify
https://www.googleapis.com/auth/gmail.labels
https://www.googleapis.com/auth/gmail.settings.basic
```

- [Current pinned Gmail scopes](https://github.com/oomol-lab/open-connector/blob/50912b40567ba797ec97574732ad4e9255672e2e/src/providers/gmail/scopes.ts#L1-L15)

### Production configuration and legacy connection evidence

The parent investigation called the production non-mutating OAuth-config
endpoint and observed the following Gmail projection:

- `configured=true`
- `requestedScopes=null`
- `effectiveScopes` exactly equals `gmail.modify`, `gmail.labels`, and
  `gmail.settings.basic`
- callback exactly equals `https://connectors.openmeld.ai/oauth/callback`

No client ID, client secret, token, or credential value is recorded here.

This proves that production is currently using the corrected three-scope
effective set. It also rules out callback mismatch and the old
`gmail.settings.sharing` default as the observed configuration problem. It
does not prove Google approval for those scopes.

A later redacted OpenConnector run-log read showed that Felix Lu's existing
member connection predates that cleanup and still carries grants for
`gmail.readonly`, `gmail.send`, and `gmail.compose` in addition to the current
three scopes. This does not change the new-connection configuration: a fresh
OAuth flow uses the current three-scope effective set. It does mean the old
connection is not valid evidence of what a new reviewer/test user will see.
The verification recording must use a fresh authorization and display the
three current Gmail scopes.

### Google classification and security assessment

Google's current Gmail scope table classifies:

| Scope | Google classification | Practical consequence |
| --- | --- | --- |
| `gmail.labels` | Non-sensitive | Basic OAuth app verification requirements apply. |
| `gmail.modify` | Restricted | Restricted-scope verification applies. |
| `gmail.settings.basic` | Restricted | Restricted-scope verification applies. |

Source: [Choose Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes).

Google explicitly says that an app that stores or transmits restricted-scope
data on servers must complete a security assessment. The restricted-scope guide
describes this as an annual assessment by a Google-approved third party for
apps accessing restricted data from or through a third-party server:

- [Restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)
- [Security Assessment](https://support.google.com/cloud/answer/13465431?hl=en)

Because the self-hosted OpenConnector server mediates Gmail actions and holds
OAuth credentials, this requirement is strongly indicated for the actual
OpenMeld architecture. An exception can only be claimed by matching Google's
documented exception and the real data path; self-hosting is not itself an
exception. The Trust & Safety team initiates the assessment after the other
restricted-scope review requirements are complete.

## Live Google Console Evidence and Changes

The investigation used the authenticated Organization-managed Chrome profile
and observed:

- the production connector OAuth client's JavaScript origin and callback are
  correctly configured;
- the project is `External` and `In production`;
- Audience states that verification is required and shows 3 of the 100-user
  unverified-app cap;
- Verification Center shows both Branding and Data Access as unverified and
  offers `Prepare for verification`, rather than showing a submitted or
  approved review;
- Branding now has the OpenMeld letter-O logo from
  `clients/web/public/brand/openmeld-letter-o-glow-128.png`;
- the homepage and privacy policy are set to `https://openmeld.ai` and
  `https://openmeld.ai/privacy`;
- the Terms of Service URL is empty, and the production `/terms` route returns
  HTTP 404;
- developer contacts and the `openmeld.ai` authorized domain are present;
- the Console-declared scopes were reduced to the exact production effective
  union: two non-sensitive scopes, six Calendar sensitive scopes, Drive's
  restricted `drive` scope, and Gmail's restricted `gmail.modify` and
  `gmail.settings.basic` scopes;
- stale `gmail.send`, `gmail.readonly`, `gmail.compose`, `drive.readonly`,
  `drive.metadata.readonly`, and broad `calendar` declarations were removed;
- Calendar, Drive, and Gmail justifications were saved; restricted use cases
  were saved as `Drive productivity` and `Email productivity`; and
- the demo-video field remains empty.
- Gmail API is enabled and has request activity.

These observations support the following diagnosis:

- `In production` only controls who may attempt to use an External app. It is
  not proof that Google has verified the brand or approved restricted scopes.
- The correct callback and enabled Gmail API eliminate two common setup errors.
- The Verification submission screen now preserves the justifications and use
  cases, but explicitly reports `Missing the following fields for one or more
  requested scopes: demo video.` Its `Confirm` button is disabled. This proves
  the restricted-scope review cannot be submitted yet.
- This incomplete OAuth review can explain an OAuth-hosted `Unverified app`
  warning, `access_denied`, or the 100-user cap. It does not, by itself, explain
  the Chrome Safe Browsing interstitial shown before the OAuth flow begins.

Google's Audience documentation makes the same distinction between publishing
status and verification:

- [Manage App Audience](https://support.google.com/cloud/answer/15549945?hl=en)
- [Unverified apps](https://support.google.com/cloud/answer/7454865?hl=en)

## OAuth Brand and Data-Access Verification Requirements

### Branding is logically separate, but the current combined submission is blocked

Google documents Brand verification as a separate prerequisite. Its sequence
is:

1. complete accurate app identity and domain-linked application URLs;
2. click `Verify Branding`;
3. reach `Ready to publish`; and
4. click `Publish branding`.

The brand-verification requirements do not themselves include the OAuth
functionality demo video. Published Branding is required before Data Access
verification can be requested:

- [Brand verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)

The live `openmeld` Console currently presents one combined `Prepare for
verification` screen. Because the project already declares restricted scopes,
that screen disables `Confirm` until the demo-video field is populated. The
investigation did not remove production scopes merely to force a brand-only
submission. Therefore the general documentation establishes that the brand
work is separable in policy, while the authoritative current project UI
establishes that this specific project cannot submit its current combined draft
without the video.

For every External production app, Google's current Branding help says the App
Domain links are required for verification. The homepage must be public,
accurately describe the product, be hosted on a verified owned domain, and link
to the same privacy policy declared in the console. The privacy policy must
describe how Google user data is accessed, used, stored, and shared:

- [Manage OAuth App Branding](https://support.google.com/cloud/answer/15549049?hl=en)
- [App Homepage](https://support.google.com/cloud/answer/13807376?hl=en)

The logo is not the direct cause of the Chrome warning. The saved logo is part
of the brand identity that OpenMeld can verify and publish. The empty Terms URL
is a concrete completeness gap for the current External production branding
submission under Google's current Branding guidance.

### Gmail Data Access cannot be completely submitted without the demo

For any sensitive or restricted scope, Google requires:

- scope justification, including why narrower scopes are insufficient;
- for restricted scopes, the selected permitted feature/use case;
- a demonstration video covering every OAuth client in the project;
- an end-to-end OAuth grant flow and complete consent screen in English;
- the exact scopes being submitted; and
- the product functionality enabled by each scope.

Sources:

- [Manage App Data Access](https://support.google.com/cloud/answer/15549135?hl=en)
- [Submitting your app for verification](https://support.google.com/cloud/answer/13461325?hl=en)
- [Verification requirements](https://support.google.com/cloud/answer/13464321?hl=en)

Therefore OpenMeld can complete the Branding content and prepare the Data
Access form before recording, but the live combined submission cannot be sent
until the demo-video field is complete. The scope-justification and restricted
feature fields are now populated; the video remains the hard blocker.

The general Data Access guidance requires a YouTube video. The more specific
restricted-scope guide instructs the applicant to upload the video in YouTube
Studio and set its visibility to **Unlisted**, then provide that link. Because
OpenMeld requests two restricted Gmail scopes, the restricted-scope instruction
is the applicable one:

- [Restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)

For an automation platform, Google's restricted-scope guidance additionally
expects the demo to show how multiple API workflows are created or automated
and the direction in which user data flows.

## Changes After an External App Is In Production

Changing an approved app's name, logo, redirect URI, homepage, or privacy
policy requires brand verification again. If the requested scopes did not
change, Google says additional scope justification is not required merely for
those brand changes. The changes are not shown to users until re-verification,
and the brand-only change does not itself trigger the unverified-app screen or
the 100-user cap:

- [Changes to approved app](https://support.google.com/cloud/answer/13464018?hl=en)

Google's current brand-versioning behavior is:

- edits to name, logo, homepage, privacy policy, Terms, or authorized domains
  are saved as `Draft Branding`;
- the previously published branding remains live until the draft is verified
  and published;
- branding cannot be modified while verification is in progress unless the
  review is cancelled first;
- a successful result becomes `Ready to publish`;
- the operator must click `Publish branding`; and
- the successful verification result expires after seven days if it is not
  published, after which it becomes `Need to re-verify`.

Source: [Brand verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification).

The `Changes to approved app` page does not separately enumerate Terms of
Service in its short list. However, current Branding documentation includes
Terms within the App Domain/application URL set. A Terms change should therefore
be treated as a Draft Branding change and taken through `Verify Branding` and
`Publish branding`, not assumed to be exempt.

Adding a new sensitive or restricted scope is a different change: it requires
scope justification and approval before production begins requesting that
scope. Requesting an unapproved scope produces the OAuth `Unverified app`
experience; it does not produce the site-wide Safe Browsing interstitial.

## Safe Browsing Review and False-Positive Path

### Reproduced incident boundary

The authenticated Chrome investigation established the following differential:

- a fresh direct navigation to
  `https://openmeld.ai/o/amplift/center-agent/apps/gmail` reaches Chrome's
  security interstitial;
- the matching Google Drive URL at
  `https://openmeld.ai/o/amplift/center-agent/apps/googledrive` also reaches a
  `Security error` interstitial and reports `ERR_BLOCKED_BY_CLIENT`, while the
  Google Calendar URL opens normally;
- the same Google Drive App route under another Organization opens normally,
  while an `amplift` App URL containing the shorter `/apps/drive` provider
  label is also blocked;
- unauthenticated access receives a first-party redirect to
  `/login?redirect=%2Fo%2Famplift%2Fcenter-agent%2Fapps%2Fgmail`;
- the login page is clearly OpenMeld-branded but contains OpenMeld email and
  password fields while the visible return target contains a provider-labelled
  App path;
- the homepage, a random path, the parent Apps page, the Calendar and GitHub App
  pages, another Organization's Gmail and Drive pages, and
  `connectors.openmeld.ai` did not reproduce the warning;
- entering the Gmail page through authenticated client-side navigation worked;
- the authenticated Gmail page contained no forms or iframes, loaded
  first-party OpenMeld resources, and used only Cloudflare Insights as an
  observed external script; and
- Chrome reported a valid certificate.

Search Console reports one `Deceptive pages` Security Issue for the
`sc-domain:openmeld.ai` property and supplies no sample URL. This proves the red
screen belongs to Safe Browsing and is path/redirect-sensitive in the observed
browser. It does not reveal Google's private classifier feature. The strongest
remaining inference is a false positive affecting provider-labelled App deep
links under the `amplift` Organization, with Gmail and Drive currently blocked
but Calendar and the same provider routes under another Organization not
blocked. The common first-party login shape remains a plausible classifier
input, but it is not a Google-confirmed classifier reason.

The current Web implementation makes that inference concrete. The organization
scope loader passes the protected route's complete `location.pathname` as its
`routeFamily`; when the required session is absent,
`clients/web/src/lib/organizations/organization-scope.ts` sends that value as
the visible `/login?redirect=...` query. `clients/web/src/routes/login.tsx`
then renders `SignInForm`, whose first-party form contains both email and
password fields. For these incidents, the address bar can therefore preserve a
provider-labelled App destination while displaying a password form.
This is a product-code explanation of the observed URL shape, not proof of the
private Safe Browsing feature that produced Google's classification.

The observed page and resource audit found no evidence that the authenticated
App page imitates Google, collects Google credentials, embeds deceptive third
party content, or serves a download. This materially reduces the compromise
hypothesis but does not replace Google's review result.

### Review actions performed

Two official review routes were used with the exact production URL:

- Google's Safe Browsing false-positive form returned `Submission was
  successful.`
- Search Console returned `Request submitted successfully.` after a factual
  site-level review request described the redirect, authenticated page,
  resource-origin, iframe/form, application-code, and connector audit.

The Search Console issue remains visible until Google completes its review.
Repeated submissions should not be made while that review is pending.

Google's Search Console Security Issues workflow requires the site owner to:

1. expand and read every listed issue;
2. inspect the sample URLs while recognizing that no samples does not mean no
   affected pages exist;
3. inspect and remediate the issue across the entire site, including deceptive
   third-party ads, images, embedded resources, redirects, downloads, and
   compromised content;
4. fix every listed Security Issue and test the result; and
5. request a review only after the site has been checked and the issue is
   resolved.

Google says a useful review request should explain the exact issue, the concrete
steps taken, and the outcome. It should not be repeatedly resubmitted while a
review is pending. Review can take from a few days to a few weeks:

- [Security Issues report](https://support.google.com/webmasters/answer/9044101?hl=en)

Google also explicitly provides a false-positive route. For a page believed to
have been incorrectly classified by Safe Browsing, report the error at:

- [Report a Page to Google Safe Browsing](https://www.google.com/safebrowsing/report_error/)

This is the official false-positive report. Search Console `Request Review` is
still phrased as the site-level review after inspection and remediation. A
factually accurate Search Console review can state that no deceptive behavior
was found only if the owner also states what was inspected and what the
resulting evidence showed. It should not invent a remediation that did not
happen.

For this incident, the review evidence should cover at least:

- the exact flagged host and example URLs shown by Search Console;
- unauthenticated and authenticated behavior of the flagged product route;
- redirects, login/OAuth handoff, downloads, third-party scripts, frames,
  images, and other embedded resources;
- recent deployments, dependency integrity, compromised accounts, injected
  content, DNS/CDN/Worker routes, and any unexpected paths or subdomains;
- desktop and mobile behavior; and
- the final retest results.

That list is an evidence-oriented interpretation of Google's workflow, not a
Google-provided fixed form template.

## Legacy Product Comparison Boundary

The equivalent legacy-product Gmail deep link did not reproduce the Chrome
interstitial. The route presentation and connector pattern alone therefore do
not explain OpenMeld's classification. The material difference is the Safe
Browsing reputation/classification of the OpenMeld URL and its visible login
return path, not the fact that both products use a self-hosted connector.

The Organization-managed account does not have the IAM permissions required to
read the likely legacy Google Auth project. The accessible legacy project
declares zero OAuth scopes and is not evidence for the production legacy OAuth
app. No IAM permission was granted, and the two projects were not conflated.
Consequently, this investigation cannot honestly claim whether the historical
legacy OAuth brand or restricted scopes were approved. What it can establish is
that the legacy product URL was not on the same Safe Browsing path
classification.

## Production Verification-Recording Smoke

The smoke below is real production evidence, not a claim that every repository
commit is deployed. At the time of the audit, the latest successful scoped
release records were Web and Remote Agent at
`e1c322e4cbc678944f12a745e694c515c10c3bb5`, Gateway and Auth at
`8106266c75e79740243342879058a37b561cb5ea`, and Core at
`0f83428dd7044e8b0babb42dc555b6932117f45e`. The repository's `origin/main` had
advanced to `5f3ca07f3d8b0d8bfa976f403231a2e8510450f7`; its CLI release was still in
progress and there was no matching later Web/Remote Agent/Core production
release record. A source-only result from later `main` must not be presented as
current production behavior.

The production App catalog shows member connections for Gmail, Google Calendar,
and Google Drive. Real user-facing Center Agent runs produced:

| App evidence | Production result |
| --- | --- |
| Gmail message read | Existing production run returned `WORK_SUMMARY_FIXED_GMAIL_OK unread=201`. |
| Google Calendar read | `CALENDAR_OAUTH_DEMO_OK 1 UTC 2` after listing calendars, Calendar settings, and primary-calendar ACL rules. |
| Google Drive read | `DRIVE_OAUTH_DEMO_OK count=1` after a read-only file-list action. |
| Gmail label and language reads | 14 labels and language `en` were returned. |
| Gmail filter read | `gmail.list_filters` failed twice through Center Agent and once through a direct idempotent read-only runtime reproduction. |

Core's durable connector-operation ledger records both filter attempts as
`failed`, with separate OpenConnector provider execution IDs. The redacted
OpenConnector run logs prove the connection contains
`gmail.settings.basic`, policy allowed `gmail.*`, and each request reached
`gmail.list_filters` before failing in about 200 ms with `internal_error` and
`Gmail request failed.` This rules out missing scope, missing connection, or
OpenMeld action-policy denial as the immediate explanation.

The current OpenConnector runner catches thrown provider-request errors as a
generic `internal_error` and its redacted run log retains no provider HTTP
status or Google error reason. Therefore the exact Google-side rejection cannot
be recovered from the durable evidence. That observability gap is itself a
code defect: provider errors from the Gmail executor should be mapped to a
stable provider/authorization/rate-limit error without credentials or message
content. Until `gmail.list_filters` succeeds or
`gmail.settings.basic` is removed from the shipped scope set and product
promise, the restricted-scope recording is not ready.

No production write action was executed during this audit. Calendar event or
ACL changes, Drive create/update/share operations, Gmail send/modify actions,
and the fresh OAuth grant flow therefore still need controlled test fixtures
before the recording can truthfully demonstrate the broad write scopes.

### Scope-minimization follow-up

A read-only aggregate of the complete production connector-operation ledger
for these three services found no product write operations. It contained 11
completed Gmail `fetch_emails` operations, two completed `get_label`, two
completed `list_labels`, one completed `get_language_settings`, the two failed
`list_filters` operations, and only the Calendar/Drive audit reads listed
above. Historical absence is not proof that a capability has no future value,
but it is definitive evidence that the current broad write and administrative
scope set has not yet been proven through the user-facing product.

The clean production-first scope baseline is therefore:

| Service | Initial scope | Current value retained | Deferred scope families |
| --- | --- | --- | --- |
| Gmail | `gmail.readonly` | Search, read, summarize, and monitor mail without send, trash, draft, label-write, or mailbox-settings authority. | Add `gmail.send` only with a tested send/reply flow; add `gmail.compose`, `gmail.modify`, or `gmail.settings.basic` only with the matching shipped feature and review evidence. |
| Google Drive | `drive.readonly` | Find, inspect, and download existing files. | Prefer future `drive.file` plus a Picker/file-sharing UX for selected-file writes; do not request full `drive` until all-file create/update/share/delete is an explicit shipped promise. |
| Google Calendar | `calendar.readonly` | List calendars and events for schedule understanding. | Add `calendar.events` for tested event creation/editing. Defer Calendar-list mutation, calendar administration, settings, and ACL scopes until those exact features ship. |

This baseline still includes restricted Gmail and Drive reads, so it does not
remove the demo, restricted-scope review, or likely security-assessment
obligation. It does materially reduce data mutation authority and the number of
features that must be demonstrated truthfully.

The tracked production OpenConnector action policy currently allows
`gmail.*`, `googlecalendar.*`, and `googledrive.*`. Scope reduction alone would
therefore leave unsupported write/admin actions model-visible. The production
fix must change the three layers together: provider-requested OAuth scopes,
OpenConnector action policy/model discovery, and Google Console declared
scopes. Otherwise the Center Agent can discover an action that its new
credential cannot execute.

Google recommends incremental authorization, but the reviewed OpenConnector
Google provider definitions currently send `access_type=offline` and
`prompt=consent` without `include_granted_scopes=true`. More importantly, the
same Google Cloud project serves separate Gmail, Calendar, and Drive
connections; blindly combining previously granted project scopes can collapse
those service boundaries into a broader token. Future capability expansion
should therefore be a reviewed, feature-gated scope migration with a fresh
authorization, not a speculative pre-approval of unused scopes.

## Symptom-to-System Map

| Observed symptom | Owning system | Most relevant diagnosis |
| --- | --- | --- |
| Chrome red full-page `Dangerous site` before Google OAuth | Safe Browsing / Search Console Security Issues | Deceptive page, phishing, harmful resource, compromise, or false positive; inspect and use Safe Browsing/Search Console review. |
| Google-hosted `Unverified app` consent warning | Google Auth Platform verification | Sensitive/restricted scope is requested before approval or configuration no longer matches the approved app. |
| Google OAuth `403 access_denied` for a non-test user | Google Auth Platform audience/review | Testing/audience restrictions, unapproved access, or policy enforcement; inspect the exact OAuth error. |
| `redirect_uri_mismatch` | Google OAuth client configuration | Runtime callback and authorized redirect URI differ exactly. Current read-only evidence rules this out for the production connector client. |
| 100-user cap | Unverified External OAuth app | Publishing to production did not complete required brand/data-access verification. |

## Recommended Order of Work

1. Wait for the already-submitted Safe Browsing and Search Console reviews. Do
   not repeatedly resubmit. In parallel, remove provider-labelled App return
   targets from the password-bearing login URL by keeping the
   post-login destination in a signed first-party state/cookie or routing
   unauthenticated App detail visits through a generic login destination.
2. Add a real public Terms of Service route, then save its URL in Branding.
   Keep the saved logo, homepage, privacy policy, authorized domain, and contact
   emails accurate.
3. Ship one coherent read-only Google Apps baseline: Gmail `gmail.readonly`,
   Drive `drive.readonly`, and Calendar `calendar.readonly`. Narrow the
   OpenConnector action policy/model-visible catalog to the matching reads, and
   make the Google Console declarations match the runtime exactly.
4. Use a fresh test authorization and controlled test data to prove each
   retained scope through the user-facing Center Agent. Do not use the legacy
   six-scope Gmail grant as consent-screen evidence.
5. Record an English end-to-end screen demonstration, upload it to YouTube as
   Unlisted, save the link, and submit the currently blocked combined
   verification draft.
6. Add high-value writes later, one tested feature family at a time: Calendar
   events, Gmail send/reply, and selected-file Drive writes are the first
   candidates. Do not pre-apply for unused settings, ACL, or all-file authority.
7. Follow the Trust & Safety thread and complete the third-party security
   assessment when Google instructs the project to begin.
8. After approval, run the real user Google App connection flows and distinguish
   Safe Browsing status, OAuth consent status, connection creation, and action
   execution as four separate pieces of evidence.

## Final Answers

### Did self-hosted OpenConnector cause `Deceptive pages`?

There is no official-source evidence that self-hosting OpenConnector itself
caused the classification. OpenConnector creates a legitimate OAuth and
restricted-data compliance obligation; it is not the system that assigns the
Chrome red warning. A compromise, deceptive page/resource, or false positive
must be investigated through Safe Browsing/Search Console evidence.

### Is Google OAuth verification incomplete?

Yes. The live Console shows an External production app that requires
verification, while Branding and Data Access are unverified. Scope
justifications and restricted feature selections are now saved, but the demo
video is missing and the combined submission's `Confirm` button is disabled.
Correct callback configuration and enabled Gmail API do not replace
verification.

### Can OpenMeld submit without a demo video?

Google's Branding requirements do not include the Data Access demo, but the
current project presents one combined submission and disables `Confirm` while
the restricted-scope video is missing. A complete Data Access verification for
`gmail.modify`, `gmail.settings.basic`, and Drive cannot omit the demo. The
applicable restricted-scope guide requires the YouTube video to be Unlisted.

### Does changing branding require another review?

Yes for the listed identity and application URL changes. Changes stay in Draft
Branding until verified and published; verification in progress locks branding
edits, and a successful result must be published within seven days.
