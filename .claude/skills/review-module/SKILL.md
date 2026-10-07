---
name: review-module
description: Review an IS Big Platform module or a change to one against docs/ai/rules.md and docs/ai/checklist.md — security, data integrity, i18n, accessibility, tests — and report findings with rule numbers. Use when asked to review, audit or check a module, plugin or module change.
---

# Review a module

1. Read `docs/ai/rules.md` and `docs/ai/checklist.md`. Identify the scope: a whole module (`modules/<id>`) or a
   diff (`git diff` against the base branch).
2. Check declarations against the code:
   - names used in code but not declared in the manifest, or declared but unused;
   - unprefixed names;
   - consumed events without handlers.
3. Security pass (R16–R23):
   - every route's permission and scope check;
   - resolvers, search providers and AI tools leaking data;
   - secrets returned, logged or audited in clear;
   - values reaching SQL text, shells, URL hosts or HTML;
   - outbound calls not going through `ctx.http`.
4. Integrity pass (R9–R15):
   - every mutation in a transaction with audit + event;
   - side effects after commit;
   - idempotent handlers;
   - `forget` on delete;
   - generated migrations;
   - indexed filters;
   - PATCH schemas without defaults.
5. UX pass (R27–R33):
   - the three catalogs have the same keys and ICU arguments;
   - no literal strings;
   - status shown as icon + text;
   - labels, focus and keyboard;
   - layout at 375 px;
   - list state in the URL.
6. Tests (R34, R35): unit, integration (refusals and rules, not only happy paths, polling for async effects),
   e2e with axe and 375 px.
7. Run the quality gate:
   `pnpm format:check && pnpm lint && pnpm typecheck && pnpm modules:check && pnpm docs:check && pnpm test`.
   Run the module's integration tests too.
8. Report the findings, most severe first. For each one give the file and line, the rule number, a concrete
   failure scenario and the fix. Say what you checked and found clean. Do not change code unless asked.
