import type { z } from "zod/v4";

type WakeProgressPhaseSchema =
  typeof import("../../schemas/http/space-wake-progress")["wakeProgressPhaseSchema"];
type WakeProgressItemSchema =
  typeof import("../../schemas/http/space-wake-progress")["wakeProgressItemSchema"];
type WakeStopEligibilityReadModelSchema =
  typeof import("../../schemas/http/space-wake-progress")["wakeStopEligibilityReadModelSchema"];
type GetSpaceWakeProgressInputSchema =
  typeof import("../../schemas/http/space-wake-progress")["getSpaceWakeProgressInputSchema"];
type GetSpaceWakeProgressResponseSchema =
  typeof import("../../schemas/http/space-wake-progress")["getSpaceWakeProgressResponseSchema"];
type GetActiveSpaceWakeProgressInputSchema =
  typeof import("../../schemas/http/space-wake-progress")["getActiveSpaceWakeProgressInputSchema"];
type GetActiveSpaceWakeProgressResponseSchema =
  typeof import("../../schemas/http/space-wake-progress")["getActiveSpaceWakeProgressResponseSchema"];

export type WakeProgressPhase = z.infer<WakeProgressPhaseSchema>;
export type WakeProgressItem = z.infer<WakeProgressItemSchema>;
export type WakeStopEligibilityReadModel =
  z.infer<WakeStopEligibilityReadModelSchema>;
export type GetSpaceWakeProgressInput =
  z.infer<GetSpaceWakeProgressInputSchema>;
export type GetSpaceWakeProgressResponse =
  z.infer<GetSpaceWakeProgressResponseSchema>;
export type GetActiveSpaceWakeProgressInput =
  z.infer<GetActiveSpaceWakeProgressInputSchema>;
export type GetActiveSpaceWakeProgressResponse =
  z.infer<GetActiveSpaceWakeProgressResponseSchema>;
