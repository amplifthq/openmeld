# Desktop Client

## Agent Context

- Purpose: Define the Electron client's shared application presentation, native
  capabilities, authentication, and independent local Service boundary.
- Read this when: Changing Desktop main/preload/renderer, local assets, login,
  cloud access, CLI integration, tray, packaging, or the Desktop pilot.
- Update this when: Desktop platform contracts, build entry, account isolation,
  Service controls, or distribution responsibilities change.
- Do not use this for: Core execution authority, Service lifecycle internals,
  or production release authorization.
- Source of truth: This document owns Desktop client responsibilities. Web owns
  browser routing and shared business presentation; Core and Space own cloud
  facts; the CLI and independent Service own local execution.

## Product boundary

New installed builds use `https://app.openmeld.ai` as their production Web
origin. The installed-target schema still accepts the old root for existing
builds. Root Auth, API, compatibility, and installer requests are forwarded
without redirects because native transport rejects redirects. Installed
renderers reject generated server-function calls and use shared APIs.
The native credential store is keyed by Web origin, so a new installed build
may require signing in again. Native schemes and the Passkey parent RP ID stay
unchanged. Verify an actual installed old-to-new client separately from browser
smoke before publishing this origin change; see [Website](website.md).

The native frame waits for hydration before adding its titlebar and content
wrapper. Its first client tree must match the prerendered shell, where no native
bridge exists. A document-level hydration replacement clears the shared Web
Appearance bootstrap attributes, including conversation width and self-message
alignment. Preserve that initialization rather than deriving Desktop-specific
preferences or compensating with local CSS.

The macOS titlebar places Toggle sidebar, Back, and Forward after the native
window controls, using Command+B, Command+[, and Command+] outside editors and
modal controls. Its buttons are not draggable; the remaining titlebar is.
The sidebar control is a portal from the existing module-sidebar provider, so
it controls the contextual list (or the existing narrow-window drawer), not
the application rail. Desktop omits the corresponding work-area header entry;
browser Web keeps its existing placement and shortcuts.
Sidebar geometry and explicit visibility choices use the shared Web preference
codec with the existing local browser-preference storage in Desktop's persistent
application partition. They do not use `document.cookie`, which cannot persist
on the custom application scheme. Stable application origin, storage keys, and
user-data directory retain these choices across reloads, restarts, and updates.
No visibility preference is written merely by visiting a route: Spaces browsing
starts collapsed and a Space starts expanded until the user changes visibility.

Pages that supply their own inner sidebar, such as standalone Settings and
Agent Activity, retain their existing narrow-window drawer opener. The titlebar
does not take ownership of those sidebars.

Windows uses Electron's native titlebar overlay for minimize, maximize and close;
shared navigation stays inside the overlay's CSS safe area rather than using
macOS traffic-light insets. Sidebar, Back and Forward use Ctrl on Windows and
Command on macOS, with matching hints. IME composition, repeated keydown, input
editors, modal dialogs and the other platform modifier do not trigger these
shortcuts. Platform hints are presentation only and confer no local capability.

Back and Forward use the shared router history. Desktop retains only the
observed history-index bounds for the current account, not another entry stack.
Native session invalidation, account changes, and leaving workspace routes
clear those bounds. Unobserved history from before opening the app is excluded.
These controls never reload the document or bypass route authorization.

Organization entry and route scope use the shared Auth-owned
`GET /v1/account/organization-context` projection rather than generated
server-function IDs. The native credential transport remains unchanged; the
renderer receives account display facts, membership summaries, and a default
Organization ID only. Deploy the additive Auth route before releasing these
consumers. Residual session and other server-function reads still require the
existing pilot build compatibility gate.

Desktop and Web share complete business views and application logic. They have
separate build entries and platform adapters. Desktop ships its renderer assets
locally; loading the hosted Web page in an Electron window is not the target.
Extract reusable business views at their existing ownership boundary rather than
copying Space pages into a Desktop-only implementation.

Desktop is a peer client over the same cloud truth. It does not own a second
account identity, Computer, Agent Profile, Binding, Wakeability projection,
dispatch queue, synchronization engine, or execution state machine.

Computer Connection update and reconnect actions compare the native CLI-owned
local Computer projection with the signed-in account and selected device/lane.
A matching local target opens the existing bundled connection flow, which calls
`updateComputer` or `connectComputer` and retains native admission and completion
verification. Remote targets and builds without the required native capability
keep the browser handoff. The global Web-only configuration capability remains
unchanged.
Before targeted recovery, Main resolves the selected Computer in Core's
authenticated inventory and matches its device/lane to the native identity.
It passes that verified target to Prepare; a new Prepare snapshot does not
implicitly resolve a device from the stable Computer ID.
RuntimeCoordinator remains the workstation execution authority, the Space
durable outbox remains the conveyor, and the Service retains disk/ack recovery.

Closing a window hides it. Quitting Desktop ends only the GUI. Neither action
stops the independent OS-managed OpenMeld Service or accepted work. Explicit
Service actions use the existing CLI contracts and remain separate from GUI
launch-at-login preferences. If unsaved renderer work blocks an ordinary Quit,
main clears only that ordinary quit intent so the next close hides the window
again. An accepted updater installation remains a distinct terminal quit intent.

App settings places **Desktop** under Personal, immediately after Notifications,
only on the native host. **Open at login** reads the operating system's login-item
state; it does not persist a second enabled flag. **Start in background** is an
installation-local preference in the native userData directory. It hides only
login-triggered launches, never ordinary opens, tray actions, or notification
activation. macOS uses Electron's login launch signal; Windows registers an
explicit login argument. Existing system login preferences are not changed on
startup. Reading a missing background preference defaults to off; unreadable
preferences show a problem, and startup keeps the window visible.

The hidden window still loads the shared application for native notifications.

The existing native notification refresh may check a disconnected local Computer
for a confirmed Service authentication failure, at most once per minute with one
check in flight. It uses the public CLI connection review and status, verifies
the signed-in account before and after the read, and never infers authentication
failure from a missing cloud heartbeat. Respect notification preferences and
notify once per incident; a confirmed reconnection rearms the notice. Activation
opens the existing Computer connection flow without changing credentials or
starting maintenance. Healthy Computers require no extra local probe. This
notification requires Desktop to be running and OS notifications to be available.

This page explains that closing keeps notifications available and quitting stops
desktop notifications, while Service and accepted local work remain independent.
Global shortcuts and Service lifecycle controls remain separate. The Desktop
Power section reuses the Local Computer setting and API. The independent
Service owns its saved preference and task-scoped sleep prevention; Desktop
does not hold an Electron power-save blocker.

Window chrome, traffic-light insets, drag regions, tray, and native capabilities
belong outside the shared content shell. Reuse `packages/ui` for primitives;
do not move business rules into that package.

## Local pilot foundation

### Native Inbox notifications

Native updater observations use the account-scoped Inbox source contract. Main
keeps its installation identity under its existing userData directory, reports
only trusted updater/app-version facts, and fences each report to the observed
account. This source is independent of the currently selected Organization.
The renderer cannot submit an update observation or installation result. Its
credential proxy rejects the observation endpoint before attaching the Main
session, including encoded paths; Main reports directly through its private
cloud transport. Origin and session checks alone do not establish native source
authority. Failed Inbox writes retry independently; native updater execution
remains available.
Only current production updater-supported installations produce live observations;
isolated tests use the same observer with captured native state inputs and must
not be reported as actual production update/install evidence.

Account message-notification defaults and conversation overrides apply to
Desktop as well as Web. The shared API-client notification policy evaluates
ordinary messages, Human reply markers, and mute consistently. Native delivery
re-reads the authorized conversation preference with its own credentials before
showing the notification; renderer eligibility cannot bypass a saved mute.
Desktop retains its installation-local delivery and sound switches and native
acknowledgement. **Show an example** uses the native test path on Desktop.

Running Desktop delivers eligible Core Inbox items independently of Web's
notification permission and preferences. The shared client listener owns the
feed, first-page baseline, bounded pending recovery and delivery receipts.
The native process supplies the existing ten-second cadence through a refresh
signal, so hidden-window timer throttling does not suspend that feed. It does
not disable Chromium background throttling or change document visibility.

`pilot-notifications.ts` accepts only a schema-validated Inbox reference or a
fixed test request from the trusted current window. It rereads Core with native
credentials and checks current account identity before creating a Notification;
clicks recheck access and identity again. No renderer-supplied notification text
or external URL crosses this boundary. Session invalidation closes retained
notifications. Only native `show` settles a delivery; failures remain retryable.

Notification activation brings the existing window forward before the source
read completes. Main owns the single activation-time Inbox read and current
account check, then hands the validated structured source target to the bundled
renderer. The renderer uses the shared source-route mapper without fetching the
same Inbox item again; source endpoints still enforce their own permissions.
Later clicks and explicit renderer navigation supersede outstanding reads;
passive completion of the conversation already loading does not cancel the
notification target.
Preload retains only the latest unconsumed click while no listener is mounted,
clears it on session invalidation, and waits through updater navigation freezes.
This is an in-memory navigation handoff, not a notification store or a guarantee
of delivery while the native process is stopped.

Personal Notifications and Space Info expose the same installation-local,
account-scoped Desktop switch. Sound uses the native notification only. The
macOS permission state is unknown, not inferred from `isSupported()`. A test
notification confirms only native acknowledgement, not that a person saw it.
Notifications continue when the window is hidden and end when the GUI quits;
the independent Service has no notification responsibility.

On macOS, the menu bar icon shows the current Organization's Core-owned Inbox
attention presentation. Ordinary unread uses a compact monochrome dot within the icon,
without a numeric title. Priority attention shows `!N`, and unread Human mentions
show `@N`; both counts remain visible when both exist, capped visually at `99+`.
Modern summaries use Core's exact `priorityCount`, not every pending request.
Normal pending work remains a quiet dot when there is no numbered attention.
The logo and dot share one macOS template image with 1x and 2x representations;
AppKit owns contrast and selected-state rendering, not hardcoded white, custom
shadows or an application-theme approximation of the menu bar background.
The Inbox menu row and tooltip retain exact category counts. The tooltip breaks
out actions/reviews, urgent updates, mentions, and other
unread updates. Muted ordinary conversation updates are absent without becoming
read, while protected attention remains visible. Zero or unknown attention shows
no mark. This uses the shared summary query and existing native refresh cadence,
independently of notification delivery permission. The trusted renderer supplies
only a schema-validated categorized object and account scope; Main verifies the
native account before displaying it. Logout, account or Organization changes,
and stale asynchronous results clear or reject the previous attention. No
separate Inbox store, Service polling, Dock badge, or Windows behavior is
introduced. Tray creation applies the latest observed indicator even if attention
arrived first.

The macOS menu bar menu is the compact native entry to the current Desktop
workspace. It shows the newest eligible unread message as one preview, then
Open inbox, Open app, Computer, Settings…, and Quit OpenMeld. When Main's native
updater reports an actionable newer version, an update row appears
beside Settings and opens the existing native download/restart flow. Current,
idle, and unavailable builds keep that row absent. Opening the menu
does not mark anything read. Activating the preview re-reads that exact Inbox
item under the current account, restores the existing window, and navigates to
the exact message or Thread reply without acknowledging unrelated unread work.
Open app restores the renderer's existing route rather than choosing a new
home. The menu does not expose the version, a separate Web app row, or Service
lifecycle controls. Quitting the GUI retains the independent Service lifecycle.
The unread preview uses one bounded, whitespace-normalized native label rather
than a wrapping macOS sublabel. Main supplies compact display text; the native
menu retains ownership of layout, system appearance, and interaction. A complete
source-title and excerpt row stays intact when it fits the shared 48-unit budget.
Only an overflowing row limits the source to 12 units and gives the excerpt the
remaining space after the separator and ellipses. Wide Latin and non-ASCII
graphemes each count as two units. With no excerpt, the source can use the full
row; with no source, no separator appears. Short content receives no padding or
artificial minimum width and can lay out naturally. Relative time appears in the
existing disabled Latest unread heading; conversation context stays in the full
accessible label.

AppKit owns the final content-sized menu width. These conservative text units
are an OpenMeld formatting heuristic, not an official platform value or a pixel
maximum for the whole menu. Other menu items, fonts, and system layout can
establish a natural width floor. Computer status and update attention stay in
their labels rather than native badges, which reserve a right-side column across
the menu. Check the rendered menu against the available screen width; the
preview should use that width without making the menu disproportionately wide.
No custom minimum/maximum-width window is introduced. The full preview remains
available in the tooltip and accessible label. Truncation preserves grapheme
boundaries. The Computer icon uses green for a connected Computer, gray for an
offline Computer, and amber for other statuses. The Web status reason supplies
this presentation tone, without making Desktop a second status owner.
The native menu keeps its current snapshot while open, so a refresh cannot
retarget a row under the pointer.

The A1 foundation is opt-in with `OPENMELD_DESKTOP_PILOT=1`. It requires a
dev-local or canary lane and a configured loopback Web endpoint. Production
endpoints are rejected. The ordinary status/control renderer remains available
while A2 connects the shared Space entry.

Set `OPENMELD_DESKTOP_RENDERER_DIR` to the matching Web build's `dist/client`
directory to load its `/desktop-shell` route from local files. Without it, the
native build opens the small foundation sign-in entry. Build Web with
`OPENMELD_DESKTOP_PILOT=1`; its loader-free shell is emitted as `_shell.html`.
Main checks the emitted `desktop-build.json` against its own build identity
before opening shared assets; missing or stale assets stop startup.
The local protocol serves this shell for application routes and hashes its
packaged inline scripts for CSP. It never enables arbitrary inline scripts.

- Native entry: `clients/desktop/src/main/pilot.ts`.
- Local origin: `openmeld-desktop://app`; assets are read only from the built
  renderer directory. No hosted HTTPS-origin impersonation is used.
- Renderer interface: `src/shared/pilot-bridge.ts`, exposed as
  `window.openmeldDesktop`: platform, session, browser sign-in, Desktop sign-out.
  The response schemas and origin constants live in `packages/schemas`.
  `onSessionChanged(listener: () => void): () => void` emits only an
  invalidation and returns its listener cleanup. It runs after the installed
  Electron plugin persists the successful token exchange cookie, and after
  owned sign-out clears local credentials. The renderer invalidates its shared
  native-session query and rereads it; it does not rely on focus timing for
  identity changes or maintain another session owner.
  Invalidation removes stale private query and persistence state but retains
  account-scoped Composer drafts until the authoritative reread confirms no
  session or a different account. Explicit sign-out still clears those drafts.
  Entry distinguishes an unknown/failed session read from confirmed sign-out.
  While a macOS session read is pending, the shared opening screen can show
  conditional system-prompt guidance before platform metadata returns. This
  notice does not establish a Keychain wait or session state, enable sign-in,
  or change credential protection. Resolved platform metadata keeps local
  mock-Keychain builds outside the installed credential notice.
  Manual Retry and focus reuse the same serialized, revision-fenced revalidation;
  native session changes supersede older reads. A confirmed native session is
  shared through the renderer's TanStack Query cache for 30 seconds of same-account
  navigation, so child routes do not wait on a fresh remote session read for
  each click. After that window, a confirmed signed-in session is
  stale-while-revalidate: navigation proceeds while the session is reread in
  the background, and only a signed-out or different-account answer clears
  account-scoped data and returns to this entry with the validated workspace
  path. A failed background read keeps the page. Without a confirmed signed-in
  session, or before the Desktop frame mounts, navigation waits for the native
  answer. Native invalidation clears that cache immediately; focus and
  Desktop entry force a remote recheck. Server requests remain authoritative for
  access and mutations. Temporary workspace failures do
  not initiate browser sign-in or repeat an already handled account invalidation.
  Failed protected-route session reads return to this entry with the existing
  validated workspace path, query, and hash, without clearing account data.
  Confirmed missing Organization membership retains the shared explicit error
  rather than selecting an Organization or automatically retrying.
  Its Space stream methods open a subscription by ID/Space/Profile, send only
  the existing keepalive ping, close it, and deliver transport events. No URL,
  credentials, or business-write frames are accepted.
- Existing `window.openmeld` remains the CLI-backed local control interface.
  Every channel validates the owning WebContents, top frame, and local document
  before invoking a handler. Other windows, frames, and remote documents fail.
- Main retains context isolation, sandboxing, and disabled Node integration.
  New Electron windows and renderer-initiated document navigation are denied.
  A validated HTTP or HTTPS link without embedded credentials opens in the
  system browser instead; malformed links, custom schemes, and credentialed
  links remain denied.

Native tray Open Settings, app-menu Settings, and Command-comma share the existing
window destination action. Main restores/focuses the window and waits for its
document to load; preload retains the latest intent until a renderer subscribes.
The authorized shared App Settings dialog consumes that intent through
`useAppSettings`, preserving the current route, search parameters, draft and scroll
context. No separate Settings page or account bypass is introduced: before an
authorized workspace mounts, the existing sign-in entry remains in control.
Settings intents respect the updater's document interaction freeze.

Visible product copy calls the application OpenMeld. The production installed
folder is `OpenMeld.app`. App ID, callback scheme, user-data directory, and
update channels keep `sh.openmeld.desktop` / `OpenMeld Desktop`. Do not change
the installed folder name again: Squirrel.Mac relaunches from the previous
folder and cannot install across that rename.
Earlier signed installs used `OpenMeld Desktop.app`. Desktop's account menu
includes Open web app; it opens the equivalent authorized Web route in the
system browser.

The cloud response allowlist includes `x-openmeld-request-id` and `Server-Timing`
for shared diagnostics. It still strips cookies, credentials and unlisted headers.
Renderer abort is not claimed to cancel forwarded cloud work: an isolated
Electron 44.3.0 protocol GET probe, waiting for response headers, observed renderer
`AbortError` while its protocol Request signal and upstream response stayed open
for the 250ms observation. This is not a claim about every Electron path or
server-side execution cancellation. Electron 44.4.1
source still constructs that Request without a cancellation signal. A trusted
request/cancellation association needs a separate design; no inert signal plumbing
or cancellation of mutations is added here.

Better Auth's matching Electron integration owns PKCE/state, system-browser
return, and encrypted cookie storage. Auth enables its additive Electron plugin
only in development. `/desktop-sign-in` uses normal Web login and an explicit
Continue in Desktop action. Main registers page and auth scheme privileges in
one Electron call, owns OS callback delivery, and passes callbacks to the vendor's
public `handleDeepLink` API. SDK scheme registration, unrestricted IPC handlers,
and the global CSP hook are disabled. Credentials never cross the
renderer bridge. Storage is scoped to the configured Web origin.
Computer authorization uses the CLI environment's device-auth client ID, keeping
the grant and its CLI exchange aligned in isolated development lanes. A signed-out
CLI is unconnected; only a present, different account is an account mismatch.

Space video reuses this native cloud transport. The request allowlist forwards
Range and If-Range; responses retain range/length, ETag and disposition while
stripping cookies and credentials. For successful file-content GET/HEAD only,
the SDK response hook keeps the undrained original and supplies an empty response
with identical headers to the SDK parser. The Electron integration still owns
cookie renewal. This avoids cloning or waiting for the entire movie before
forwarding headers; other requests retain existing parsing. It does not extend
the renderer-abort guarantee above.

Desktop sign-out revokes the Desktop session; it does not run CLI logout.
The pilot exposes the independently read CLI account ID for comparison with its
cloud session. This comparison is display evidence, not the mutation fence.
The existing Computer surface offers Service Start/Stop only when the installed
CLI and actual platform carrier positively advertise account-checked control.
macOS requires its binary carrier; Windows requires the exact Node executable
and verified active JS entry.
The renderer sends the displayed account as immutable intent. Main verifies the
current native session, then passes that same account to the CLI admission owner.
An account change never retargets an operation. Stop has no GUI execution timeout;
the existing controlled shutdown owns drain and final completion.
Generic CLI login/logout, upgrades, autostart and agent mutations remain refused,
and tray Service controls stay hidden. Computer connection uses the bounded
native operation below; it does not reopen the old npm installer or unscoped
five-minute Setup wrapper.

### Computer connection

Owner Computer cards offer browser update/reconnect handoff through the existing
`openDesktopWeb` capability and shared Connect route builder. They carry the
Organization, stable Computer ID, fresh-session intent and supported update
action, never credentials or a new local lifecycle command. Unselected or
unresolved targets stay in the existing selection flow. Instructions name the
viewed Computer: opening a browser on this Mac does not select this Mac as the
machine to repair. Browser authorization is independent of Desktop's session.
Team cards stay read-only; ordinary Web controls remain in place. Pending opens
are bounded to the displayed account scope, Organization and target; they do not
apply feedback to a replacement card.

The shared Connect flow, including New Agent's embedded recovery, offers a
fixed `connectComputer` operation in Desktop. Its strict request contains the
displayed account, optional Human Profile/Space/Computer targets, fresh-session
intent, source navigation action, and supported Tools update action. Main validates its
current native account, reads the CLI-owned `computer connection-review --json`
projection, and reuses an account-aligned existing Service when that projection
positively identifies it. Reuse selects its actual device/lane; it does not
claim Agent Wakeability or rewrite a Computer session.

Fresh-session requests (including New Agent recovery), Space targets and source
navigation actions bypass that reuse shortcut. Source actions enter the existing
Prepare request unchanged. A requested `connectedComputerId` also bypasses reuse and
enters Prepare unchanged: Core validates account ownership, and the existing CLI
executor enrolls the current Service against that stable Computer identity.
New Agent must not derive this reconnect intent from a sole enrolled Computer,
account routing, a catalog selection, or a completed browser handoff. Ordinary
native connection leaves the target unspecified so the CLI uses its own Service
identity. The recovery picker (shown even for one saved Computer) and an explicit
session intent can select an existing Computer; the same resolved intent drives
both embedded setup and its recovery link.
Space recovery uses this native owner, keeps the Human Profile, Space, requested
Computer and source action, refreshes the existing recovery queries, and returns
through the shared completion target. Main rejects a returned profile/Space or
requested Computer device/lane mismatch before authorizing CLI setup.

The optional `updateComputer` bridge capability uses the same native operation,
progress, account fences and strict request schema with `serviceAction=update_service`.
An update for an explicitly selected Computer requires a successful trusted
CLI connection review before any installation. A missing CLI or obsolete
connection-review command returns normal Desktop connection guidance without
installing; ordinary first Connect retains automatic acquisition.
After review and account-switch approval, main validates the selected Computer
against authenticated inventory before acquiring the current verified managed
binary. It joins an existing update with `computer wait-for-update --view agent`
before creating the short-lived Prepare token and device grant. Older CLIs that
explicitly reject this command or return the exact parent `computer` help are
upgraded through the same verified installer. Help can name the lane's absolute
CLI path. Other unexpected output, identity failures, and authorization failures
never trigger that compatibility branch.
Main rechecks native account, local session identity, and selected device/lane
after waiting. It validates the newly returned Prepare targets before creating
the grant. It bypasses connection reuse. The CLI owns
Service update joining and installed-version verification before `setup.complete`;
Desktop requires both that command success and completed Prepare before returning.
It does not introduce a second Service updater or cloud readiness authority.
Older Desktop without this capability retains the explicit original Web update
route and cannot report native update completion. Once Prepare exists, later
authorization, account, execution, or snapshot failures retain its diagnostic
correlation ID.

Waiting progress uses the shared `waiting_for_current_work` phase and the
Service's `service_update_readiness` accepted-work projection. Desktop displays
that tasks must finish, setup will continue automatically, and tasks can be
stopped in their Spaces. It does not infer work from the durable `updating`
phase or own a second task counter. The CLI observer takes no setup lock and
has a fixed 30-minute observation limit. At expiry Desktop reports that tasks
and the background update continue, with a check-and-retry action. No Prepare
credentials have been acquired and no running task is stopped by that limit.

For ordinary Connect, when the managed CLI is absent or lacks the connection
contract, main downloads the managed binary manifest and the Apple silicon or
Windows x64 artifact. Production App origins `https://app.openmeld.ai` and the
retained `https://openmeld.ai` both use the fixed public CLI distribution at
`https://openmeld.ai/cli/manifest.json`. The App hostname does not relocate the
published artifacts. Other lanes retain their own Web origin.
The isolated `dev-local` lane may use its configured CLI binary server on
`127.0.0.1` at `OPENMELD_CLI_BINARY_DEV_PORT`, only when Web also uses a local
HTTP origin. Manifest origins must match the selected distribution origin,
apart from that exact local development exception. Artifact origins must match
the selected manifest origin in all cases. Redirects remain disabled.
The shared `@openmeld/local-service/cli-binary-update-artifact` implementation
verifies transport and executable hashes and the production signing identity.
The verified binary's `install-self` owns installation. No Node/npm prerequisite,
arbitrary renderer executable, URL, path, or shell command is accepted.

Contract impact: ordinary connection payloads are unchanged. The optional update
action is emitted only through the new bridge capability, so older native strict
readers never receive it from a newer renderer. Old renderers keep their ordinary
Connect/Web update paths with new main. Core/Gateway Prepare, CLI setup, Service,
Skills, Space actions, diagnostics and contract epochs retain their wire contracts.
No required-client floor change is introduced. The Desktop/shared source change
still requires the final packaged-artifact and local-component audit; source tests
do not certify installation or mixed-version behavior.

Windows uses the same managed installer, with a separately verified native
process companion and Authenticode publisher. Electron is never the background
Service runtime. The installer owns equal/newer-version arbitration; Desktop
uses its shared `cli.install_self` receipt for the next connection review and
setup, rather than rediscovering an older npm command from inherited PATH.
Subsequent reads use the lane's stable `bin/openmeld.exe` launcher. Desktop
maintains no parallel installation registry. No shell text, package name,
registry URL or executable is accepted from renderer input. CLI setup still
owns account/device identity, credentials and Service registration. ARM64
acquisition remains unavailable until separately accepted. Disposable acceptance
must use its fixed candidate and lane; production acquisition normally reads the
stable manifest. The native Windows x64 internal trial build reads only the
explicitly selected `windows-preview` manifest and enables its unsigned policy
only for that exact production URL. Its CLI acquisition still verifies size and
SHA-256. Signed Windows publication remains a separate release gate.

The read-only local Computer projection recognizes only the same bootstrap
conditions: a missing executable (`ENOENT`) or an exit-1 unknown `computer` /
`connection-review` command. With the native account unchanged across the read,
it returns the existing `unavailable` shape and explains that explicit Connect
will install or update OpenMeld Tools. It neither installs during a query nor
claims a connected identity. Other review failures, invalid output, permission
errors and authentication-read failures still fail closed. Connect retains its
own native account check, verified installer and post-install connection review;
the renderer's unknown-state guard is not relaxed. No IPC/schema change is needed.

Main creates the existing Core Prepare Session and uses the shared API client's
Device Authorization sequence with its authenticated native SDK transport. The
grant creates an independent Computer session in the CLI; native cookies never
become CLI credentials. A different known account requires a native confirmation
dialog. Its intent names the exact reviewed old session identity and new account;
CLI checks both before entering its existing locked commit/rollback flow.

Setup runs without a GUI execution timeout, in a separate process group with
file-backed output. GUI exit does not stop it or the OS-managed Service. The
existing Prepare continuation journal and maintenance worker retain recovery
ownership. Completion requires CLI `setup.complete` and a completed Core Prepare
snapshot; errors retain a shared local-machine action and diagnostic correlation.
Main also retains the current native connection operation and its eventual
result in memory for the signed-in account. A connection page opened after the
operation started adopts that operation through bounded IPC observation; it
never starts a second `connectComputer` call. Pending and settled events share
the operation identity, while account changes, sign-out, and retired operation
IDs reject late progress. The main-generated operation ID remains stable across
initial pending, CLI progress, and settlement; the CLI progress ID stays nested
inside the operation. A confirmed native result can be presented immediately;
the page refreshes the authoritative Computer projection before completing its
continuation. Independent cloud-directory refresh does not hold that continuation.
Refresh failure is a separate display warning, not a failed native operation.
Restoration of the previous account does not replace the original account-switch
failure.

The standalone connection page reads the same native account-aligned Computer
projection as Working folder selection. A confirmed standalone connection shows
Connected and a primary **Create an Agent** action. It opens the shared New Agent
page inside Desktop, where **Choose a Local Agent** is selected by default and
the existing Computer and local-agent selection owns the eventual Binding.
It does not create or connect an Agent merely by opening the page. Disconnect
this Mac and the optional Web progress link remain secondary actions. The
confirmed standalone state describes Agent creation as the next step; embedded
Continue retains its existing connection reassurance. Connection reads in progress,
including background checks of cached connections, withhold the next step.
Pending operations, stale/unconfirmed connections, failed connection reads,
connection refresh warnings, or account-mismatched connection states do not
offer this next step. A successful Check connection that confirms this Mac restores
the action even when a previous Disconnect failed; its diagnostic context remains
available. Embedded recovery and explicit reconnect/update keep their existing
completion actions. The account menu's Computer entry
opens the native account-aligned device's Computer details when connected, and
the connection page when no local connection is available. A browser-selected
remote Computer never replaces native device identity for this entry. The
connection page preserves the originating Human Profile for Back. New Agent recovery retains
its explicit connection intent instead of offering Disconnect.
The toolbar and account-menu Computer entry use this same native destination
without a fresh-session request, regardless of browser Computer selection.
Connection presentation is independent of Disconnect eligibility: embedded flows
show an existing connection and Continue without running Setup, while an explicit
reconnect shows Connected and Reconnect this Mac only while Core reports a live
session for the exact native device/lane. Native identity availability alone
does not establish a connection; a stopped Service offers Connect this Mac.
After confirmed completion, the
standalone route consumes its one-time fresh-session and Computer-target intent
and returns to ordinary connection management. Failed or cancelled operations
retain that intent for recovery.

Disconnect requires a native confirmation. The fixed `computer disconnect
--connection-intent <json> --view agent` command carries the displayed account
and exact reviewed local session identity. The CLI reuses account-admitted Stop,
waits for its controlled active-work drain, and then clears only that reviewed
CLI session under existing lifecycle ownership. Desktop remains signed in and
the cloud Computer record remains. A refused or unconfirmed Stop never clears
credentials. A changed account or same-account replacement session cannot be
stopped by stale reviewed intent. Retry can finish credential cleanup only after
the matching Service owner's stopped intent and verified runtime absence.
Connect can enroll this Mac again; Forget is never required for account switching.

The optional `disconnectComputerWithFeedback` bridge capability returns a strict
shared result: `cancelled`, `disconnected`, `connection_changed`, `failed`, or
`unconfirmed`. New callers include the displayed device/lane as
`expectedConnection`; main compares it with the account-aligned CLI review before
confirmation. Independent account and connection reads run together, but the
native account/session revision is checked again after confirmation and the CLI
still admits the exact reviewed session under its existing lifecycle lock.
`checking`, `waiting_for_confirmation`, and `disconnecting` are emitted at those
real code boundaries; they do not infer which Agent is draining.

Connect and Disconnect share the existing main-process operation record and
exclusion boundary. Disconnect replaces retained connect success at dispatch.
`computerOperationCurrent` and `onComputerOperation` expose a strict union on the
existing operation IPC channels; no new Service owner or operation registry is
introduced. Sign-out clears presentation, not accepted work's exclusion; late
settlement cannot repopulate the new account's record. The original connect-only
observers ignore Disconnect records. The original `disconnectComputer` method
still returns a boolean for cancellation/success and throws for all non-success
failures; an older renderer never receives a truthy error object. A renderer on
an older bridge uses that original method and honest generic waiting copy rather
than inventing stages. Rich feedback and resumption require the new bundled
main/preload; the normal Desktop renderer fingerprint gate remains unchanged.

Only a successful CLI exit plus `computer.disconnected` completion evidence
confirms disconnection. Explicit Stop refusal is a known failure; a timeout,
missing terminal event, failed transport, or post-admission ownership change is
not proof of success or proof that nothing stopped. Such unconfirmed results
require an explicit status check before another mutation, never automatic
restart, repeated Disconnect, or force kill. User-visible diagnostics contain
only a bounded code, correlation ID, and the existing redacted generated file
path. No raw CLI output or arbitrary file/URL execution channel is exposed.


Setup progress comes from actual CLI agent-output stages. Percentages are shown
only for a measured byte transfer, never for overall setup or a GUI deadline.
Download byte observations are coalesced to a bounded UI cadence while stage
changes and the final byte count remain immediate. Optional progress callbacks
are isolated from download, verification, installation, and setup control.
Failed setup retains its original subprocess error and any
blocked Prepare step even if the final snapshot read fails. A private temporary
diagnostic file retains the last 100 parsed events, with bounded, redacted
messages; raw output is removed on completion. The UI exposes its path alongside
the Prepare correlation ID. These diagnostics do not establish an incident's
root cause without the failed operation's evidence.

Signed production previews use `desktop:package:production-preview` and the same
installed build pipeline as local acceptance. macOS retains the existing
Developer ID/Keychain notarization. Windows uses native per-user NSIS with an
explicitly configured Authenticode identity. Production preview requires the
exact clean merged release SHA and rejects disposable settings. Its signed source
record binds the release SHA, production identity, and renderer fingerprint;
publication uses the immutable
candidate workflow in [Development Workflow](../engineering/development-workflow.md#desktop-preview-release-workflow).
Building and uploading do not select a default update. Website offers an account-free
page at `/downloads`, with an immutable `/downloads?candidate=<hash>` override.
Existing `/desktop` page links redirect there without changing the selector.
An explicit promotion selects the default download and update feed together.

### Windows package and release boundary

Windows x64 and ARM64 are separate installer and update targets. NSIS installs
for the current user without requesting elevation and preserves application data
on uninstall. Desktop installation/uninstallation does not install, stop or remove
the independent OpenMeld Service. Connecting this Computer remains an explicit
CLI-owned action. The accepted Windows x64 managed bundle does not require an
external Node.js, npm, Bun, or .NET installation.

Root packaging commands use portable JavaScript, not POSIX inline environment
assignments. Windows packaging skips Mac icon/notarization tools. Unsigned
packages ordinarily use disposable acceptance. The separate native Windows x64
internal trial package uses the production account target so an existing
same-account Computer can be reviewed, but it has no production update feed and
must be distributed only to known coworkers. It is not a signed production
preview or proof of ordinary-user installation.
Production requires the exact clean, approved, merged source and
`OPENMELD_DESKTOP_WINDOWS_PUBLISHER` matching the actual certificate. A missing
signer is not replaced with the Apple team identity.

Before publication/promotion, native Windows inspection verifies Authenticode
on both the NSIS installer and its extracted application. Full 7-Zip with NSIS
support is a release-workstation prerequisite, not shipped runtime machinery.
Inspection never executes installation. It checks the signed payload's PE
architecture, package version, production target, source/renderer records and
updater publisher/feed, then confirms the installer hash has not changed. A
neighboring unpacked directory or sidecar file is not signed-source evidence.
Commands live in the existing Desktop release workflow. These code guards are
not proof that a signed OpenMeld Windows artifact has been built or accepted.

### In-app updates

Production builds use electron-updater 6.8.9: MacUpdater for macOS and NsisUpdater
for Windows. Main owns the update snapshot;
the shared renderer's Updates section, Settings indicator, notice, and native
Check for Updates menu consume it. The native entry is independent of cloud
admission and sign-in. Development and disposable packages cannot update from
the production feed. Renderer IPC accepts only check, download, cancel, and restart
actions, never an origin, file path, or installer arguments.

Main advertises `canCancelDownload` in its local snapshot. The shared Web UI
shows Cancel download only when that capability is present, including while
the original download IPC request is pending. Main passes electron-updater's
public cancellation token to the transfer. User cancellation returns to the
available update; 90 seconds without download progress produces a retryable
download error and a bounded diagnostic. Ongoing progress resets that timer.
Cancellation does not install an update or restart Desktop. Pause/resume is not
part of this contract.

Production artifact requests retain the stable Web download/update URLs. After
validating release metadata and object size, Web returns an uncached 307 to
`downloads.openmeld.ai`. That R2 custom domain serves immutable candidate
installers and update archives with byte ranges, edge caching and Smart Tiered
Cache. The release pointer and update feed remain uncached and Web-owned.
Development/staging without a download origin retain their own bucket streams.
The unsigned internal Windows trial route retains its existing delivery path.

The custom-domain WAF rule permits only GET/HEAD for the candidate artifact
names generated by `desktopCandidateLocation` and
`desktopCandidateUpdateArtifact` (macOS arm64 ZIP/DMG and Windows x64/arm64 EXE).
It blocks metadata, CLI keys and all other paths. Keep the R2 development URL
disabled. Install this restriction before connecting any replacement domain.
The domain, cache eligibility rule and Smart Tiered Cache setting are provider
configuration; `env.prod.vars.OPENMELD_DESKTOP_DOWNLOAD_ORIGIN` selects the
verified domain in Web. A CDN change must verify artifact 206/Content-Range,
cache HIT, and metadata rejection before release.

Windows activation validates the installed source receipt and `app-update.yml`
against the actual architecture, fixed platform feed and exactly one configured
publisher. Missing or mismatched metadata makes updates unavailable. The public
NSIS verifier hook requires successful Authenticode evidence and an exact
publisher match; missing PowerShell, errors, unsigned executables and unexpected
output all reject. The verifier lives in
`@openmeld/local-service/windows-artifact-signature` and shares its publisher
schema with CLI acquisition; Desktop does not maintain another OS verifier.
External metadata URLs, another platform's payload, multiple
files and web installer packages are rejected before download. Manual download,
draft-safe restart and independent Service lifetime remain unchanged. Actual
signed A-to-B updates, normal-user installation/uninstallation and native DPI/IME
behavior require separate Windows acceptance.

Desktop Settings places Updates after Privacy & Safety in the Personal group.
The outer Settings control and inner Updates item consume the same native-derived
attention policy and existing unread-blue indicator. Opening Settings, viewing
Updates, or choosing Later does not acknowledge installation or clear attention.
Checking and check errors retain attention only when Main still reports a target
version. Idle, current, unavailable, preparation, installation, and terminal
installation errors do not show an ordinary pending-update dot. These indicators
are independent of Inbox counts and do not appear without a Desktop bridge.

Updates is status-first: the result and explanation are on the left, one existing
primary Button (`variant="default"`) is on the right, and `currentVersion` remains
secondary information. A container query stacks the action below the result in a
narrow pane. The corner Surface uses an unread-blue Updates heading, a muted
keyboard-accessible Later action at top right, and a full-content-width primary
button. It never takes focus from ongoing work. Both layouts consume
`desktopUpdaterPresentation`; product policy stays outside `packages/ui`.

An unknown snapshot is not an up-to-date result. An initial bridge read failure
keeps the existing safety freeze and explains native Quit/reopen recovery; a
newer native event supersedes a late initial answer or failure. Progress is
indeterminate when Main has no percentage, and 100% while downloading does not
authorize restart. Only native downloaded state offers Restart to update.
Check, download, and restart errors offer their corresponding native action;
terminal installation errors never offer a renderer action. Rejected IPC calls
show a transport failure without manufacturing native success.

Later dismisses only a meaningful version/phase/error-stage identity for the
mounted renderer session. Progress ticks, repeated checks, and retries through
an already dismissed identity do not create a notice loop. A different version,
verified completion, or a new error stage can surface again. While the actual
Updates section is mounted, ordinary corner notices are hidden without being
dismissed. Required preparation, installation, terminal-error, and initial-read
failure guidance is never suppressed by that visibility rule. No new polling,
automatic checking on Settings mount, or persisted update authority is added.

The isolated component fixture and repeatable visual checks live in
`clients/web/tests/desktop-updater-visual/`. Its updater bridge is synthetic and
never contacts a feed or installs anything. Component screenshots and native
controller tests are not signed-package A-to-B acceptance.

Launch and hourly checks run automatically. Both `autoDownload` and
`autoInstallOnAppQuit` are explicitly false. Download requires consent; after
checksum verification the user chooses Restart to update or Later. On macOS the
downloaded ZIP is not handed to Squirrel until Restart to update, and only when
the running production bundle is the stable `OpenMeld.app`. Missing, legacy
`OpenMeld Desktop.app`, or unknown bundle paths fail closed before
`quitAndInstall`; the app does not attempt a second custom installer. Later
therefore neither installs on ordinary Quit nor silently installs on the next
launch. A subsequent launch checks again; a requested download can reuse the
verified cache.

The legacy rename cannot be repaired transparently by code shipped only inside a
new `OpenMeld.app`: an already-installed `OpenMeld Desktop.app` executes its
old updater before it could receive this fix. Those machines require a one-time
recovery by opening an already-installed valid `OpenMeld.app` or installing the
current signed DMG. After recovery, ordinary same-name updates remain on Squirrel.

Before a same-name macOS install is requested, Main writes a bounded local receipt
at `<Desktop userData>/desktop-update-install-receipt.txt` containing only
source/target versions, source/target bundle names, and phase. The newly launched
version changes `install_requested` to `application_started` only when its own
Main process starts from the expected `OpenMeld.app` and target version. This
evidence diagnoses future post-exit updater failures without collecting user
content and without replacing Squirrel's signing/install authority.

Restart freezes document editing, flushes active text through the existing
composer draft owner, and refuses while navigation guards, pending sends,
attachment writes, failed attachment persistence, or unfinished uploads block
leaving. Normal messages, Threads, and Center Agent text use `useComposerDraft`;
file blobs and upload references retain their existing shared Web IndexedDB
owner, including scoped recovery after a renderer remount. New Center Agent chat
file selections use that same account-scoped owner and block restart until sent
or removed. Center Agent handoffs read their existing pending-message owner and
also block restart. Pending
send acknowledgements remain with existing reconciliation: updating never
resends a message. The current workspace URL is retained for the normal router
to authorize after relaunch. Native credentials, account data, and app identity
are not reset. Failed preparation restores editing. After explicit restart consent
and successful preparation, native installation is irreversible within that process:
MacUpdater has no public cancellation of its pending native install callback.
Installation errors, repeated errors and late download events keep editing frozen
and `isQuitting` true. Reloads/remounts freeze before reading the native snapshot
and retain that freeze for installing or installation-error states. The visible
failure directs the user to the native app menu's Quit action and then reopening;
the already-authorized update may complete during quit. Do not restore close-to-tray,
offer Later/retry, or claim installation succeeded. Native menu and Cmd+Q remain
available. Installation affects the GUI only and
does not call, update, stop, or reconfigure CLI or OpenMeld Service.

Update failures also write the latest bounded record to
`<userData>/diagnostics/desktop-update-failure.json` with owner-only file access.
It survives restart and a successful retry. Check for Updates offers Show update
details when the record exists. The record includes time, stage, versions,
native error code, HTTP status, and a safe classification. Raw exception text,
URLs, headers, response bodies, and local paths are never persisted. Unknown
errors remain explicitly unclassified. Diagnostic writes cannot block updates.

### Installed A-to-B release acceptance

Every macOS Desktop production release gets one **thin real A-to-B smoke** on
the local release Mac. The release owner runs it; it is not a per-PR/per-commit
test and it does not belong in GitHub Actions. The point is to exercise the same
installed app, Launch Services, native updater, signature trust, and relaunch
boundary that a real user receives.

The current production app reads only the promoted updater feed, so the real
production-A -> production-B transition happens immediately after the separately
authorized promotion. Until a candidate-feed updater path exists, this is a
post-promotion release-acceptance gate, not a pre-promotion gate.

Use the lightweight helper around the real in-app update:

```sh
node scripts/e2e/desktop-macos-production-update-smoke.mjs before <A-version> <B-version>
# separately authorize/promote B
# in the already-running A: Settings -> Updates -> Check -> Download -> Restart
node scripts/e2e/desktop-macos-production-update-smoke.mjs after <B-version>
```

The `before` phase opens A only when it is not already running and verifies the
fixed production path, version, bundle ID, Apple Team ID, strict code signature,
stapled notarization ticket, Gatekeeper assessment, Apple-silicon host, and the
exact production executable. It also refuses a stale
`/Applications/OpenMeld Desktop.app` so the release Mac has one unambiguous
production app.

The `before` phase also records A's exact production-process PID(s) in a
user-local macOS temporary smoke-state file. The `after` phase **never opens B**: it requires the
production PID(s) to be replaced, then verifies B's version and the same native
trust facts. This prevents a surviving A process from being mistaken for a
successful B relaunch merely because the on-disk bundle changed. If the bounded
updater receipt exists, it must confirm the expected target version and
`application_started`; absence is tolerated for a production A that predates
receipt instrumentation. This keeps the recurring release smoke short while
still proving the failure boundary that this incident exposed.

Record the exact A and B versions, release SHA/candidate, promotion evidence, and
the helper's before/after result. A release is not considered accepted until the
thin smoke passes. Failure preserves the promoted/source evidence for the normal
release recovery or rollback decision; do not hide it by manually reopening B.

Run the **expanded updater acceptance** instead of only the thin smoke when the
release changes any high-risk update boundary, including:

- Desktop updater policy or native updater integration;
- Electron, `electron-updater`, or `electron-builder`;
- signing, notarization, Gatekeeper, or release packaging;
- `productName`, app bundle name/path, app ID, or callback identity;
- Restart-to-update preparation, draft/save/freeze behavior, or quit lifecycle;
- updater feed/promotion semantics that change which B the installed A consumes.

Expanded acceptance keeps the existing product matrix:

1. Install signed A and record its version plus the existing account,
   conversation, Service identity, and an independently running Wake.
2. Build signed B from its exact merged SHA, verify DMG/ZIP identity, upload the
   immutable candidate, and promote only through the separately authorized
   release path.
3. Confirm `/desktop`, legacy `/desktop/update.json`, and
   `latest-mac.yml` select B. Invalid/missing candidate overrides must not offer
   B as a fallback.
4. In A, check while signed in, signed out, with an expired session, and with
   cloud admission blocked. Confirm download still requires consent; interrupt
   the network and retry.
5. Download B, choose Later, close/reopen the window, switch Organizations, and
   verify an ordinary Quit/relaunch leaves A installed.
6. Exercise unsent Space/Thread/Center Agent text plus a persisted attachment.
   Restart during upload, pending send, or storage failure must refuse without
   resending or losing content.
7. Once work is durable, choose Restart to update. Confirm B, preserved account
   and conversation state, preserved text/attachments, unchanged Service/Wake,
   and the documented installation-error behavior.

The historical `OpenMeld Desktop.app -> OpenMeld.app` incident remains a
separate regression/recovery scenario. New code cannot be delivered backward
into an already-installed legacy updater before that updater crosses the rename,
so the recurring production smoke uses the stable
`OpenMeld.app -> OpenMeld.app` path.

Production resolves the existing `~/.openmeld` managed installation. An installed
disposable build must compile its already aligned test lane using
`OPENMELD_DESKTOP_TEST_COMPUTER_HOME`, `OPENMELD_DESKTOP_TEST_AUTH_ORIGIN`, and
`OPENMELD_DESKTOP_TEST_GATEWAY_ORIGIN`. The build rejects the production home and
non-loopback test endpoints. These native-only values never enter the renderer
bridge or come from its launch environment. A build without that configuration
cannot connect a computer; it never creates a separate GUI-owned Service home.
The explicit `desktop:package:acceptance` entry requires all three values before
staging or building. Direct acceptance builder invocation enforces the same
build-time validation before signing or notarization.

Computer pages retain the shared connection and per-local-agent projections.
Native background controls are folded and appear only for a positively matching
device. Missing, unreadable, and explicitly different accounts remain distinct;
unavailable control capabilities are not evidence of an old version. A global
Connect this Mac action does not identify a selected remote Computer as local.
The shared Local agents cards include Antigravity alongside Codex, Claude Code,
Grok Build, OpenCode, and Cursor, using the same canonical order and the same
status, enablement, Usage, and details projection as Web. Desktop does not keep
a second Local Agent catalog or infer readiness from whether a logo is shown.

This pilot restriction applies to the shared Computer presentation and cloud
transport as well as native IPC. `canConfigureLocalComputer` removes unsupported
configuration actions while retaining reported status, details, and a Web handoff.
`pilot-local-control-policy.ts` rejects the exact Gateway method/path families
before attaching credentials: current and explicit Computer updates, local agent
configuration, maintenance, file access, general local Project controls, enrollment,
rename, current-Computer forget shortcuts, and Prepare mutations. Catalog refresh is also unavailable in this
pilot; reading existing reports remains available. Ordinary Web and Space/Wake
mutations retain their existing contracts. These are pilot capability limits, not
new Core authorization rules.

Forget this computer is a separate cloud-account action available in an owned
Computer's details, using the existing confirmation and Core authorization.
Desktop admits only `POST /v1/devices/:deviceId/forget` with an explicit device
ID; it still rejects `/v1/devices/current/forget`. Forget removes the account's
record. It is not Service Stop or local CLI sign-out, and this exception grants
no local configuration capability.

Native Local Agent updates are also available in the shared Computer details.
Desktop retains authorized installation reads and admits the exact
installation-update GET/POST routes only for its native account-aligned device
and lane. Installation selection,
enablement, and catalog refresh remain Web-only. The shared Service updater owns
admission, vendor execution, and durable results; Desktop has no separate updater.

Working folder selection and Local Agent updates share one native target check.
Main reads the existing CLI
`computer connection-review --json --include-stopped` projection without installing or starting a
Service and checks its account against the Desktop session before and after the
read. The shared renderer uses that exact device and lane for folder selection,
Project discovery, connection, default-folder selection, and workspace saving.
Main independently rejects a different device or lane before attaching
credentials. A selected Agent on another Computer is not retargeted. The account's
current-Computer preference is never a fallback for these Desktop requests.
The explicit flag also admits a stopped, installed, account-aligned Service with
verified native start capability. Targeted recovery uses the same check. The
unflagged review still reports only a running connection, so ordinary Connect
cannot reuse a stopped Service as if it were connected. An older CLI that
explicitly rejects the command or its JSON/stopped options is retried without
the stopped flag. If the base review is unsupported, explicit Connect can
install current Tools and recheck identity. Authentication and
identity failures are never downgraded to compatibility retries.
Cancellation changes no draft; selecting a folder alone grants no file access,
connects no Project, and saves no workspace. The existing Service remains the
only local writer, and paths stay within the existing private control contracts.

After a positively acknowledged account-admitted Stop, CLI manager cleanup reuses
the completed drain instead of sending another shutdown to an exited carrier.
It rejects a different observed process owner; missing or failed drain evidence
does not enter this completion path.

The CLI prerequisite accepts `service start|stop --json --expected-account <id>`
for an already connected macOS binary or Windows npm Service. Its owning
admission contract is in
[Local OpenMeld Service](../architecture/local-openmeld-service.md#account-checked-service-start-and-stop).
This authorizes only existing-Service Start/Stop. Main rejects missing, changed,
unsupported or concurrent intent and preserves explicit CLI refusal or uncertainty.
`service control-capabilities --json` is a separate read-only query; it does not
extend the established strict status response. Version strings are not capability
evidence. Old or unverifiable pairs omit usable controls. Windows capability
requires the exact Node executable and verified active JS entry, plus explicit
support from an already running carrier; it never infers support from an npm
version or a successful unguarded Service command.

## Cloud transport and compatibility

Native admitted `/v1/` requests use the Better Auth SDK's public fetch pipeline
and return the original response status/body through the credential-stripping
adapter. `patches/@better-auth__electron@1.6.30.patch` moves only the vendor's
response-cookie persistence and session signal from `onSuccess` to `onResponse`.
The pinned upstream otherwise loses legitimate renewal on 403/500 and deletion
on 401. Successful session-data caching and existing error notifications remain
unchanged. There is no app-side cookie jar or private SDK hook invocation.
Remove this patch when an adopted upstream version processes these cookies
before status handling, after rerunning the expiry/recreation and error matrix.
SDK recreation in tests does not prove real macOS safeStorage or OS restart.

Shared Profile and Organization business actions use fixed Web `/v1/` adapters:
Profile capabilities, Human/Agent creation, Agent-only deletion; Organization
creation/settings, invitations and member management; invitation links, public
join requests and Space invitations. They reuse Auth HTTP/Core owners and shared
schemas, never generated mutation IDs or renderer Better Auth calls. Membership
recovery reads the existing account Organization context. Account security
handoffs and native cookie/session storage remain separate.

The adapters preserve the incoming Origin, reject redirects, project safe JSON,
and forward separate vendor Set-Cookie headers only at the server HTTP boundary.
Auth's trusted-cookie-origin guard remains authoritative, including the exact
development Desktop origin. Installed production trust remains a separate
native transport prerequisite; these adapters do not relax it.

`pilot-protocol.ts` owns a fixed-endpoint request adapter:

Its header allowlist preserves shared Inbox, Space addressing, Space access,
Space file origin, and image geometry capability negotiation. These version
headers select an existing response contract; they do not grant authorization.
Renderer cookies and authorization remain excluded.

File download responses preserve `x-openmeld-file-revision` for the shared
Space file reader. Local image previews use Blob URLs, which are allowed only
in the image CSP directive; script, connection, frame, and credential boundaries
remain unchanged.

`pilot-transport.ts` owns one private persistent Electron Session shared by the
BrowserWindow and protocol handler. Its partition lives under the existing
isolated application data directory, so shared Web appearance preferences survive
normal GUI exit. HTTP caching stays disabled. Shared Web account-scoped read
cache authorization and sign-out cleanup still apply; native authentication
cookies remain in the separate main-owned SDK storage and are never forwarded
to the renderer. Before the page loads, it installs that
Session's sole `webRequest.onBeforeRequest` listener. Every local `/v1/` and
`/_serverFn/` request requires Chromium's current live owner WebContents ID,
exact main-frame identity, and trusted local document URL. Missing provenance,
child frames, other windows, remote documents, and top-level API navigations
are rejected before forwarding. Electron custom-protocol HTTP source headers
are absent and are not authorization evidence. Renderer headers grant nothing.

Do not attach another before-request listener to this Session: Electron keeps
only the last listener. The transport is its exclusive owner, rejects duplicate
installation, and removes the authenticated protocol handler before disposing
the listener. The ordinary Web/browser and default Electron Session are unchanged.
Run `pnpm --dir clients/desktop exec node scripts/verify-pilot-transport.mjs`
for the real Electron admission/zero-upstream regression matrix in disposable
storage; it never invokes CLI, Service, login, or a real Wake.

- `/v1/*` uses existing shared HTTP APIs through the matching Web gateway proxy.
  Core/Space still authorize every request. This is the portable business seam.
- Profile listing, account Space index/active-Wake summaries, and profile-Space
  history writes use the same typed HTTP consumers as browser Web. History
  updates preserve last-seen, pin and removal behavior; protected Space password
  persistence remains a separate unsupported pilot path.
- These consumers read `GET /v1/client-environment` from the configured Web
  endpoint for its current normalized `gatewayHost`. An installed renderer may
  have been built in another local lane, so build metadata and the local app
  origin must never supply this history namespace. Missing or invalid metadata
  stops the dependent request. The response is not persisted or an authority
  for identity, access, routing or execution.
- The shared account query reads Auth's strict `/v1/account/session` display
  projection through the shared API client, preserving the Joined date, email
  verification, and existing name/avatar cache updates. It never reads a generated
  server-function ID or receives credentials. Native entry/session/account fences
  retain their existing narrow bridge; account changes still reset the existing
  account query cache before rereading.
- Read-only `/_serverFn/*` calls are a bounded pilot compatibility dependency
  for remaining Web entry and public-Space handoff loaders.
  Sidebar geometry reads the existing local browser-preference storage during
  client navigation, without a server-function call.
  Server-function mutations are refused;
  business writes must use the shared APIs.
- Generic Auth HTTP endpoints are not exposed to the renderer. Session management
  and account switching that return session tokens need a native adapter before
  entering the pilot surface.
- Main attaches its cookie only to the configured Web endpoint. It does not
  accept arbitrary URLs, credentials, file paths, shell commands, or redirects.
  Response cookie headers do not enter the renderer.
- Space live streams use the same fixed Web `/v1/spaces/:spaceId/stream`
  endpoint through native `ws`, with the main-owned cookie and build header.
  Redirects are refused. The preload sends only validated subscription events.
  Native close events retain the socket close code and reason through the
  bundled Main/preload/renderer IPC contract; the Web adapter emits a real
  `CloseEvent` so the existing shared consumer can refresh authority on code
  `1008` without a Desktop-only access state.
  Reload, renderer loss, native sign-in/sign-out, and GUI exit close native
  sockets; none of these operations stop the Service or a Wake.
  `clients/web/src/lib/spaces/live-transport.ts` adapts this transport to the
  existing Space feed listener contract. That shared feed still owns hello
  acknowledgement, keepalive, reconnect, invalidation and snapshot refresh.
  It does not replace global WebSocket or add a Desktop live-state system.
- The app origin is explicitly allowed by the development Auth configuration and
  pilot Web CSRF policy. CSRF is not disabled; Origin alone grants no authority.
- The Web server compares a content fingerprint from
  `scripts/desktop/web-build-identity.mjs` before handling Desktop requests.
  A mismatch returns HTTP 409 before the operation. The fingerprint covers Web,
  shared packages, lockfile, and the fingerprint helper, excluding generated
  route-tree output.
  Ordinary Web development/builds do not compute a pilot fingerprint. An
  unstaged deletion and the same staged deletion produce the same identity.

This is **not a production Desktop/Web compatibility contract**. Pilot renderer
and Web server must be production-mode builds of matching source; Vite's dev
server uses a different server-function registry. A later Web deployment that
changes the fingerprint makes this pilot fail closed. It cannot silently invoke
a different function or submit a write. Production distribution must replace
remaining build-coupled calls with durable API adapters or a versioned server
compatibility contract. Do not rewrite all Web server functions for this pilot.

A2 owns the actual shared Space entry, platform presentation, and one integrated
Web/Desktop smoke. A1 foundation/build checks alone do not prove a real Wake,
published reply, or Service continuation after GUI exit.

## CLI and Service control

Reuse the CLI's machine-readable status, setup, service, and agent commands.
Setup streams Agent View events and ends in `setup.complete`; its shared
`serviceGuidance` and LocalMachineIssue messages remain authoritative. Do not
classify raw OS errors or add Desktop-only repair/retry state.

Normal UI status refresh is read-only. Home and Settings Computers reuse the
same local-management surface. General owns GUI preferences; Computers owns
CLI-backed Service controls. Service autostart and GUI launch-at-login are
different preferences with different writers.

## Development lanes

Use repo-root commands, from the owning worktree, for both human and agent work:

| Command | Behavior |
| --- | --- |
| `pnpm desktop:web` | Start the existing isolated Web launcher in matching compiled-pilot mode. |
| `pnpm desktop:dev` | Prepare as needed, then launch this worktree's Desktop. On macOS this is a real `.app`, not generic `electron .`. |
| `pnpm desktop:prepare` | Prepare without launching; `--force` explicitly rebuilds. |
| `pnpm desktop:doctor --json` | Read-only lane/CLI, on-disk and running Web build, prepared-app and OS callback checks with actionable failures. |
| `pnpm desktop:status --json` | Report this worktree's exact process IDs, measured RSS, app path and build identity. No build or server startup. |
| `pnpm desktop:stop --dry-run` | Preview only this worktree's Desktop processes; omit `--dry-run` to stop them. Preserve Web, Service, credentials and drafts on disk. |

`desktop:start:dev` remains an alias. `desktop:canary` / `desktop:start:canary`
use the same entry with an explicit canary preset. Production reproduction with
`desktop:start:prod` still requires separate authorization.

Desktop owns its resource reservations: one short heavy-build reservation,
released before GUI launch, followed by a lightweight Desktop memory reservation.
An idle GUI does not occupy the heavy-work slot. Older `dev:run -- pnpm desktop:dev`
instructions delegate to this same owner; do not add extra wrappers. Repeating a
launch does not start a duplicate or rebuild beneath a running app. Stop your
Desktop explicitly before rebuilding; neither startup nor cleanup kills another
worktree. General `dev:status` and `dev:stop` include these owned Desktop processes.

`prepare` may work offline with matching compiled pages, but `dev` and `doctor`
verify that the actual loopback Web server serves the matching build marker.
They do not send credentials or follow redirects. A forced prepare while a GUI
or another preparation owns the worktree fails explicitly. Status also recognizes
an OS-launched copy of the exact generated app after its terminal owner has exited.

On macOS, prepared output is under `clients/desktop/dist/development`. The normal
electron-builder directory target uses the existing ad-hoc integrity/signature
policy; there is no DMG, Developer ID signing, notarization, upload or installer.
The warm path checks source/lane fingerprints and actual signed bundle integrity
before reuse. Failed or source-drifted builds never publish a reusable receipt.
This is a local convenience cache, not release certification.

Each registered `http://wt-<12hex>.localhost:<port>` origin has its own app ID and
callback scheme, derived once by the shared `desktopAuthIdentity` contract from
trusted configuration. Web, Auth, native protocol and bundle metadata agree; no
request parameter can choose the callback. The vendor client ID remains `electron`.
Distinct ports alone did not isolate the old shared `com.github.Electron` identity.
The launcher checks the actual macOS receiver, and native checks it again before
creating PKCE state. A mismatch fails with a diagnostic, not an endless browser wait.

The development app embeds only schema-validated non-secret lane coordinates,
so an OS URL launch cannot fall back to global/production state when terminal
environment variables are absent. It still requires the original worktree's CLI
and matching backend; it is not a distributable or relocatable application. PKCE
state remains process-local. If the initiating app exited, start a fresh login;
never replay a callback or share verifiers between processes. Only one Desktop
app at a time uses a given worktree. Other worktrees have independent schemes.

These commands align CLI, home, auth, Gateway, and Web. An isolated worktree must
use its actual aligned URLs and OS Service identity, not production state with
only an overridden home. Follow `development-workflow.md` for lane ownership.
Do not reset or re-register the user's production Service for tests.

Start the Worker lane with `pnpm dev:worktree` and complete its normal Web setup.
For the shared Desktop pilot, start Web in another terminal with
`pnpm desktop:web` (equivalent to `OPENMELD_DESKTOP_PILOT=1 pnpm dev:web:worktree`). This reuses the existing Web
lane reservation and Doppler owner but builds and serves compiled Web output.
Stop only that worktree's old Web process first if it is already running.
The preview listener binds `127.0.0.1` so TanStack can prerender its shell;
the configured Web/Auth/Gateway URLs still use the worktree hostname and ports.
Then run `pnpm desktop:dev`. Missing/stale lane ownership or a missing
lane-local executable stops startup without falling back to production/global
state. Rebuild Web after shared-source changes before relaunching Desktop.
An installed CLI is a launcher prerequisite, not proof that its Service is
connected or that an Agent can reply. Service readiness is checked by its own UI.

For inexpensive visual iteration, use the existing browser Web HMR entry
`pnpm dev:web:worktree`; use the compiled pair for native integration and smoke.
The two modes must not run on the same reserved Web port concurrently. Native
main/preload hot reload is not enabled automatically: restarting main destroys
process-local authentication state, and serving Vite modules as packaged pages
would bypass the pilot's source/build compatibility boundary. Windows retains
its supported executable-plus-script callback registration. Linux source-mode
system-browser authentication still requires platform packaging and is not
certified by this macOS worktree-bundle workflow.

For a blank pilot window, use
`OPENMELD_DESKTOP_DIAGNOSTICS=1 pnpm desktop:start:dev`. This opens local Electron
DevTools and reports load milestones, preload failure, renderer exit, and fixed
console error categories. Terminal output excludes console text, URLs, request
bodies, and credentials. Inspect the full error locally in DevTools. This entry
requires the validated local pilot and either an unpackaged app or this explicitly
compiled worktree-development app; it does not expose a remote debugging listener
or enable diagnostics in installed/private distribution builds.
Use **Developer > Reopen Developer Tools** to recreate a closed or minimized
inspector without reloading the application; only inspector history is reset.
The local pilot Web build leaves client JavaScript unminified so DevTools can
set exact line breakpoints in hydration and application error callbacks. Normal
Web builds retain their default minification.

Installed Desktop also keeps a bounded Main-owned transport record at
`<userData>/diagnostics/transport.json` (at most 200 events, private file
permissions). It records route templates, HTTP status, validated request IDs,
request duration, app version, renderer fingerprint, and native Space socket
connect/open/error/close/cancel events. A process-local salted correlation value
connects socket reconnects without retaining Space IDs. URL parameters, arbitrary
path segments, cookies, message content, response bodies, exception text, and
socket close text are excluded. This records transport outcomes; it does not
infer an updater failure or change query retries, authentication, or reconnect
ownership. The shared Web consumer still owns recovery and snapshot refresh.

For production renderer verification, run `pnpm desktop:renderer:production`
from the clean candidate checkout. This builds the production Web renderer,
runs its Workerd SSR entry locally, validates the prerendered shell and compiled
target, and records source/input/output identity in `dev-tmp/release-artifact-check`.
Web artifact checks default to a 4 GiB renderer Node heap. macOS Desktop
production checks default to 5 GiB after a 4 GiB `/desktop-shell` prerender
exhausted its heap in the 0.1.7 release. The smaller GitHub Linux runner keeps
its 4 GiB admission budget. Both are overridable with
`OPENMELD_RENDERER_NODE_HEAP_MB` or `NODE_OPTIONS`. The default and override
must fit machine headroom and the heavy-work reservation, including 1 GiB of
non-heap overhead.
`OPENMELD_LOCAL_HEAVY_GIB` can set that reservation explicitly. An inherited
reservation cannot silently grow. This command neither signs nor publishes.

GUI data lives under `<OPENMELD_HOME>/desktop/mock-keychain-user-data` as a
stable, isolated local test profile. Main sets and verifies Electron's
`userData` path before Better Auth constructs storage. The launcher also passes
that directory explicitly to Electron, keeping GUI preferences and credentials
separate from other worktrees.

Electron 44.7.2 is paired with electron-vite 5.0.0 and Vite 7.3.7. Hydrate the
native binary with `pnpm --filter @openmeld/desktop exec electron --version`.
Electron is deliberately separate from the root Worker development stack.

## Packaging and release boundary

Production publication uses the signed, immutable candidate and explicit
promotion workflow in [Development Workflow](../engineering/development-workflow.md#desktop-preview-release-workflow).
The local packages below remain separate from that production path.

Local macOS packages use electron-builder's standard ad-hoc signing
(`mac.identity: "-"`) for the assembled App and nested code. The shared build
requires signing and strict verification before creating the DMG; installed and
private targets inherit this policy. Do not set `identity: null`: the original
Electron executable's linker signature does not seal the application resources.
No post-build signature repair is required or supported. The builder's default
Electron entitlements support JIT and library loading with Hardened Runtime.

The shared `afterPack` hook verifies each ASAR file against its recorded SHA-256
before signing. Worktree reuse checks the same archive integrity. An OS signature
can seal an archive whose file offsets already disagree with its content, so
signature verification alone does not certify a runnable package. Do not rebuild
workspace dependencies concurrently with Desktop packaging. A failed archive
check requires a fresh build, not a new signature on the damaged package.

The existing `unsigned` command and artifact names mean no Developer ID signing.
Ad-hoc integrity is not Developer ID trust, notarization, or Gatekeeper acceptance.
Notarization remains disabled for default development artifacts. Before installation
acceptance, verify both the source App and its DMG copy with
`codesign --verify --deep --strict --verbose=2`, then use the normal macOS Open
flow with quarantine preserved. A valid signature does not prove visible startup,
login, or Service behavior; report those outcomes separately.

For an authorized local installation acceptance, use
`pnpm desktop:package:acceptance` with the existing disposable target and fixed
Web origin. This invokes the same installed packaging pipeline and validates the
same renderer fingerprint. The installed builder configuration selects the
existing SOPHIAPRO Developer ID and `openmeld-notary` Keychain profile from the
Apple release credential contract. Competing file/password credentials are
rejected; no certificate is created or exported. Builder signs nested code,
submits the App to Apple, staples the accepted ticket to the App, and then creates
a signed `-acceptance.dmg` under `clients/desktop/dist/acceptance`. The ticket
covers the App copied out of that DMG; the container has no separately stapled
ticket. No renderer or account data is changed, and publishing remains disabled.
Verify the copied App's strict signature, stapled ticket and Gatekeeper assessment
before the normal download/Finder/native batch. This command contacts Apple's
notary service but does not authorize public distribution or deployment.
Use `DEBUG=electron-notarize:notarytool` for a local evidence run to retain the
Apple submission ID and Accepted result in the build log. Compute final artifact
hashes only after notarization, stapling and DMG creation have completed.

### Installed macOS entry

`OPENMELD_DESKTOP_TARGET=production` compiles the installed entry for
`https://openmeld.ai`. The shared renderer, native main, and package marker must
agree on this target and source fingerprint. The fingerprint verifies local
assets; it is not an installed client's server admission token. Finder launch
reads packaged assets and normal macOS application data without a repository,
pnpm, CLI prerequisite, or launch-time lane/URL/storage configuration.

Production uses app ID and callback scheme `sh.openmeld.desktop`, SDK client ID
`openmeld-desktop`, and `OpenMeld Desktop` under the OS application-data directory.
User data is fixed before initializing the SDK's encrypted cookie storage.
`OPENMELD_DESKTOP_TARGET=disposable` is a separately compiled local test target:
its fixed loopback Web origin comes from `OPENMELD_DESKTOP_TEST_WEB_ORIGIN`, and
its app ID, callback, SDK client ID, and data directory use the distinct test
identity. The production target never consumes that endpoint override.

An isolated disposable Web/Auth backend must explicitly configure
`AUTH_DESKTOP_DEVELOPMENT_TARGET=disposable` on both services. Empty or `private`
development configuration preserves the existing `electron` client. Registered
worktree origins use `sh.openmeld.desktop.dev.wt-<12hex>.p<port>`; other private
loopback setups retain `sh.openmeld.desktop.dev`. After adopting this tooling,
rebuild the private/native app and restart matching Web/Auth together. Production rejects a nonempty development
target. Better Auth supports one Electron client identity per Auth instance;
do not combine test and private identities by registering duplicate plugins.
Browser sign-in validates that configured identity, displays the intended
account, and preserves the normal add-account entry when another account is
needed. Invalid or expired native returns require a fresh browser sign-in.
Magic Link and email verification preserve the original `/desktop-sign-in`
target and its authorization parameters. Successful verification returns to
that request instead of the default Organization entry. Native callback and
process-local verifier ownership remain with the existing auth SDK.

Installed requests carry `x-openmeld-desktop-contract: 1`; before authenticated
business reads or streams, native verifies the strict, no-store
`GET /v1/desktop/compatibility` response. Compatible Web deployments retain
contract version 1 without requiring identical build fingerprints. Missing,
unknown, or malformed compatibility blocks admission; connectivity failures
remain distinct from unsupported-version messages. This admits representations,
not users: existing Auth/Core/Space authorization remains authoritative.
Installed renderers cannot call generated `/_serverFn/` or generic `/api/`
endpoints. They consume explicit `/v1/` contracts, including CLI release metadata
from the existing binary-channel manifest at `GET /v1/cli/release`.
The fixed native Computer connection operation additionally admits only
`POST /api/auth/device/code`, `GET /api/auth/device`, and
`POST /api/auth/device/approve` through Web's representation guard. The existing
Auth handlers retain authorization and grant validation. Renderer protocol
requests to all `/api/` paths, including these three, remain rejected before
native credentials are attached.

After building the matching shared Web renderer, `pnpm desktop:package:installed`
stages it and builds a local unsigned arm64 DMG with no publication target.
Installable entry is separate from Service bootstrap and signed distribution:
existing-user Service reuse, new-user zero-setup connection, actual Wake outcomes,
signing, notarization, and installed native acceptance remain separate gates.
Local package construction does not authorize public download or promotion.

Release ordering is server first: deploy the matching Web admission/metadata
routes and Auth identity before distributing an installed app. Keep contract 1
available while supported installed apps use it. Roll back incompatible Web/Auth
changes before withdrawing a supported representation; never redirect native
credentials to another origin or use a fingerprint bypass as recovery.

### Private local macOS package

`pnpm desktop:package:private` builds the private unsigned macOS arm64 app and
DMG with the existing electron-builder. It requires installed workspace
dependencies and current pilot Web output in `clients/web/dist/client` (build
through `OPENMELD_DESKTOP_PILOT=1 pnpm dev:web:worktree` in the configured lane,
as in the lane workflow above). Setting the pilot flag alone is insufficient:
the guarded Web entry supplies the actual lane's `VITE_BETTER_AUTH_URL` and
other aligned build values. Pilot builds reject a missing or invalid client Auth
URL after normal Vite environment loading, before emitting output. Runtime
native environment variables cannot repair a missing compiled renderer value.
Missing, incomplete, or stale Web output stops packaging. The package command
never starts Web or a Service.

The build stages the shared client output without source maps or hidden files,
rejects symbolic links, and includes it at `Contents/Resources/desktop-renderer`.
The private target includes main/preload and icons, but excludes the old status
and foundation renderers. Its compiled private mode requires the guarded pilot
entry even when started without environment configuration; it cannot fall back
to the status UI. Native startup always resolves this package's own resources,
ignores external renderer overrides, and checks the same Web build identity
before creating authentication storage. The existing Web-side build check still
rejects a mismatched server before forwarding an operation.
The app's `Info.plist` declares the existing development Auth return scheme from
`packages/schemas`, as macOS requires for packaged URL callbacks; no new scheme
or Auth authority is introduced.

Output is under `clients/desktop/dist/private`. The `.app` name follows the
unified [Desktop Application Names](desktop-app-identity.md) contract:
`OpenMeld Dev.app` for the private development identity, or
`OpenMeld Dev wt-<id>.app` when the selected identity belongs to a worktree.
The DMG filename is configured separately in
`electron-builder.private.config.mjs`; it is currently
`OpenMeld-Desktop-Private-${version}-macos-${arch}-unsigned.dmg`. Do not infer
the DMG filename from the application display name. This target writes no
preview/update manifest and has no publisher. It does not bundle CLI, Service,
credentials, lane state, or worktree asset paths. The legacy preview build
remains local-only and cannot publish.

Launch the built or copied app from an already configured, matching worktree:

```sh
pnpm desktop:start:package "/path/to/OpenMeld Dev.app"
# Explicit canary preset, using the same worktree lane:
pnpm desktop:start:package "/path/to/OpenMeld Dev wt-<id>.app" canary
```

This extends the existing root launcher: it verifies lane ownership and the
lane-local CLI, supplies aligned loopback endpoints and isolated GUI storage,
then runs the packaged executable without rebuilding it. Finder launch alone
has no lane configuration and is refused. A matching compiled Web server and
an existing connected CLI/Service remain prerequisites; this is not clean-machine
setup or a production compatibility promise. Auth, IPC, transport and protected
Service-control gates are unchanged. Signing, notarization, Gatekeeper behavior,
authenticated packaged UI, and OS browser-return callbacks need separate native
acceptance; package construction and content checks do not prove those outcomes.

The legacy unsigned preview upload is disabled. Signed production candidates
use the workflow linked above; local private packages do not publish or bundle
CLI, Service, credentials, or lane state.

Developer ID presence, Doppler names, portal access, build success, signing,
notarization, installation, and visible product smoke are separate evidence.
Desktop versions remain diagnostics and app-update facts, never Wake gates.

Desktop pilot renderer builds reuse the renderer resource and heap owner. The
pilot defaults to a 5120 MiB heap. `OPENMELD_RENDERER_NODE_HEAP_MB` overrides it
within the measured machine and heavy-work budget. The reservation ends after
compilation; it does not remain held for the preview server.

### CLI runtime and launch recovery

The status renderer recognizes `cli.node_unsupported` from the CLI startup JSON
envelope as well as `desktop.node_unsupported` from npm installation checks. It
asks the user to install Node.js 24, return, and choose **Try again**. Refreshes
keep the same recovery while the runtime remains unsupported.

A selected standalone carrier owns its runtime. Its launch error remains visible;
Desktop must not replace it with a system Node diagnosis. When the carrier cannot
launch, **Open Web to Repair CLI** opens the existing Web app. The user connects
this Mac from Computers to acquire a managed CLI, then returns and retries. The
status renderer does not attempt `setup` on that failed executable or report a
browser handoff as a completed repair.
