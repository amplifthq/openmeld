# Cloudflare Monitoring Provisioning Runbook

This runbook provisions OpenMeld's public HTTPS health checks and account-level
email notification policies. The script is safe to run repeatedly: it reconciles
resources by stable name and creates, updates, or skips each resource.

The script manages only Cloudflare monitoring resources. It does not deploy or
modify any Worker, custom domain, or Wrangler configuration.

## Managed resources

| Resource            | Stable name                    | Target                                     |
| ------------------- | ------------------------------ | ------------------------------------------ |
| HTTPS health check  | `openmeld-web-health`          | `https://openmeld.ai/`                     |
| HTTPS health check  | `openmeld-gateway-health`      | `https://gateway.openmeld.ai/health`       |
| HTTPS health check  | `openmeld-auth-health`         | `https://auth.openmeld.ai/health`          |
| Notification policy | `openmeld-health-check-status` | Status changes for the three health checks |
| Notification policy | `openmeld-workers-usage`       | Cloudflare `workers_alert` events          |

Each health check runs every 60 seconds and becomes unhealthy after two
consecutive failures. It expects an HTTPS `2xx` response, follows redirects, and
validates the TLS certificate.

## Prerequisites

Use a scoped API token with both of these permissions:

- Zone / Health Checks / Write for the `openmeld.ai` zone.
- Account / Notifications / Write for the OpenMeld Cloudflare account.

Cloudflare's API reference accepts Health Checks Write for health-check reads and
writes, and Notifications Write for notification-policy reads and writes. The
account and zone IDs are visible in the Cloudflare dashboard. Standalone Health
Checks require an eligible Cloudflare zone plan.

Set credentials only in the invoking shell or secret manager. Do not write them
to this repository.

```sh
export CLOUDFLARE_API_TOKEN='<scoped token>'
export CLOUDFLARE_ACCOUNT_ID='<account id>'
export CLOUDFLARE_ZONE_ID='<openmeld.ai zone id>'
export CLOUDFLARE_NOTIFICATION_EMAIL='ops@example.com'
```

`--email`, `--account-id`, `--zone-id`, and `--api-token` can override the
corresponding environment variables. Prefer the environment for the API token so
it does not enter shell history.

## Preview and apply

The default mode is a no-network dry-run. It prints the complete desired plan and
does not even issue read requests.

```sh
node scripts/cloudflare/provision-monitoring.mjs
```

Apply the plan explicitly:

```sh
node scripts/cloudflare/provision-monitoring.mjs --apply
```

Apply performs these steps:

1. Lists zone health checks and reconciles the three stable names.
2. Reads the account's `available_alerts` response.
3. Lists notification policies and reconciles supported policy types.
4. Re-queries health checks and notification policies and prints a bounded JSON
   verification echo containing names, IDs, states, and actions.

Cloudflare alert availability is account-specific. The script creates the
`workers_alert` policy only when `available_alerts` exposes that exact type. A
missing type is reported as a blocked item instead of being treated as success.

## Verify

Run the apply command a second time. Every managed resource should report
`unchanged`, and `blocked` should be empty.

Confirm the endpoints independently:

```sh
curl --fail --silent --show-error https://openmeld.ai/ >/dev/null
curl --fail --silent --show-error https://gateway.openmeld.ai/health
curl --fail --silent --show-error https://auth.openmeld.ai/health
```

Query Cloudflare directly and inspect the managed names:

```sh
curl --fail --silent --show-error \
  "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/healthchecks" \
  --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  | jq '.result[] | select(.name | startswith("openmeld-")) | {id,name,address,status}'

curl --fail --silent --show-error \
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/alerting/v3/policies" \
  --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  | jq '.result[] | select(.name | startswith("openmeld-")) | {id,name,alert_type,enabled}'
```

In the dashboard, verify the health checks under the `openmeld.ai` zone's Health
Checks area and the policies under account-level **Notifications**. Confirm that
the destination email is correct and enabled.

## Roll back

Rollback deletes only resources with the stable names in the table above. First
list the resources and copy their IDs using the verification commands. Then
delete each selected resource:

```sh
curl --fail --silent --show-error --request DELETE \
  "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/healthchecks/<health-check-id>" \
  --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}"

curl --fail --silent --show-error --request DELETE \
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/alerting/v3/policies/<policy-id>" \
  --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}"
```

Re-run both list queries and confirm that only the intended stable names were
removed. Never delete a resource by position or an unverified ID.

## Workers error-rate alerts

The newer `workers_observability_alert` configuration surface is not stable
enough in the public API contract to automate safely. Complete the five-minute
dashboard checklist in
[`cloudflare-workers-error-rate-alerts.md`](./cloudflare-workers-error-rate-alerts.md)
instead.

## References

- [Cloudflare Health Checks API](https://developers.cloudflare.com/api/resources/healthchecks/)
- [Cloudflare Alerting API](https://developers.cloudflare.com/api/resources/alerting/)
- [Cloudflare Workers metrics and analytics](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/)
