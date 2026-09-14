import * as z from "zod/v4";

// Diagnostic correlation only. Never use this ID as identity or authority.
export const SERVICE_CONNECTION_ID_QUERY_PARAMETER = "connectionId";
export const serviceConnectionDiagnosticIdSchema = z.uuid();
