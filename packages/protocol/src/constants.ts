export const MAX_PROFILE_ID_LENGTH = 64;
export const MAX_PROFILE_NAME_LENGTH = 64;
export const MAX_TEXT_LENGTH = 100_000;

// Transport-level keepalive sentinels for the Space live-update WebSocket
// stream. The browser sends PING on a sub-idle cadence; the Space DO answers
// PONG via setWebSocketAutoResponse (hibernation-safe). The two proxy hops
// forward the bare PING upstream and swallow the PONG. Bare (non-JSON) strings
// so they can never collide with the type-keyed hello / signal.text framing,
// and carry no structured payload (no schema contract required).
export const SPACE_STREAM_KEEPALIVE_PING = "ping";
export const SPACE_STREAM_KEEPALIVE_PONG = "pong";

// Transport-level keepalive sentinels for the daemon stream (local OpenMeld service
// <-> Core RuntimeTransportHub WebSocket). The local service sends PING on a
// sub-idle cadence, independent of the heartbeat; the RuntimeTransportHub DO
// answers PONG via setWebSocketAutoResponse (hibernation-safe), so the
// gateway-pass-through connection chain never goes idle and gets evicted (the
// idle eviction surfaced as code=1006 stream drops and periodic agent
// available<->offline flapping). Bare (non-JSON) strings so they can never
// collide with the {v,code,payload} daemon framing, and carry no structured
// payload (no schema contract required). Keepalive is purely connection-warmth:
// it must never refresh a lease, write readiness, or influence liveness
// authority.
export const DAEMON_STREAM_KEEPALIVE_PING = "ping";
export const DAEMON_STREAM_KEEPALIVE_PONG = "pong";
