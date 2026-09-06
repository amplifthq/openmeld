"""Starter organization for fixture directories; preserve existing user arrangement."""


def seed(context):
    snapshot = context.request("auth", f"/v1/account/sidebar?organizationId={context.org['id']}")
    prefs = snapshot["preferences"]
    changed = False
    for area, prefix, label, ordinary in [
        ("people", "human:", "Design partners", "people"),
        ("agents", "agent:", "Product crew", "items"),
    ]:
        current = prefs.get(area)
        if current and (current["groups"] or current["starred"]["itemIds"] or current[ordinary]["itemIds"]):
            continue
        ids = [("agt_" if area == "agents" else "") + context.ident(prefix + str(i)) for i in range(4)]
        prefs[area] = {"starred": {"sort": "manual", "itemIds": ids[:1]},
                       ordinary: {"sort": "priority", "itemIds": []},
                       "groups": [{"id": context.ident(f"group:{area}"), "name": label,
                                   "sort": "manual", "itemIds": ids[1:]}]}
        changed = True
    if changed:
        context.request("auth", "/v1/account/sidebar", {
            "organizationId": context.org["id"], "revision": snapshot["revision"], "preferences": prefs,
        }, method="PUT")
