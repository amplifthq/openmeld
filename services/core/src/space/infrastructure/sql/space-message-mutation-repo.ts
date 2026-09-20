import {
  SPACE_MESSAGE_FILE_MAX_COUNT,
  sanitizeSignalTextPreview,
  signalTextEnvelopeSchema,
} from "@openmeld/schemas";
import type {
  SignalEnvelope,
  SpaceMessageMutationBody,
} from "@openmeld/schemas/types";
import { createCoreRpcHttpError } from "../../../rpc/errors";
import { readSignalEntryById } from "./space-signal-repo";

type TextMessage = Extract<SignalEnvelope, { type: "signal.text" }>;

function editedMessageEnvelope(
  current: TextMessage,
  body: Extract<SpaceMessageMutationBody, { action: "edit" }>
) {
  const previous = current.data.messageEnvelope;
  if (!body.text.trim()) {
    if (previous?.activationTargets.length) {
      fail(
        409,
        "space.message.wake_already_requested",
        "Keep the original Wake token, or recall this message."
      );
    }
    return undefined;
  }
  if (!body.messageEnvelope) {
    return previous
      ? { ...previous, text: body.text.trim() || previous.text }
      : undefined;
  }
  const oldWake = previous?.activationTargets ?? [];
  const nextWake = body.messageEnvelope.activationTargets;
  if (
    oldWake.length &&
    (oldWake.length !== nextWake.length ||
      oldWake.some((id) => !nextWake.includes(id)))
  ) {
    fail(
      409,
      "space.message.wake_already_requested",
      "This message already started Agent work. Editing cannot start it again or change its Wake targets."
    );
  }
  return {
    ...previous,
    text: body.text.trim(),
    activationTargets: nextWake,
    referenceTargets: body.messageEnvelope.referenceTargets,
    mentionTargets: body.messageEnvelope.mentionTargets ?? [],
  };
}

function editMessage(
  current: TextMessage,
  body: Extract<SpaceMessageMutationBody, { action: "edit" }>,
  nowMs: number
): TextMessage {
  const text = body.text.trim();
  const retainedFiles = retainContent(
    current.data.files,
    body.retainedFileIds,
    (file) => file.fileId
  );
  const files = [...(retainedFiles ?? []), ...(body.addedFiles ?? [])];
  if (
    files.length > SPACE_MESSAGE_FILE_MAX_COUNT ||
    new Set(files.map((file) => file.fileId)).size !== files.length
  ) {
    fail(
      400,
      "space.message.invalid_attachment",
      "Choose up to ten different files."
    );
  }
  const messageEnvelope = editedMessageEnvelope(current, body);
  const attachments = retainContent(
    current.data.attachments,
    body.retainedAttachmentIds,
    (file) => file.id
  );
  if (!(text || files?.length || attachments?.length)) {
    fail(
      400,
      "space.message.recall_confirmation_required",
      "Confirm recall to remove all message content."
    );
  }
  if (
    text === current.data.text &&
    JSON.stringify(files) === JSON.stringify(current.data.files ?? []) &&
    JSON.stringify(attachments) === JSON.stringify(current.data.attachments) &&
    JSON.stringify(messageEnvelope) ===
      JSON.stringify(current.data.messageEnvelope)
  ) {
    return current;
  }
  const { messageEnvelope: _previousEnvelope, ...data } = current.data;
  return {
    ...current,
    data: {
      ...data,
      text,
      ...(files ? { files } : {}),
      ...(attachments ? { attachments } : {}),
      ...(messageEnvelope ? { messageEnvelope } : {}),
      meta: {
        ...current.data.meta,
        messageRevision: (current.data.meta?.messageRevision ?? 0) + 1,
        editedAt: nowMs,
      },
    },
  };
}

function retainContent<T>(
  content: T[] | undefined,
  ids: string[] | undefined,
  idOf: (item: T) => string
): T[] | undefined {
  if (ids === undefined) {
    return content;
  }
  const available = new Set(content?.map(idOf));
  if (
    new Set(ids).size !== ids.length ||
    ids.some((id) => !available.has(id))
  ) {
    fail(
      400,
      "space.message.invalid_attachment",
      "Only attachments already in this message can be kept."
    );
  }
  return content?.filter((item) => ids.includes(idOf(item)));
}

function fail(status: number, code: string, reason: string): never {
  throw createCoreRpcHttpError({ status, code, reason });
}

function readRecalledDraft(sql: SqlStorage, current: TextMessage): TextMessage {
  if (current.data.meta?.repostedAt) {
    fail(
      409,
      "space.message.already_reposted",
      "This message has already been sent again."
    );
  }
  if (!current.data.meta?.recalledAt) {
    fail(
      409,
      "space.message.not_recalled",
      "This message has not been recalled."
    );
  }
  const draft = sql
    .exec<{ payload_json: string }>(
      "SELECT payload_json FROM space_recalled_message_drafts WHERE signal_id = ?",
      current.id
    )
    .toArray()[0];
  if (!draft) {
    fail(
      404,
      "space.message.draft_unavailable",
      "This message is no longer available to edit again."
    );
  }
  return signalTextEnvelopeSchema.parse(JSON.parse(draft.payload_json));
}

// Runs in the same transaction as publication. A failed send cannot consume
// recovery, and a client cannot consume another sender's recalled message.
export function completeRecalledMessageRepost(
  sql: SqlStorage,
  signal: SignalEnvelope
): TextMessage | null {
  if (
    signal.type !== "signal.text" ||
    !signal.data.meta?.restoredFromSignalId
  ) {
    return null;
  }
  const sourceId = signal.data.meta.restoredFromSignalId;
  const entry = readSignalEntryById(sql, sourceId);
  const parsed = signalTextEnvelopeSchema.safeParse(
    entry ? JSON.parse(entry[1]) : null
  );
  if (
    !(parsed.success && parsed.data.data.meta?.recalledAt) ||
    signal.profile.kind !== "human" ||
    parsed.data.profile.kind !== "human" ||
    parsed.data.profile.profileId !== signal.profile.profileId ||
    parsed.data.spaceId !== signal.spaceId
  ) {
    fail(
      403,
      "space.message.invalid_repost",
      "Only your own recalled messages can be sent again."
    );
  }
  const source = parsed.data;
  if (source.data.meta?.repostedAt) {
    return null;
  }
  const message: TextMessage = {
    ...source,
    data: {
      ...source.data,
      meta: {
        ...source.data.meta,
        repostedAt: signal.ts,
        messageRevision: (source.data.meta?.messageRevision ?? 0) + 1,
      },
    },
  };
  sql.exec(
    "UPDATE space_signals SET payload_json = ? WHERE id = ?",
    JSON.stringify(message),
    source.id
  );
  sql.exec(
    "DELETE FROM space_recalled_message_drafts WHERE signal_id = ?",
    source.id
  );
  return message;
}

// Called inside the Space owner's synchronous transaction. Retained content
// lives outside public signal payloads and is never selected by history readers.
export function mutateSpaceMessage(input: {
  sql: SqlStorage;
  signalId: string;
  actorProfileId: string;
  actorKind: string;
  body: SpaceMessageMutationBody;
  nowMs: number;
  onEdit?: (message: TextMessage, previous: TextMessage) => void;
}): { message: TextMessage; changed: boolean } {
  const { sql, body } = input;
  const entry = readSignalEntryById(sql, input.signalId);
  const parsed = signalTextEnvelopeSchema.safeParse(
    entry ? JSON.parse(entry[1]) : null
  );
  if (!parsed.success) {
    fail(
      404,
      "space.message.not_found",
      "This message is no longer available."
    );
  }
  const current = parsed.data;
  if (
    input.actorKind !== "human" ||
    current.profile.kind !== "human" ||
    current.profile.profileId !== input.actorProfileId ||
    current.data.meta?.purpose
  ) {
    fail(
      403,
      "space.message.author_required",
      "You can only change messages you sent."
    );
  }
  if (body.action === "restore_draft") {
    return {
      message: readRecalledDraft(sql, current),
      changed: false,
    };
  }
  if (current.data.meta?.recalledAt && body.action === "recall") {
    return { message: current, changed: false };
  }
  if (current.data.meta?.recalledAt) {
    fail(
      409,
      "space.message.recalled",
      "This message was recalled. Use Edit again to write a new message."
    );
  }
  const revision = current.data.meta?.messageRevision ?? 0;
  if (revision !== body.expectedRevision) {
    fail(
      409,
      "space.message.version_conflict",
      "This message changed on another device. Reopen it before saving."
    );
  }
  let message: TextMessage;
  if (body.action === "recall") {
    sql.exec(
      "INSERT INTO space_recalled_message_drafts (signal_id, payload_json) VALUES (?, ?)",
      current.id,
      JSON.stringify(current)
    );
    message = {
      ...current,
      data: {
        text: `${current.profile.profileName} recalled a message.`,
        meta: {
          messageRevision: revision + 1,
          recalledAt: input.nowMs,
          ...(current.data.meta?.clientMessageId
            ? { clientMessageId: current.data.meta.clientMessageId }
            : {}),
        },
      },
    };
  } else {
    message = editMessage(current, body, input.nowMs);
    if (message === current) {
      return { message: current, changed: false };
    }
    input.onEdit?.(message, current);
  }
  signalTextEnvelopeSchema.parse(message);
  sql.exec(
    "UPDATE space_signals SET payload_json = ? WHERE id = ?",
    JSON.stringify(message),
    current.id
  );
  // Legacy reply snapshots must not re-expose recalled or outdated text when
  // the referenced message is outside a client's loaded history window.
  sql.exec(
    `UPDATE space_signals SET payload_json = json_set(payload_json, '$.data.replyTo.previewText', ?)
    WHERE json_extract(payload_json, '$.data.replyTo.signalId') = ?`,
    message.data.meta?.recalledAt
      ? "Message recalled"
      : (sanitizeSignalTextPreview(message.data.text) ?? "Attachment"),
    current.id
  );
  return { message, changed: true };
}
