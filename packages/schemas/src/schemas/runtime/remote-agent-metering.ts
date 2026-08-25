import * as z from "zod/v4";

/**
 * AI Gateway REST Logs API response contract used for Remote Agent per-org
 * usage metering. The shapes below are modeled on the official Cloudflare API
 * reference for
 * `GET /accounts/{account_id}/ai-gateway/gateways/{gateway_id}/logs`
 * (https://developers.cloudflare.com/api/resources/ai_gateway/subresources/logs/methods/list/),
 * NOT on OpenMeld's own read assumptions. Only fields the metering reader
 * consumes are kept required; the rest stay optional and unknown keys are
 * ignored so an enriched future log shape still validates.
 *
 * Attribution note: `metadata` is returned as a JSON STRING (the request's
 * `cf-aig-metadata` blob), not a parsed object. The reader parses it and reads
 * `organizationId` to attribute usage. `cost` is an optional Cloudflare-computed
 * estimate and may be absent; when absent the reader falls back to a
 * token→USD conversion.
 */
export const aiGatewayLogEntrySchema = z
  .object({
    id: z.string(),
    cached: z.boolean(),
    created_at: z.string(),
    duration: z.number(),
    model: z.string(),
    path: z.string(),
    provider: z.string(),
    success: z.boolean(),
    tokens_in: z.number(),
    tokens_out: z.number(),
    cost: z.number().optional(),
    custom_cost: z.boolean().optional(),
    metadata: z.string().optional(),
    model_type: z.string().optional(),
    status_code: z.number().optional(),
    step: z.number().optional(),
  })
  .loose();

export type AiGatewayLogEntry = z.infer<typeof aiGatewayLogEntrySchema>;

/**
 * `result_info` pagination block on the Cloudflare API envelope. AI Gateway
 * returns cursor-less page/count pagination; the reader stops when the returned
 * page is shorter than `per_page` or the running window is fully covered.
 */
export const aiGatewayResultInfoSchema = z
  .object({
    count: z.number().optional(),
    page: z.number().optional(),
    per_page: z.number().optional(),
    total_count: z.number().optional(),
  })
  .loose();

export const aiGatewayLogsListResponseSchema = z
  .object({
    success: z.boolean(),
    result: z.array(aiGatewayLogEntrySchema).nullable().optional(),
    result_info: aiGatewayResultInfoSchema.optional(),
    errors: z.array(z.unknown()).optional(),
    messages: z.array(z.unknown()).optional(),
  })
  .loose();

export type AiGatewayLogsListResponse = z.infer<
  typeof aiGatewayLogsListResponseSchema
>;
