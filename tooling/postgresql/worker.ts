import { timingSafeEqual } from "node:crypto";
import { readPostgresErrorCode } from "@openmeld/db/postgresql";
import pg from "pg";
import { acceptRuntime } from "./acceptance.mjs";
import { acceptRuntimeTransport } from "./runtime-transport-acceptance";

const bearerPrefix = /^Bearer /u;

type ProbeEnvironment = {
  OPENMELD_POSTGRESQL?: Hyperdrive;
  POSTGRESQL_OPENMELD_PROBE_TOKEN: string;
  POSTGRESQL_PROBE_EXPIRES_AT: string;
  OPENMELD_WORKER_ENVIRONMENT: string;
};

export default {
  async fetch(request: Request, env: ProbeEnvironment): Promise<Response> {
    const expected = env.POSTGRESQL_OPENMELD_PROBE_TOKEN;
    const actual =
      request.headers.get("Authorization")?.replace(bearerPrefix, "") ?? "";
    const actualBytes = Buffer.from(actual);
    const expectedBytes = Buffer.from(expected ?? "");
    if (
      !expected ||
      actualBytes.length !== expectedBytes.length ||
      !timingSafeEqual(actualBytes, expectedBytes)
    ) {
      return new Response(null, { status: 401 });
    }
    if (
      env.OPENMELD_WORKER_ENVIRONMENT !== "postgresql-foundation-staging" ||
      !env.OPENMELD_POSTGRESQL
    ) {
      return new Response(null, { status: 503 });
    }
    const expiry = Date.parse(env.POSTGRESQL_PROBE_EXPIRES_AT);
    if (!Number.isFinite(expiry) || Date.now() >= expiry) {
      return new Response(null, { status: 410 });
    }
    if (
      request.method !== "POST" ||
      !["/acceptance", "/runtime-transport"].includes(
        new URL(request.url).pathname
      )
    ) {
      return new Response(null, { status: 404 });
    }
    if (new URL(request.url).pathname === "/runtime-transport") {
      try {
        await acceptRuntimeTransport(env.OPENMELD_POSTGRESQL);
        return new Response(null, { status: 204 });
      } catch (error) {
        console.error("PostgreSQL product transport acceptance failed", {
          code: readPostgresErrorCode(error) ?? "acceptance_failed",
        });
        return new Response(null, { status: 500 });
      }
    }
    // One request-scoped client; Hyperdrive owns origin pooling.
    const client = new pg.Client({
      connectionString: env.OPENMELD_POSTGRESQL.connectionString,
      connectionTimeoutMillis: 10_000,
    });
    try {
      await client.connect();
      await acceptRuntime(client);
      return new Response(null, { status: 204 });
    } catch (error) {
      console.error("PostgreSQL acceptance failed", {
        code: readPostgresErrorCode(error) ?? "acceptance_failed",
      });
      // SQL text, connection details, and credentials never enter public output/logs.
      return new Response(null, { status: 500 });
    } finally {
      await client.end().catch(() => {
        /* The operation already reported its outcome. */
      });
    }
  },
};
