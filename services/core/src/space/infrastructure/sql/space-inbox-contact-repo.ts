type PersonalAgentContact = {
  agentProfileId: string;
  initiatingUserId: string;
  organizationId: string;
  recipientUserId: string;
  scopeKey: string;
  signalId: string;
  spaceId: string;
};

export function ensureSpaceInboxContactTable(sql: SqlStorage): void {
  sql.exec(`CREATE TABLE IF NOT EXISTS space_inbox_personal_agent_contacts (
    organization_id TEXT NOT NULL,
    space_id TEXT NOT NULL,
    scope_key TEXT NOT NULL,
    initiating_user_id TEXT NOT NULL,
    recipient_user_id TEXT NOT NULL,
    agent_profile_id TEXT NOT NULL,
    contact_signal_id TEXT NOT NULL,
    priority_eligible INTEGER NOT NULL CHECK (priority_eligible IN (0, 1)),
    PRIMARY KEY (organization_id, space_id, scope_key, initiating_user_id, recipient_user_id, agent_profile_id)
  )`);
}

/** Called inside the Space publication transaction; read/Dismiss never touches it. */
export function recordSpaceInboxPersonalAgentContact(
  sql: SqlStorage,
  input: PersonalAgentContact & {
    directMessage: boolean;
    historyMayBeArchived: boolean;
    threadRootSignalId: string | null;
  }
): boolean {
  const identity = [
    input.organizationId,
    input.spaceId,
    input.scopeKey,
    input.initiatingUserId,
    input.recipientUserId,
    input.agentProfileId,
  ];
  const read = () =>
    sql
      .exec<{ contact_signal_id: string; priority_eligible: number }>(
        `SELECT contact_signal_id, priority_eligible FROM space_inbox_personal_agent_contacts
     WHERE organization_id = ? AND space_id = ? AND scope_key = ?
       AND initiating_user_id = ? AND recipient_user_id = ? AND agent_profile_id = ?`,
        ...identity
      )
      .toArray()[0];
  const existing = read();
  if (existing) {
    return (
      existing.priority_eligible === 1 &&
      existing.contact_signal_id === input.signalId
    );
  }
  // Establish a conservative rollout boundary from retained structured source
  // evidence, not topic inference or a cooldown. Removed Human Profiles retain
  // their account snapshot, so switching Profiles does not restart a contact.
  const historical = sql
    .exec<{ id: string }>(
      `SELECT signal.id FROM space_signals AS signal
     INNER JOIN space_members AS author ON author.profile_id = signal.profile_id
     LEFT JOIN space_thread_signal_placements AS placement ON placement.signal_id = signal.id
     LEFT JOIN space_threads AS thread ON thread.thread_id = placement.thread_id
     WHERE signal.id != ? AND signal.type = 'signal.text' AND signal.profile_kind = 'human'
       AND author.owner_user_id_snapshot = ? AND author.profile_kind_snapshot = 'human'
       AND coalesce(json_extract(signal.payload_json, '$.data.meta.transient'), 0) != 1
       AND ((? IS NULL AND placement.signal_id IS NULL) OR thread.root_signal_id = ?)
       AND ((? = 1 AND NOT EXISTS (
         SELECT 1 FROM json_each(signal.payload_json, '$.data.messageEnvelope.referenceTargets') WHERE value = ?
       )) OR (coalesce(json_extract(signal.payload_json, '$.data.meta.threadWakeContinuation'), 0) != 1 AND EXISTS (
         SELECT 1 FROM json_each(signal.payload_json, '$.data.messageEnvelope.activationTargets') WHERE value = ?
       )))
     ORDER BY signal.ts, signal.id LIMIT 1`,
      input.signalId,
      input.initiatingUserId,
      input.threadRootSignalId,
      input.threadRootSignalId,
      input.directMessage ? 1 : 0,
      input.agentProfileId,
      input.agentProfileId
    )
    .toArray()[0];
  const earliestRetainedRow = sql
    .exec<{ storage_order: number | null }>(
      "SELECT MIN(rowid) AS storage_order FROM space_signals"
    )
    .toArray()[0]?.storage_order;
  const mainHistoryWasPruned =
    input.threadRootSignalId === null &&
    earliestRetainedRow != null &&
    earliestRetainedRow > 1;
  const priorityEligible = !(
    historical ||
    input.historyMayBeArchived ||
    mainHistoryWasPruned
  );
  sql.exec(
    `INSERT OR IGNORE INTO space_inbox_personal_agent_contacts (
      organization_id, space_id, scope_key, initiating_user_id, recipient_user_id, agent_profile_id,
      contact_signal_id, priority_eligible
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ...identity,
    historical?.id ?? input.signalId,
    priorityEligible ? 1 : 0
  );
  const receipt = read();
  return (
    receipt?.priority_eligible === 1 &&
    receipt.contact_signal_id === input.signalId
  );
}
