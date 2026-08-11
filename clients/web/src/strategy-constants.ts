// Web-owned timing policy values. Keep this file deployment-local; matching
// Core or CLI values are documented as pairings, not shared through code.
export const AGENT_PROFILE_ROUTE_REFRESH_INTERVAL_MS = 2000;
export const AGENT_PROFILE_ROUTE_REFRESH_WINDOW_MS = 5 * 60_000;
export const CURRENT_LOCAL_RUNTIME_REPLY_READINESS_REFRESH_INTERVAL_MS = 2000;
export const LOCAL_RUNTIME_CATALOG_READY_RECONCILE_DELAY_MS = 5000;
export const SPACE_WAKE_STATUS_REFRESH_INTERVAL_MS = 2000;
export const SPACE_WAKE_STATUS_REFRESH_WINDOW_MS = 15_000;
export const SPACE_WAKE_STATUS_FRESHNESS_REFRESH_INTERVAL_MS = 60_000;
// Display-only debounce for the Members-panel Wake badge: smooth a brief
// available -> checking -> available flicker (a 1006 socket blip) without
// strobing the badge. Visual only -- it never gates dispatch or any real
// verdict. Sized to UX risk (short enough to surface a real outage promptly),
// not to the socket-recovery P95.
export const SPACE_WAKE_DISPLAY_DEBOUNCE_MS = 20_000;
export const START_SETUP_FAST_CHECK_INTERVAL_MS = 2000;
export const START_SETUP_FAST_CHECK_WINDOW_MS = 30_000;
export const START_SETUP_SLOW_CHECK_INTERVAL_MS = 5000;
export const NPM_LATEST_TIMEOUT_MS = 5000;
// The Connect flow's update_service completion check keeps polling the local
// components readiness projection after the CLI reports the Prepare Session
// finished, waiting for the daemon to reconnect and report the newly
// installed OpenMeld Service/CLI version. 60s covers normal daemon reconnect
// and report latency; past that, a lingering `update_required` status means
// the release channel most likely does not have the required version yet,
// not that the check needs more time.
export const SERVICE_UPDATE_VERIFICATION_TIMEOUT_MS = 60_000;
