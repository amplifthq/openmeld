#!/usr/bin/env python3
"""Prepare credentials for signing in through the local product UI."""
import argparse
import json
from pathlib import Path

from fixtures.accounts import prepare_account
from fixtures.context import Context


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--new", action="store_true", help="Create another account and use it for subsequent seeds; keep existing accounts.")
    parser.add_argument("--json", action="store_true", help="Print loginUrl, email, and password as JSON for development agents.")
    args = parser.parse_args()
    context = Context(Path(__file__).resolve().parents[2])
    try:
        account = prepare_account(context, new=args.new)
        result = {"loginUrl": f"http://{context.lane['laneId']}.localhost:{context.lane['ports']['web']}/login",
                  "email": account["email"], "password": account["password"]}
        if args.json:
            print(json.dumps(result))
        else:
            print(f"Sign in: {result['loginUrl']}\nEmail: {result['email']}\nPassword: {result['password']}\n\nSign in through the product page. Run pnpm dev:seed to add sample data.")
    finally:
        context.db.close()


if __name__ == "__main__":
    main()
