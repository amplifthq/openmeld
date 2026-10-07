import { setTimeout as delay } from "node:timers/promises";
import { postgresqlD1RemoteSourceSchema } from "../../packages/schemas/src/schemas/release/postgresql-import.ts";

// Cloudflare's documented Query D1 Database request/result contract. The caller
// supplies the existing scoped token; neither SQL nor response bodies enter logs.
export function createRemoteD1Source({ identity, token, request = fetch }) {
  const source = postgresqlD1RemoteSourceSchema.parse(identity);
  if (!token?.trim()) {
    throw new Error("Missing scoped Cloudflare D1 read token");
  }
  let previous = 0;
  return {
    identity: source,
    prepare(sql) {
      return {
        bind(...params) {
          return {
            async all() {
              // Sequential capture stays below the documented global 1,200/5m
              // limit. Other account traffic can still exhaust it: stop on 429.
              await delay(Math.max(0, 350 - (performance.now() - previous)));
              previous = performance.now();
              const response = await request(
                `https://api.cloudflare.com/client/v4/accounts/${source.accountId}/d1/database/${source.databaseId}/query`,
                {
                  method: "POST",
                  redirect: "error",
                  headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({ sql, params }),
                }
              );
              if (!response.ok) {
                throw new Error(
                  `D1 capture request failed (HTTP ${response.status}); no automatic retry`
                );
              }
              const body = await response.json();
              if (
                body?.success !== true ||
                !Array.isArray(body.result) ||
                body.result.length !== 1 ||
                body.result[0]?.success !== true ||
                !Array.isArray(body.result[0].results) ||
                body.result[0].meta?.changed_db === true
              ) {
                throw new Error("D1 capture returned an invalid query result");
              }
              return body.result[0];
            },
          };
        },
      };
    },
  };
}
