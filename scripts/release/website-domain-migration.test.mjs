import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  admitWebsiteDomainRelease,
  checkWebsiteDomainEndpoints,
  executeObservedDomainRelease,
  prepareWebsiteDomains,
  rollbackWebsiteDomains,
  websiteDomainNames,
} from "./website-domain-migration.mjs";

const names = websiteDomainNames();
const oldVersion = "210101cc-ca71-4741-8ddc-37b0f4d7013b";
const newVersion = "c0002146-bfd7-4ed7-9bd0-3351be4a3cd7";
const authVersion = "1c490b3e-be27-4192-8df7-fac4ee60c7fa";
const sourceSha = "a".repeat(40);
const needsPreparation = /Prepare and verify/u;
const wrongStage = /Run migration stages separately/u;
const needsSmoke = /real App login/u;
const staleSmoke = /currently deployed/u;
const interveningDeployment = /intervening deployments/u;
const unexpectedOwner = /Unexpected website/u;
const invalidPosthogMetadata = /PostHog OAuth/u;

// Public fields captured from the production CIMD document on 2026-10-03.
const posthogMetadata = {
  client_id: "https://openmeld.ai/.well-known/posthog-client.json",
  redirect_uris: ["https://connectors.openmeld.ai/oauth/callback"],
};
function healthyEndpoint(url) {
  return url.endsWith("/.well-known/posthog-client.json")
    ? Response.json(posthogMetadata)
    : new Response("healthy");
}

test("domain health preserves the existing PostHog client URL and rejects HTML, redirects, or changed callbacks", async () => {
  await checkWebsiteDomainEndpoints(names, healthyEndpoint);
  for (const invalid of [
    () =>
      new Response("<html>Website</html>", {
        headers: { "Content-Type": "text/html" },
      }),
    () =>
      Response.redirect(
        "https://app.openmeld.ai/.well-known/posthog-client.json",
        307
      ),
    () =>
      Response.json({
        ...posthogMetadata,
        redirect_uris: ["https://app.openmeld.ai/callback"],
      }),
  ]) {
    await assert.rejects(
      checkWebsiteDomainEndpoints(names, (url) =>
        url.endsWith("/.well-known/posthog-client.json")
          ? invalid()
          : healthyEndpoint(url)
      ),
      invalidPosthogMetadata
    );
  }
});

// Domain/deployment shapes captured from the isolated Cloudflare domain trial.
function fixture(names = websiteDomainNames()) {
  const domains = [
    {
      id: "root-domain",
      hostname: names.root,
      service: names.web,
      environment: "production",
      zone_id: "zone",
    },
  ];
  const writes = [];
  const versions = {
    [names.web]: oldVersion,
    [names.auth]: authVersion,
    [names.website]: newVersion,
  };
  const client = {
    accountId: "trial-account",
    request(url, method = "GET", body = null) {
      if (method !== "GET") {
        writes.push({ url, method, body });
        if (url === "/workers/domains") {
          domains.push({
            ...body,
            id: "app-domain",
            environment: "production",
          });
        } else {
          versions[names.web] = body.versions[0].version_id;
        }
        return {};
      }
      if (url === "/workers/domains") {
        return domains;
      }
      if (url.endsWith("/settings")) {
        return {
          bindings: [
            {
              name: "WEB_APP_URL",
              type: "plain_text",
              text: `https://${names.app}`,
            },
            {
              name: "AUTH_LEGACY_APP_ORIGIN",
              type: "plain_text",
              text: `https://${names.root}`,
            },
          ],
        };
      }
      const worker = url.split("/")[3];
      return {
        deployments: [
          {
            id: `deployment-${worker}`,
            versions: [{ version_id: versions[worker], percentage: 100 }],
          },
        ],
      };
    },
  };
  return { client, domains, writes, versions };
}

test("only a complete staging refresh can replace the old domain layout without session continuity", async () => {
  const staging = fixture(websiteDomainNames("stg"));
  const scopes = ["auth", "core", "gateway", "web", "website"];
  const input = {
    client: staging.client,
    sourceSha,
    scopes,
    environment: "stg",
  };
  assert.ok(await admitWebsiteDomainRelease(input));
  assert.equal(staging.writes.length, 0);
  for (const missing of scopes) {
    await assert.rejects(
      admitWebsiteDomainRelease({
        ...input,
        scopes: scopes.filter((scope) => scope !== missing),
      }),
      needsPreparation
    );
  }
  await assert.rejects(
    admitWebsiteDomainRelease({ client: fixture().client, sourceSha, scopes }),
    needsPreparation
  );
  staging.domains[0].service = "unrelated-worker";
  await assert.rejects(admitWebsiteDomainRelease(input), unexpectedOwner);
});

test("preparation preserves the existing deployment and is resumable; cutover requires current App evidence", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "website-domains-"));
  try {
    const { client, writes, versions } = fixture();
    const input = {
      client,
      sourceSha,
      evidencePath: path.join(directory, "evidence.json"),
    };
    await assert.rejects(
      admitWebsiteDomainRelease({ client, sourceSha, scopes: ["auth"] }),
      needsPreparation
    );
    await prepareWebsiteDomains(input);
    await prepareWebsiteDomains(input);
    assert.equal(writes.length, 1);
    assert.equal(versions[names.web], oldVersion);
    await admitWebsiteDomainRelease({ ...input, scopes: ["auth"] });
    for (const scope of ["web", "core", "gateway"]) {
      await assert.rejects(
        admitWebsiteDomainRelease({ ...input, scopes: [scope] }),
        wrongStage
      );
    }
    await assert.rejects(
      admitWebsiteDomainRelease({ ...input, scopes: ["website"] }),
      needsSmoke
    );
    const evidence = JSON.parse(await readFile(input.evidencePath, "utf8"));
    evidence.appSmoke = {
      webVersionId: oldVersion,
      authVersionId: authVersion,
      login: true,
      existingSession: true,
      spaceReadWrite: true,
      signOut: true,
      unsentDraftsHandled: true,
      evidence: "reviewed-browser-evidence.md",
    };
    await writeFile(input.evidencePath, JSON.stringify(evidence));
    await admitWebsiteDomainRelease({ ...input, scopes: ["website"] });
    versions[names.web] = newVersion;
    await assert.rejects(
      admitWebsiteDomainRelease({ ...input, scopes: ["website"] }),
      staleSmoke
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rollback restores the recorded Web version before root ownership and retains the App alias", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "website-domains-"));
  try {
    const { client, domains, writes, versions } = fixture();
    const input = {
      client,
      sourceSha,
      evidencePath: path.join(directory, "evidence.json"),
    };
    await prepareWebsiteDomains(input);
    versions[names.web] = newVersion;
    domains[0].service = names.website;
    await assert.rejects(rollbackWebsiteDomains(input), interveningDeployment);
    const webRelease = { ...input, scopes: ["web"] };
    const admission = await admitWebsiteDomainRelease(webRelease);
    const healthFailure = new Error("App health failed after deployment");
    await assert.rejects(
      executeObservedDomainRelease(webRelease, admission, () => {
        throw healthFailure;
      }),
      (error) => error === healthFailure
    );
    assert.equal(
      JSON.parse(await readFile(input.evidencePath, "utf8")).lastObserved.web
        .versionId,
      newVersion
    );
    await rollbackWebsiteDomains({
      ...input,
      restoreDomainTriggers: () => {
        assert.equal(versions[names.web], oldVersion);
        domains[0].service = names.web;
      },
      fetchImpl: healthyEndpoint,
    });
    assert.equal(writes.at(-1).method, "POST");
    assert.equal(
      domains.find((entry) => entry.hostname === names.app).service,
      names.web
    );
    assert.equal(domains[0].service, names.web);
    domains[0].service = "unrelated-worker";
    await assert.rejects(rollbackWebsiteDomains(input), unexpectedOwner);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
