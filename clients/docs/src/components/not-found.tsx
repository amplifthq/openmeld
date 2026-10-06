import { HomeLayout } from "fumadocs-ui/layouts/home";
import { baseOptions } from "@/lib/layout.shared";

export function NotFound() {
  return (
    <HomeLayout {...baseOptions()}>
      <div className="mx-auto flex min-h-[70vh] max-w-xl flex-col justify-center px-6">
        <p className="text-fd-muted-foreground text-sm">404</p>
        <h1 className="mt-3 font-semibold text-3xl">This page isn't here.</h1>
        <p className="mt-4 text-fd-muted-foreground">
          The link may be out of date. Start with the guides or search for what
          you need.
        </p>
        <Link
          className="mt-6 font-medium underline underline-offset-4"
          params={{ _splat: "" }}
          to="/docs/$"
        >
          Browse the guides
        </Link>
      </div>
    </HomeLayout>
  );
}

import { Link } from "@tanstack/react-router";
