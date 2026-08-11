import type { z } from "zod/v4";

type StartObservationIssueSchema =
  typeof import("../../schemas/start/observation-issue")["startObservationIssueSchema"];

export type StartObservationIssue = z.infer<StartObservationIssueSchema>;
