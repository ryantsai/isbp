# AGENTS.md

Instructions for AI coding agents working in this repository (Claude Code reads `CLAUDE.md`; other agents start
here).

1. Read [`CLAUDE.md`](CLAUDE.md): commands, conventions and gotchas. It applies to every agent.
2. Building or changing a module (plugin)? Follow the guide in [`docs/ai/`](docs/ai/README.md):
   [rules](docs/ai/rules.md), [system map](docs/ai/system-map.md), [module anatomy](docs/ai/module-anatomy.md),
   [API reference](docs/ai/api-reference.md), [recipes](docs/ai/recipes.md), the generated
   [extension point reference](docs/ai/reference.md), [testing](docs/ai/testing.md),
   [UI guidelines](docs/ai/ui-guidelines.md) and the [definition of done](docs/ai/checklist.md).
3. The design and its history are in [`docs/architecture.md`](docs/architecture.md). Deployment is in
   [`docs/deployment.md`](docs/deployment.md), and the REST API in [`docs/api.md`](docs/api.md).

Before reporting work as done, run:

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm modules:check && pnpm docs:check && pnpm test
```

Commit or push only when a person asks you to. Delivery is phased: finish the current phase, then stop for review.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
