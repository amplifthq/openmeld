#!/usr/bin/env node
import { fileURLToPath } from "node:url";

const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";
const HEALTH_CHECK_ALERT_TYPE = "health_check_status_notification";
const WORKERS_ALERT_TYPE = "workers_alert";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(
      "Run `node scripts/cloudflare/provision-monitoring.mjs --help` for usage."
    );
    process.exitCode = 1;
  });
}

export function parseProvisionMonitoringArgs(rawArgs, env = process.env) {
  const parsed = {
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: env.CLOUDFLARE_API_TOKEN,
    apply: false,
    email: env.CLOUDFLARE_NOTIFICATION_EMAIL,
    zoneId: env.CLOUDFLARE_ZONE_ID,
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--help" || arg === "-h") {
      return { help: true };
    }
    if (arg === "--apply") {
      parsed.apply = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument "${arg}".`);
    }

    const option = readOptionValue(rawArgs, index);
    index = option.nextIndex;
    const key = {
      "account-id": "accountId",
      "api-token": "apiToken",
      email: "email",
      "zone-id": "zoneId",
    }[option.key];
    if (!key) {
      throw new Error(`Unknown option "${arg}".`);
    }
    parsed[key] = option.value;
  }

  if (parsed.email && !EMAIL_RE.test(parsed.email)) {
    throw new Error("--email must be a valid notification email address.");
  }
  return parsed;
}

export function buildDesiredMonitoring({ email }) {
  if (!(email && EMAIL_RE.test(email))) {
    throw new Error(
      "Missing notification email. Pass --email or set CLOUDFLARE_NOTIFICATION_EMAIL."
    );
  }

  const healthChecks = [
    buildHealthCheck({
      address: "openmeld.ai",
      description: "OpenMeld Web public HTTPS availability",
      name: "openmeld-web-health",
      path: "/",
    }),
    buildHealthCheck({
      address: "gateway.openmeld.ai",
      description: "OpenMeld Gateway public health endpoint",
      name: "openmeld-gateway-health",
      path: "/health",
    }),
    buildHealthCheck({
      address: "auth.openmeld.ai",
      description: "OpenMeld Auth public health endpoint",
      name: "openmeld-auth-health",
      path: "/health",
    }),
  ];

  return {
    healthChecks,
    notificationPolicies: [
      {
        alert_type: HEALTH_CHECK_ALERT_TYPE,
        description:
          "Email operations when a managed OpenMeld public health check changes status.",
        enabled: true,
        mechanisms: { email: [{ id: email }] },
        name: "openmeld-health-check-status",
      },
      {
        alert_type: WORKERS_ALERT_TYPE,
        description: "Email operations for Cloudflare Workers usage alerts.",
        enabled: true,
        mechanisms: { email: [{ id: email }] },
        name: "openmeld-workers-usage",
      },
    ],
  };
}

export async function provisionMonitoring(input) {
  const log = input.log ?? console.log;
  const desired = buildDesiredMonitoring({ email: input.email });

  if (!input.apply) {
    const summary = buildDryRunSummary(desired);
    log(JSON.stringify(summary, null, 2));
    log(
      "No Cloudflare API writes were made. Re-run with --apply to reconcile."
    );
    return summary;
  }

  validateApplyCredentials(input);
  const client = input.client ?? createCloudflareClient(input);
  const summary = {
    blocked: [],
    healthChecks: [],
    mode: "apply",
    notificationPolicies: [],
    ok: false,
    verification: {},
  };

  let healthCheckIds = [];
  try {
    const currentHealthChecks = await client.listHealthChecks();
    for (const healthCheck of desired.healthChecks) {
      const result = await reconcileNamedResource({
        create: client.createHealthCheck,
        current: currentHealthChecks,
        desired: healthCheck,
        kind: "health check",
        update: client.updateHealthCheck,
      });
      currentHealthChecks.splice(
        0,
        currentHealthChecks.length,
        ...replaceNamedResource(currentHealthChecks, result.resource)
      );
      summary.healthChecks.push(toResourceSummary(result));
    }
    healthCheckIds = summary.healthChecks.map((check) => check.id);
  } catch (error) {
    summary.blocked.push(
      `Health Checks blocked: ${formatError(error)} Required permission: zone Health Checks Write.`
    );
  }

  try {
    const [availableAlertTypes, currentPolicies] = await Promise.all([
      client.listAvailableAlertTypes(),
      client.listNotificationPolicies(),
    ]);
    for (const basePolicy of desired.notificationPolicies) {
      if (!availableAlertTypes.has(basePolicy.alert_type)) {
        summary.blocked.push(
          `Notification policy "${basePolicy.name}" blocked: account available_alerts does not expose ${basePolicy.alert_type}. See docs/cloudflare-monitoring-runbook.md.`
        );
        continue;
      }
      if (
        basePolicy.alert_type === HEALTH_CHECK_ALERT_TYPE &&
        healthCheckIds.length !== desired.healthChecks.length
      ) {
        summary.blocked.push(
          `Notification policy "${basePolicy.name}" blocked: all managed health check IDs must be available first.`
        );
        continue;
      }

      const policy =
        basePolicy.alert_type === HEALTH_CHECK_ALERT_TYPE
          ? {
              ...basePolicy,
              filters: { health_check_id: healthCheckIds },
            }
          : basePolicy;
      const result = await reconcileNamedResource({
        create: client.createNotificationPolicy,
        current: currentPolicies,
        desired: policy,
        kind: "notification policy",
        update: client.updateNotificationPolicy,
      });
      currentPolicies.splice(
        0,
        currentPolicies.length,
        ...replaceNamedResource(currentPolicies, result.resource)
      );
      summary.notificationPolicies.push(toResourceSummary(result));
    }
  } catch (error) {
    summary.blocked.push(
      `Notifications blocked: ${formatError(error)} Required permission: account Notifications Write.`
    );
  }

  await attachVerification({ client, desired, summary });
  summary.ok = summary.blocked.length === 0;
  log(JSON.stringify(summary, null, 2));
  return summary;
}

async function runCli(rawArgs) {
  const parsed = parseProvisionMonitoringArgs(rawArgs);
  if (parsed.help) {
    printHelp();
    return;
  }
  const summary = await provisionMonitoring(parsed);
  if (!summary.ok && summary.mode === "apply") {
    process.exitCode = 1;
  }
}

function buildHealthCheck({ address, description, name, path }) {
  return {
    address,
    consecutive_fails: 2,
    consecutive_successes: 1,
    description,
    http_config: {
      allow_insecure: false,
      expected_codes: ["2xx"],
      follow_redirects: true,
      header: { Host: [address] },
      method: "GET",
      path,
      port: 443,
    },
    interval: 60,
    name,
    retries: 0,
    suspended: false,
    timeout: 5,
    type: "HTTPS",
  };
}

function buildDryRunSummary(desired) {
  return {
    healthChecks: desired.healthChecks.map((check) => ({
      action: "create, update, or skip by name after API read",
      desired: check,
      name: check.name,
    })),
    mode: "dry-run",
    notificationPolicies: desired.notificationPolicies.map((policy) => ({
      action: "create, update, or skip by name after API read",
      desired:
        policy.alert_type === HEALTH_CHECK_ALERT_TYPE
          ? {
              ...policy,
              filters: {
                health_check_id:
                  "resolved from the three managed health checks during apply",
              },
            }
          : policy,
      name: policy.name,
    })),
    note: `${WORKERS_ALERT_TYPE} is reconciled only when the account's available_alerts endpoint exposes it.`,
    ok: true,
  };
}

async function reconcileNamedResource(input) {
  const matches = input.current.filter(
    (resource) => resource.name === input.desired.name
  );
  if (matches.length > 1) {
    throw new Error(
      `Found ${String(matches.length)} ${input.kind}s named "${input.desired.name}"; remove duplicates before retrying.`
    );
  }
  const existing = matches[0];
  if (!existing) {
    const created = await input.create(input.desired);
    return {
      action: "created",
      resource: { ...input.desired, ...created },
    };
  }
  if (matchesDesiredShape(existing, input.desired)) {
    return { action: "unchanged", resource: existing };
  }
  const updated = await input.update(existing.id, input.desired);
  return {
    action: "updated",
    resource: { ...input.desired, ...updated, id: existing.id },
  };
}

function matchesDesiredShape(existing, desired) {
  return Object.entries(desired).every(([key, value]) => {
    if (isPlainObject(value)) {
      return (
        isPlainObject(existing[key]) &&
        matchesDesiredShape(existing[key], value)
      );
    }
    return JSON.stringify(existing[key]) === JSON.stringify(value);
  });
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function replaceNamedResource(resources, replacement) {
  return [
    ...resources.filter((resource) => resource.name !== replacement.name),
    replacement,
  ];
}

function toResourceSummary(result) {
  const summary = {
    action: result.action,
    id: result.resource.id,
    name: result.resource.name,
  };
  if (!summary.id) {
    throw new Error(`Cloudflare did not return an id for "${summary.name}".`);
  }
  return summary;
}

function createCloudflareClient(input) {
  const fetchImpl = input.fetchImpl ?? fetch;
  const request = async (path, init = {}) => {
    const response = await fetchImpl(`${CLOUDFLARE_API_BASE}${path}`, {
      ...init,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      headers: {
        Authorization: `Bearer ${input.apiToken}`,
        ...(init.body === undefined
          ? {}
          : { "Content-Type": "application/json" }),
      },
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    let envelope;
    try {
      envelope = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(
        `Cloudflare API ${init.method ?? "GET"} ${path} returned invalid JSON (${String(response.status)}).`
      );
    }
    if (!response.ok || envelope.success === false) {
      const details = Array.isArray(envelope.errors)
        ? envelope.errors
            .map((error) => error.message ?? JSON.stringify(error))
            .join("; ")
        : text;
      throw new Error(
        `Cloudflare API ${init.method ?? "GET"} ${path} failed (${String(response.status)}): ${details || "unknown error"}`
      );
    }
    return envelope.result;
  };

  const zonePath = `/zones/${encodeURIComponent(input.zoneId)}/healthchecks`;
  const policyPath = `/accounts/${encodeURIComponent(input.accountId)}/alerting/v3/policies`;
  return {
    createHealthCheck: (body) => request(zonePath, { body, method: "POST" }),
    createNotificationPolicy: (body) =>
      request(policyPath, { body, method: "POST" }),
    listAvailableAlertTypes: async () => {
      const result = await request(
        `/accounts/${encodeURIComponent(input.accountId)}/alerting/v3/available_alerts`
      );
      return collectAvailableAlertTypes(result);
    },
    listHealthChecks: async () =>
      requireArray(await request(zonePath), zonePath),
    listNotificationPolicies: async () =>
      requireArray(await request(policyPath), policyPath),
    updateHealthCheck: (id, body) =>
      request(`${zonePath}/${encodeURIComponent(id)}`, {
        body,
        method: "PUT",
      }),
    updateNotificationPolicy: (id, body) =>
      request(`${policyPath}/${encodeURIComponent(id)}`, {
        body,
        method: "PUT",
      }),
  };
}

export function collectAvailableAlertTypes(result) {
  const types = new Set();
  const visit = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }
    if (!isPlainObject(value)) {
      return;
    }
    if (typeof value.type === "string") {
      types.add(value.type);
    }
    for (const nested of Object.values(value)) {
      visit(nested);
    }
  };
  visit(result);
  return types;
}

function requireArray(value, path) {
  if (!Array.isArray(value)) {
    throw new Error(`Cloudflare API GET ${path} returned a non-array result.`);
  }
  return value;
}

async function attachVerification({ client, desired, summary }) {
  if (summary.healthChecks.length > 0) {
    try {
      const healthChecks = await client.listHealthChecks();
      const verifiedHealthChecks = healthChecks
        .filter((check) =>
          desired.healthChecks.some(
            (desiredCheck) => desiredCheck.name === check.name
          )
        )
        .map(({ address, id, name, status }) => ({
          address,
          id,
          name,
          status: status ?? "pending Cloudflare evaluation",
        }));
      summary.verification.healthChecks = verifiedHealthChecks;
      appendMissingVerification({
        blocked: summary.blocked,
        expected: summary.healthChecks,
        kind: "Health Check",
        verified: verifiedHealthChecks,
      });
    } catch (error) {
      summary.blocked.push(
        `Health Check verification query blocked: ${formatError(error)}`
      );
    }
  }
  if (summary.notificationPolicies.length > 0) {
    try {
      const policies = await client.listNotificationPolicies();
      const verifiedPolicies = policies
        .filter((policy) =>
          desired.notificationPolicies.some(
            (desiredPolicy) => desiredPolicy.name === policy.name
          )
        )
        .map(({ alert_type: alertType, enabled, id, name }) => ({
          alertType,
          enabled,
          id,
          name,
        }));
      summary.verification.notificationPolicies = verifiedPolicies;
      appendMissingVerification({
        blocked: summary.blocked,
        expected: summary.notificationPolicies,
        kind: "Notification policy",
        verified: verifiedPolicies,
      });
    } catch (error) {
      summary.blocked.push(
        `Notification policy verification query blocked: ${formatError(error)}`
      );
    }
  }

  function appendMissingVerification({ blocked, expected, kind, verified }) {
    const missing = expected.filter(
      (resource) =>
        !verified.some(
          (candidate) =>
            candidate.id === resource.id && candidate.name === resource.name
        )
    );
    if (missing.length > 0) {
      blocked.push(
        `${kind} verification did not return: ${missing
          .map((resource) => `${resource.name} (${resource.id})`)
          .join(", ")}.`
      );
    }
  }
}

function validateApplyCredentials(input) {
  const missing = [
    ["CLOUDFLARE_API_TOKEN", input.apiToken],
    ["CLOUDFLARE_ACCOUNT_ID", input.accountId],
    ["CLOUDFLARE_ZONE_ID", input.zoneId],
  ]
    .filter(([, value]) => !value?.trim())
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(
      `Cannot apply: missing ${missing.join(", ")}. Dry-run does not require these credentials.`
    );
  }
}

function readOptionValue(rawArgs, index) {
  const arg = rawArgs[index];
  const equalIndex = arg.indexOf("=");
  if (equalIndex > 0) {
    return {
      key: arg.slice(2, equalIndex),
      nextIndex: index,
      value: arg.slice(equalIndex + 1),
    };
  }
  const value = rawArgs[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${arg}.`);
  }
  return { key: arg.slice(2), nextIndex: index + 1, value };
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

function printHelp() {
  console.log(`Usage:
  CLOUDFLARE_NOTIFICATION_EMAIL=ops@example.com \\
    node scripts/cloudflare/provision-monitoring.mjs
  CLOUDFLARE_NOTIFICATION_EMAIL=ops@example.com \\
    node scripts/cloudflare/provision-monitoring.mjs --apply

Default behavior is a no-network dry-run that prints the complete desired plan.

Options:
  --apply                    Read and reconcile Cloudflare resources. Without this flag, no API call is made.
  --email <address>          Notification destination. Defaults to CLOUDFLARE_NOTIFICATION_EMAIL.
  --account-id <id>          Defaults to CLOUDFLARE_ACCOUNT_ID. Required with --apply.
  --zone-id <id>             Defaults to CLOUDFLARE_ZONE_ID. Required with --apply.
  --api-token <token>        Defaults to CLOUDFLARE_API_TOKEN. Required with --apply.
  --help                     Show this help.
`);
}
