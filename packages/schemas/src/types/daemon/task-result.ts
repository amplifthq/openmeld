import type { z } from "zod/v4";

type OpenMeldDaemonTaskResultEnvelopeSchema =
  typeof import("../../schemas/daemon/task-result")["openMeldDaemonTaskResultEnvelopeSchema"];
type OpenMeldDaemonTaskResultPayloadSchema =
  typeof import("../../schemas/daemon/task-result")["openMeldDaemonTaskResultPayloadSchema"];
type OpenMeldDaemonProviderAccessEvidenceSchema =
  typeof import("../../schemas/daemon/task-result")["openMeldDaemonProviderAccessEvidenceSchema"];
type OpenMeldDaemonProviderAccessEvidenceProviderSchema =
  typeof import("../../schemas/daemon/task-result")["openMeldDaemonProviderAccessEvidenceProviderSchema"];

export type OpenMeldDaemonTaskResultEnvelope =
  z.infer<OpenMeldDaemonTaskResultEnvelopeSchema>;
export type OpenMeldDaemonTaskResultPayload =
  z.infer<OpenMeldDaemonTaskResultPayloadSchema>;
export type OpenMeldDaemonProviderAccessEvidence =
  z.infer<OpenMeldDaemonProviderAccessEvidenceSchema>;
export type OpenMeldDaemonProviderAccessEvidenceProvider =
  z.infer<OpenMeldDaemonProviderAccessEvidenceProviderSchema>;
