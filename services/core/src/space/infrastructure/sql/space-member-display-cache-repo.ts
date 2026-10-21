import {
  agentAvatarOptionsSchema,
  agentAvatarStyleSchema,
} from "@openmeld/schemas";
import type { AuthRpcProfileFact } from "@openmeld/schemas/types";

type AgentAvatarStyle = NonNullable<AuthRpcProfileFact["avatarStyle"]>;
type AgentAvatarOptions = NonNullable<AuthRpcProfileFact["avatarOptions"]>;

// Display-only copies of member facts owned elsewhere: account images live in
// PostgreSQL users; Agent avatar choices come from the Auth Profile facts read
// that also refreshes member name snapshots, so a Profile row's age is also
// the age of that member's name. A row records one confirmed read (a null
// value is a confirmed absence); failed reads never write. These rows never
// feed access, readiness, or Wake policy.
export type SpaceMemberProfileDisplayFacts = {
  avatarStyle: AgentAvatarStyle | null;
  avatarOptions: AgentAvatarOptions | null;
};

export type SpaceMemberDisplayCache = {
  profileDisplayByProfileId: ReadonlyMap<
    string,
    SpaceMemberProfileDisplayFacts & { refreshedAtMs: number }
  >;
  ownerAvatarByOwnerUserId: ReadonlyMap<
    string,
    { avatarUrl: string | null; refreshedAtMs: number }
  >;
};

export function ensureSpaceMemberDisplayCacheTables(sql: SqlStorage): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS space_member_owner_avatar_cache (
      owner_user_id TEXT PRIMARY KEY,
      avatar_url TEXT NULL,
      refreshed_at_ms INTEGER NOT NULL
    )
  `);
  sql.exec(`
    CREATE TABLE IF NOT EXISTS space_member_profile_display_cache (
      profile_id TEXT PRIMARY KEY,
      avatar_style TEXT NULL,
      avatar_options_json TEXT NULL,
      refreshed_at_ms INTEGER NOT NULL
    )
  `);
}

export function readSpaceMemberDisplayCache(
  sql: SqlStorage
): SpaceMemberDisplayCache {
  const ownerAvatarByOwnerUserId = new Map<
    string,
    { avatarUrl: string | null; refreshedAtMs: number }
  >();
  for (const row of sql
    .exec<{
      owner_user_id: string;
      avatar_url: string | null;
      refreshed_at_ms: number;
    }>(
      "SELECT owner_user_id, avatar_url, refreshed_at_ms FROM space_member_owner_avatar_cache"
    )
    .toArray()) {
    ownerAvatarByOwnerUserId.set(row.owner_user_id, {
      avatarUrl: row.avatar_url,
      refreshedAtMs: Number(row.refreshed_at_ms),
    });
  }
  const profileDisplayByProfileId = new Map<
    string,
    SpaceMemberProfileDisplayFacts & { refreshedAtMs: number }
  >();
  for (const row of sql
    .exec<{
      profile_id: string;
      avatar_style: string | null;
      avatar_options_json: string | null;
      refreshed_at_ms: number;
    }>(
      "SELECT profile_id, avatar_style, avatar_options_json, refreshed_at_ms FROM space_member_profile_display_cache"
    )
    .toArray()) {
    const facts = parseProfileDisplayFacts(row);
    // An unreadable row is a cache miss, never a confirmed absence.
    if (facts) {
      profileDisplayByProfileId.set(row.profile_id, {
        ...facts,
        refreshedAtMs: Number(row.refreshed_at_ms),
      });
    }
  }
  return { profileDisplayByProfileId, ownerAvatarByOwnerUserId };
}

// Returns true when a stored display value changed.
export function writeSpaceMemberOwnerAvatars(
  sql: SqlStorage,
  input: {
    avatarUrlByOwnerUserId: ReadonlyMap<string, string | null>;
    refreshedAtMs: number;
  }
): boolean {
  let changed = false;
  for (const [ownerUserId, avatarUrl] of input.avatarUrlByOwnerUserId) {
    const current = sql
      .exec<{ avatar_url: string | null; refreshed_at_ms: number }>(
        "SELECT avatar_url, refreshed_at_ms FROM space_member_owner_avatar_cache WHERE owner_user_id = ?",
        ownerUserId
      )
      .toArray()[0];
    // A slower, older read must not replace a newer confirmed value.
    if (current && Number(current.refreshed_at_ms) > input.refreshedAtMs) {
      continue;
    }
    if (current && current.avatar_url !== avatarUrl) {
      changed = true;
    }
    sql.exec(
      `
        INSERT INTO space_member_owner_avatar_cache (owner_user_id, avatar_url, refreshed_at_ms)
        VALUES (?, ?, ?)
        ON CONFLICT(owner_user_id) DO UPDATE SET
          avatar_url = excluded.avatar_url,
          refreshed_at_ms = excluded.refreshed_at_ms
      `,
      ownerUserId,
      avatarUrl,
      input.refreshedAtMs
    );
  }
  return changed;
}

// Returns true when a stored display value changed.
export function writeSpaceMemberProfileDisplay(
  sql: SqlStorage,
  input: {
    displayByProfileId: ReadonlyMap<string, SpaceMemberProfileDisplayFacts>;
    refreshedAtMs: number;
  }
): boolean {
  let changed = false;
  for (const [profileId, facts] of input.displayByProfileId) {
    const current = sql
      .exec<{
        avatar_style: string | null;
        avatar_options_json: string | null;
        refreshed_at_ms: number;
      }>(
        "SELECT avatar_style, avatar_options_json, refreshed_at_ms FROM space_member_profile_display_cache WHERE profile_id = ?",
        profileId
      )
      .toArray()[0];
    if (current && Number(current.refreshed_at_ms) > input.refreshedAtMs) {
      continue;
    }
    const avatarOptionsJson =
      facts.avatarOptions === null ? null : JSON.stringify(facts.avatarOptions);
    if (
      current &&
      (current.avatar_style !== facts.avatarStyle ||
        current.avatar_options_json !== avatarOptionsJson)
    ) {
      changed = true;
    }
    sql.exec(
      `
        INSERT INTO space_member_profile_display_cache (profile_id, avatar_style, avatar_options_json, refreshed_at_ms)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(profile_id) DO UPDATE SET
          avatar_style = excluded.avatar_style,
          avatar_options_json = excluded.avatar_options_json,
          refreshed_at_ms = excluded.refreshed_at_ms
      `,
      profileId,
      facts.avatarStyle,
      avatarOptionsJson,
      input.refreshedAtMs
    );
  }
  return changed;
}

function parseProfileDisplayFacts(row: {
  avatar_style: string | null;
  avatar_options_json: string | null;
}): SpaceMemberProfileDisplayFacts | null {
  const avatarStyle =
    row.avatar_style === null
      ? { success: true as const, data: null }
      : agentAvatarStyleSchema.safeParse(row.avatar_style);
  if (!avatarStyle.success) {
    return null;
  }
  if (row.avatar_options_json === null) {
    return { avatarStyle: avatarStyle.data, avatarOptions: null };
  }
  let rawOptions: unknown;
  try {
    rawOptions = JSON.parse(row.avatar_options_json);
  } catch {
    return null;
  }
  const avatarOptions = agentAvatarOptionsSchema.safeParse(rawOptions);
  if (!avatarOptions.success) {
    return null;
  }
  return { avatarStyle: avatarStyle.data, avatarOptions: avatarOptions.data };
}
