"""Worktree-local test credentials; browser authentication remains unchanged."""
import json
import os
import secrets


def generate_credentials():
    return {"name": secrets.choice(["Maya Chen", "Alex Morgan", "Jordan Rivera", "Casey Lee"]),
            "email": f"dev-{secrets.token_hex(4)}@example.com",
            "password": f"dev{secrets.randbelow(100000):05d}"}


def prepare_account(context, new=False):
    path = context.state.parent / "dev-accounts.json"
    lock = path.with_suffix(".lock")
    try:
        descriptor = os.open(lock, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        raise RuntimeError("Another account command holds this lane's dev-accounts.lock. Wait for it to finish.") from None
    try:
        os.close(descriptor)
        store = json.loads(path.read_text()) if path.exists() else {
            "laneId": context.lane["laneId"], "activeEmail": None, "accounts": []}
        if store["laneId"] != context.lane["laneId"]:
            raise RuntimeError("The saved test account belongs to another worktree lane.")
        if not new:
            account = next((a for a in store["accounts"] if a["email"] == store["activeEmail"]), None)
            if account:
                user = context.db.execute("SELECT id FROM users WHERE email=?", (account["email"],)).fetchone()
                if user and user["id"] == account["userId"]:
                    return account
                if user:
                    raise RuntimeError("The saved test account no longer matches the local database.")
                # A discarded local DB gets a fresh account; keep old credentials in history.
        account = generate_credentials()
        context.backup_database()
        context.request("auth", "/api/auth/sign-up/email", account)
        user = context.db.execute("SELECT id FROM users WHERE email=?", (account["email"],)).fetchone()
        if not user:
            raise RuntimeError("The local signup did not create the test account.")
        # Pre-verify only the newly created fictional email. Password hashing and
        # all subsequent sign-in/session checks still belong to normal Auth.
        with context.db:
            context.db.execute("UPDATE users SET email_verified=1 WHERE id=?", (user["id"],))
        account["userId"] = user["id"]
        store["accounts"].append(account)
        store["activeEmail"] = account["email"]
        temporary = path.with_suffix(".tmp")
        with os.fdopen(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as target:
            json.dump(store, target, indent=2)
            target.write("\n")
        os.replace(temporary, path)
        return account
    finally:
        lock.unlink()
