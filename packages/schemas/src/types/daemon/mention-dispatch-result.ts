export type OpenMeldDaemonMentionDispatchResultPayload = import("zod/v4").infer<
  typeof import("../../schemas/daemon/mention-dispatch-result")["openMeldDaemonMentionDispatchResultPayloadSchema"]
>;

export type OpenMeldDaemonMentionDispatchResultEnvelope =
  import("zod/v4").infer<
    typeof import("../../schemas/daemon/mention-dispatch-result")["openMeldDaemonMentionDispatchResultEnvelopeSchema"]
  >;
