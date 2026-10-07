import { createFileRoute, Link } from "@tanstack/react-router";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import {
  ArrowRight,
  BookOpen,
  Download,
  LifeBuoy,
  Monitor,
  Users,
  Workflow,
} from "lucide-react";
import { baseOptions } from "@/lib/layout.shared";

export const Route = createFileRoute("/")({
  component: Home,
  head: () => ({
    links: [{ rel: "canonical", href: "https://docs.openmeld.ai" }],
  }),
});

const guides = [
  {
    icon: BookOpen,
    title: "Start with one useful task",
    text: "Open your workspace, talk to Center Agent, and check your first result.",
    path: "start/quickstart",
    label: "Get started",
  },
  {
    icon: Download,
    title: "Choose how you work",
    text: "Use OpenMeld in your browser, get the desktop preview, or connect a computer.",
    path: "start/downloads",
    label: "Downloads and setup",
  },
  {
    icon: LifeBuoy,
    title: "Get back to work",
    text: "Find help with sign-in, computer connections, and agents that cannot reply.",
    path: "help/troubleshooting",
    label: "Find a fix",
  },
];
const topics = [
  {
    icon: Workflow,
    title: "Work with agents",
    text: "Conversations, Spaces, files, and repeatable work.",
    path: "work/center-agent",
  },
  {
    icon: Monitor,
    title: "Connect your tools",
    text: "Local agents, Projects, Plugins, and Skills.",
    path: "start/connect-computer",
  },
  {
    icon: Users,
    title: "Bring your team",
    text: "Workspaces, invitations, Channels, and access.",
    path: "team/workspaces",
  },
];

function Home() {
  return (
    <HomeLayout {...baseOptions()}>
      <div className="docs-home mx-auto w-full max-w-6xl px-6 py-12 md:px-10 md:py-20">
        <section className="max-w-2xl">
          <p className="mb-4 font-medium text-fd-muted-foreground text-sm">
            OpenMeld documentation
          </p>
          <h1 className="text-balance font-semibold text-4xl tracking-tight md:text-5xl">
            Your first task.
            <br />
            Your team's next step.
          </h1>
          <p className="mt-6 max-w-xl text-pretty text-fd-muted-foreground text-lg leading-8">
            Learn how to give work to AI teammates, bring in the context they
            need, and keep the result where your team can use it.
          </p>
          <Link
            className="mt-7 inline-flex items-center gap-3 rounded-lg bg-fd-primary px-5 py-3 font-medium text-fd-primary-foreground text-sm"
            params={{ _splat: "start/quickstart" }}
            to="/docs/$"
          >
            Start using OpenMeld{" "}
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
          <p className="mt-3 text-fd-muted-foreground text-sm">
            Start in your browser. Connect tools when your task needs them.
          </p>
        </section>
        <section
          aria-label="Popular guides"
          className="mt-14 grid gap-5 md:grid-cols-3"
        >
          {guides.map(({ icon: Icon, ...guide }) => (
            <Link
              className="docs-guide flex flex-col rounded-xl border border-fd-border p-6"
              key={guide.path}
              params={{ _splat: guide.path }}
              to="/docs/$"
            >
              <Icon
                aria-hidden="true"
                className="mb-5 size-5 text-fd-muted-foreground"
              />
              <h2 className="font-semibold text-base">{guide.title}</h2>
              <p className="mt-2 flex-1 text-fd-muted-foreground text-sm leading-6">
                {guide.text}
              </p>
              <span className="mt-5 inline-flex items-center gap-2 font-medium text-sm">
                {guide.label}
                <ArrowRight aria-hidden="true" className="size-3.5" />
              </span>
            </Link>
          ))}
        </section>
        <section
          aria-labelledby="explore-title"
          className="mt-14 border-fd-border border-t pt-9"
        >
          <h2 className="font-semibold text-xl" id="explore-title">
            Build on the basics
          </h2>
          <div className="mt-6 grid gap-8 md:grid-cols-3">
            {topics.map(({ icon: Icon, ...topic }) => (
              <Link
                className="docs-topic flex items-start gap-3 rounded-md"
                key={topic.path}
                params={{ _splat: topic.path }}
                to="/docs/$"
              >
                <Icon
                  aria-hidden="true"
                  className="mt-1 size-5 shrink-0 text-fd-muted-foreground"
                />
                <div>
                  <h3 className="font-medium">{topic.title}</h3>
                  <p className="mt-1 text-fd-muted-foreground text-sm leading-6">
                    {topic.text}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </section>
        <footer className="mt-14 flex flex-wrap gap-x-6 gap-y-3 border-fd-border border-t pt-6 text-fd-muted-foreground text-sm">
          <Link params={{ _splat: "reference/feature-guide" }} to="/docs/$">
            All features
          </Link>
          <a href="/llms.txt">Docs for agents</a>
          <a href={`${import.meta.env.VITE_WEBSITE_URL}/privacy`}>Privacy</a>
          <a href={import.meta.env.VITE_WEBSITE_URL}>OpenMeld website</a>
        </footer>
      </div>
    </HomeLayout>
  );
}
