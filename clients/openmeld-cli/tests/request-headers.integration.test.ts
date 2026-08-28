import { describe, expect, it } from "vitest";
import { setAuthSession } from "../src/config/auth-session";
import { buildOpenMeldRequestContextHeadersWithAuth } from "../src/config/request-headers";
import { withTempHome } from "./helpers/fs";

const REQUEST_CONTEXT = {
  actorContext: {
    requestId: "req-123",
    openMeldProfileId: "profile-id-1",
    profileKind: "human" as const,
    profileName: "Mira",
  },
};

describe("buildOpenMeldRequestContextHeadersWithAuth", () => {
  it("adds Authorization header from stored session", async () => {
    await withTempHome(async () => {
      const previousForceInsecureToken =
        process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN;
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      try {
        await setAuthSession({
          accessToken: "stored-token",
          tokenType: "Bearer",
          authBaseUrl: "https://auth.openmeld.invalid",
          clientId: "openmeld-cli",
        });

        const headers = await buildOpenMeldRequestContextHeadersWithAuth({
          requestUrl: "https://gateway.openmeld.invalid/v1/spaces/demo/signals",
          requestContext: REQUEST_CONTEXT,
        });

        expect(headers.Authorization).toBe("Bearer stored-token");
        expect(headers["x-openmeld-profile-id"]).toBe("profile-id-1");
        expect(headers["x-openmeld-profile-kind"]).toBe("human");
        expect(headers["x-openmeld-profile-name"]).toBe("Mira");
        expect(headers["x-openmeld-profile"]).toBeUndefined();
      } finally {
        if (previousForceInsecureToken === undefined) {
          Reflect.deleteProperty(
            process.env,
            "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
          );
        } else {
          process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN =
            previousForceInsecureToken;
        }
      }
    });
  });

  it("omits Authorization header when no session exists", async () => {
    await withTempHome(async () => {
      const headers = await buildOpenMeldRequestContextHeadersWithAuth({
        requestUrl: "https://gateway.openmeld.invalid/v1/spaces/demo/signals",
        requestContext: REQUEST_CONTEXT,
      });

      expect(headers.Authorization).toBeUndefined();
      expect(headers["x-openmeld-profile-id"]).toBe("profile-id-1");
    });
  });

  it("fails locally instead of sending a request with expired stored credentials", async () => {
    await withTempHome(async () => {
      const previousForceInsecureToken =
        process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN;
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      try {
        await setAuthSession({
          accessToken: "stored-token-expired",
          tokenType: "Bearer",
          authBaseUrl: "https://auth.openmeld.invalid",
          clientId: "openmeld-cli",
          expiresAt: new Date(Date.now() - 60_000).toISOString(),
        });

        await expect(
          buildOpenMeldRequestContextHeadersWithAuth({
            requestUrl:
              "https://gateway.openmeld.invalid/v1/spaces/demo/signals",
            requestContext: REQUEST_CONTEXT,
          })
        ).rejects.toMatchObject({
          name: "AuthRequestCredentialError",
          reason: "session_expired",
        });
      } finally {
        if (previousForceInsecureToken === undefined) {
          Reflect.deleteProperty(
            process.env,
            "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
          );
        } else {
          process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN =
            previousForceInsecureToken;
        }
      }
    });
  });

  it("fails locally for an untrusted request host", async () => {
    await withTempHome(async () => {
      const previousForceInsecureToken =
        process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN;
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      try {
        await setAuthSession({
          accessToken: "stored-token",
          tokenType: "Bearer",
          authBaseUrl: "https://auth.openmeld.invalid",
          clientId: "openmeld-cli",
        });

        await expect(
          buildOpenMeldRequestContextHeadersWithAuth({
            requestUrl: "https://evil.example.com/v1/spaces/demo/signals",
            requestContext: REQUEST_CONTEXT,
          })
        ).rejects.toMatchObject({
          name: "AuthRequestCredentialError",
          reason: "host_mismatch",
        });
      } finally {
        if (previousForceInsecureToken === undefined) {
          Reflect.deleteProperty(
            process.env,
            "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
          );
        } else {
          process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN =
            previousForceInsecureToken;
        }
      }
    });
  });

  it("adds Authorization header for gateway sibling of auth host", async () => {
    await withTempHome(async () => {
      const previousForceInsecureToken =
        process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN;
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      try {
        await setAuthSession({
          accessToken: "stored-token",
          tokenType: "Bearer",
          authBaseUrl: "https://auth.internal.example",
          clientId: "openmeld-cli",
        });

        const headers = await buildOpenMeldRequestContextHeadersWithAuth({
          requestUrl: "https://gateway.internal.example/v1/spaces/demo/signals",
          requestContext: REQUEST_CONTEXT,
        });

        expect(headers.Authorization).toBe("Bearer stored-token");
      } finally {
        if (previousForceInsecureToken === undefined) {
          Reflect.deleteProperty(
            process.env,
            "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
          );
        } else {
          process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN =
            previousForceInsecureToken;
        }
      }
    });
  });

  it("fails locally for non-loopback http gateway host", async () => {
    await withTempHome(async () => {
      const previousForceInsecureToken =
        process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN;
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      try {
        await setAuthSession({
          accessToken: "stored-token",
          tokenType: "Bearer",
          authBaseUrl: "https://auth.internal.example",
          clientId: "openmeld-cli",
        });

        await expect(
          buildOpenMeldRequestContextHeadersWithAuth({
            requestUrl:
              "http://gateway.internal.example/v1/spaces/demo/signals",
            requestContext: REQUEST_CONTEXT,
          })
        ).rejects.toMatchObject({
          name: "AuthRequestCredentialError",
          reason: "insecure_transport",
        });
      } finally {
        if (previousForceInsecureToken === undefined) {
          Reflect.deleteProperty(
            process.env,
            "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
          );
        } else {
          process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN =
            previousForceInsecureToken;
        }
      }
    });
  });

  it("fails locally for non-loopback ws gateway host", async () => {
    await withTempHome(async () => {
      const previousForceInsecureToken =
        process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN;
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      try {
        await setAuthSession({
          accessToken: "stored-token",
          tokenType: "Bearer",
          authBaseUrl: "https://auth.internal.example",
          clientId: "openmeld-cli",
        });

        await expect(
          buildOpenMeldRequestContextHeadersWithAuth({
            requestUrl: "ws://gateway.internal.example/v1/spaces/demo/stream",
            requestContext: REQUEST_CONTEXT,
          })
        ).rejects.toMatchObject({
          name: "AuthRequestCredentialError",
          reason: "insecure_transport",
        });
      } finally {
        if (previousForceInsecureToken === undefined) {
          Reflect.deleteProperty(
            process.env,
            "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
          );
        } else {
          process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN =
            previousForceInsecureToken;
        }
      }
    });
  });

  it("adds Authorization header for non-loopback wss gateway host", async () => {
    await withTempHome(async () => {
      const previousForceInsecureToken =
        process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN;
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      try {
        await setAuthSession({
          accessToken: "stored-token",
          tokenType: "Bearer",
          authBaseUrl: "https://auth.internal.example",
          clientId: "openmeld-cli",
        });

        const headers = await buildOpenMeldRequestContextHeadersWithAuth({
          requestUrl: "wss://gateway.internal.example/v1/spaces/demo/stream",
          requestContext: REQUEST_CONTEXT,
        });

        expect(headers.Authorization).toBe("Bearer stored-token");
      } finally {
        if (previousForceInsecureToken === undefined) {
          Reflect.deleteProperty(
            process.env,
            "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
          );
        } else {
          process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN =
            previousForceInsecureToken;
        }
      }
    });
  });

  it("adds Authorization header for loopback http hosts", async () => {
    await withTempHome(async () => {
      const previousForceInsecureToken =
        process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN;
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      try {
        await setAuthSession({
          accessToken: "stored-token",
          tokenType: "Bearer",
          authBaseUrl: "http://127.0.0.1:8788",
          clientId: "openmeld-cli",
        });

        const headers = await buildOpenMeldRequestContextHeadersWithAuth({
          requestUrl: "http://localhost:8080/v1/spaces/demo/signals",
          requestContext: REQUEST_CONTEXT,
        });

        expect(headers.Authorization).toBe("Bearer stored-token");
      } finally {
        if (previousForceInsecureToken === undefined) {
          Reflect.deleteProperty(
            process.env,
            "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
          );
        } else {
          process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN =
            previousForceInsecureToken;
        }
      }
    });
  });

  it("adds Authorization header for loopback ws hosts", async () => {
    await withTempHome(async () => {
      const previousForceInsecureToken =
        process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN;
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      try {
        await setAuthSession({
          accessToken: "stored-token",
          tokenType: "Bearer",
          authBaseUrl: "http://127.0.0.1:8788",
          clientId: "openmeld-cli",
        });

        const headers = await buildOpenMeldRequestContextHeadersWithAuth({
          requestUrl: "ws://localhost:8080/v1/spaces/demo/stream",
          requestContext: REQUEST_CONTEXT,
        });

        expect(headers.Authorization).toBe("Bearer stored-token");
      } finally {
        if (previousForceInsecureToken === undefined) {
          Reflect.deleteProperty(
            process.env,
            "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
          );
        } else {
          process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN =
            previousForceInsecureToken;
        }
      }
    });
  });

  it("writes x-openmeld-space-password header as canonical password text", async () => {
    await withTempHome(async () => {
      const headers = await buildOpenMeldRequestContextHeadersWithAuth({
        requestUrl: "https://gateway.openmeld.invalid/v1/spaces/demo/signals",
        requestContext: REQUEST_CONTEXT,
        spacePassword: "  P@ss word  ",
      });

      expect(headers["x-openmeld-space-password"]).toBe("P@ss word");
    });
  });

  it("does not write x-openmeld-space-password header for empty string", async () => {
    await withTempHome(async () => {
      const headers = await buildOpenMeldRequestContextHeadersWithAuth({
        requestUrl: "https://gateway.openmeld.invalid/v1/spaces/demo/signals",
        requestContext: REQUEST_CONTEXT,
        spacePassword: "",
      });

      expect(headers["x-openmeld-space-password"]).toBeUndefined();
    });
  });
});
