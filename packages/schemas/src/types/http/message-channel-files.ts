import type { z } from "zod/v4";

type Schemas = typeof import("../../schemas/http/message-channel-files");
export type CenterAgentReadChannelFileBody = z.infer<
  Schemas["centerAgentReadChannelFileBodySchema"]
>;
export type CenterAgentReadChannelFileResponse = z.infer<
  Schemas["centerAgentReadChannelFileResponseSchema"]
>;
