import { createFileRoute, Link } from "@tanstack/react-router";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import { baseOptions } from "@/lib/layout.shared";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return (
    <HomeLayout {...baseOptions()}>
      <div className="flex flex-1 flex-col justify-center px-4 py-8 text-center">
        <h1 className="mb-4 font-medium text-xl">OpenMeld Docs</h1>
        <p className="mb-6 text-fd-muted-foreground">
          Documentation template preview.
        </p>
        <Link
          className="mx-auto rounded-lg bg-fd-primary px-3 py-2 font-medium text-fd-primary-foreground text-sm"
          params={{
            _splat: "",
          }}
          to="/docs/$"
        >
          Open docs
        </Link>
      </div>
    </HomeLayout>
  );
}
