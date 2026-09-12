# Submission checklist

## Current project definition — working draft

> Validate every claim below with the live workflow before submitting. This is
> a project decision, not evidence that an integration has already run.

**Working title:** SilentOps — continuity for critical cold-chain operations.

**Core interaction:** At the end of a guard shift, a deterministic detector
checks the roster and document system for the expected technical handover. On
an auditable miss, SilentOps reads the operations thread and open work orders,
then proposes a sourced handover document, reassignment of open work and a
Slack update. A supervisor reviews and approves before any write occurs.

**User:** A supervisor in a cold-chain logistics hub, coordinating refrigerated
storage, maintenance work orders and a rotating operations team.

**Safety boundary:** The demo uses synthetic operational data. The agent does
not control equipment, assess temperature safety, determine product fitness or
make clinical decisions. It prepares records and communications for a human
operator to approve.

**Scope freeze:** Tier 0 is the missing-handover workflow only. Automatic
follow-ups, decision capture, WhatsApp and the control-tower web UI are
post-Tier-0 work and must not appear as completed functionality unless they run
in the submitted build. A manual `@mention` may be used for development smoke
tests, but must not be presented as the Tier 0 detection trigger in the video.

Choose your city on the [global event page](https://aitinkerers.org/hackathons/global/agents-everywhere). Use that city's participant portal for the submission deadline and published judging criteria, and its handbook for eligibility and required deliverables. See [hackathon-rules.md](hackathon-rules.md) for the agent-readable summary.

## Build eligibility

- [x] Our submitted project is a net-new build created during the official hackathon period
- [x] Its core functionality was built during the event; we are not resubmitting or extending a pre-existing project and entering it as new
- [x] We identify inherited templates, libraries, prompts, components, and starter code separately from our event work

**What we inherited**

The [CopilotKit `agents-everywhere-starter-kit`](https://github.com/CopilotKit/agents-everywhere-starter-kit),
forked at commit `86f547d` and kept as the `upstream` remote so the boundary is
auditable with `git diff 86f547d..HEAD`. From it we use, unmodified:

- The monorepo scaffold and toolchain: npm workspaces, TypeScript, `node:test`.
- `apps/channel` — the CopilotKit Channels host and its Slack transport.
- `apps/web` — the Next.js + AG-UI shell.
- `packages/agent-core` — provider resolution (`resolveModel`) and the kit's
  own agent/prompt examples.
- The kit's incident-workflow demo, which we did **not** build on and do not
  present as ours. It remains in the tree untouched.

Third-party libraries: `@copilotkit/runtime`, `@modelcontextprotocol/sdk`,
`jose`, the AI SDK.

We modified seven inherited files, all for wiring only — no inherited logic was
repurposed: `.gitignore`, `AGENTS.md`, this file, three `package.json` files
(registering the `loop-core` workspace and its scripts), and `package-lock.json`.

**What we built during the hackathon**

Everything in `packages/loop-core/` — a new workspace, created during the event —
plus `SILENTOPS.md`, `ESTADO.md` and `team-docs/`. **43 new files, ~5,150 lines,
3 deletions**, across four commits starting at `ce8330d`.

The core interaction is net-new and has no counterpart in the starter kit:

| What | Where |
|---|---|
| Absence detector: wakes at the shift boundary, queries for the handover that should exist, records the evidence that it does not | `packages/loop-core/src/jobs/missing-handover.ts` |
| The frozen contracts — `InboundEvent` with its `context`, `Proposal`, `OutboundChannel` | `packages/loop-core/src/contracts.ts` |
| Propose-only agent loop: the model's single action tool is `propose_action`, so no path exists from the model to a write | `packages/loop-core/src/agent/`, `src/agent/propose-tool.ts` |
| Single write boundary: Auth0 scope per action + idempotency, executed only after human approval | `packages/loop-core/src/boundary/write.ts`, `auth0.ts`, `idempotency.ts` |
| Read-only Ambiguous adapter: the only module that knows the provider's MCP tool names, so the model can never name a write tool | `packages/loop-core/src/boundary/ambiguous-reader.ts`, `src/domain/workspace-reader.ts` |
| Domain prompts and the four read tools for cold-chain shift handover | `packages/loop-core/src/domain/prompts.ts`, `tools.ts` |
| Cross-provider fallback with a demo kill switch | `packages/loop-core/src/model/with-fallback.ts` |
| Eval harness with a scripted model (runs the whole loop offline) and a 15-case golden set including three adversarial cases | `packages/loop-core/evals/` |

Verifiable from a clean clone: `npm run verify` runs 47 tests in `loop-core`,
including the 15 golden cases. `npm run silentops:detect -w loop-core` runs the
detector against the live Ambiguous workspace, read-only.

## Title and description

**Title:** SilentOps — continuity for critical cold-chain operations

**What you built**

An operational-continuity agent that lives in a refrigerated logistics hub's
operations Slack channel and catches the handover nobody wrote. Fifteen minutes
before the night shift ends, a deterministic detector reads the on-call roster,
searches the workspace for the handover document that should exist, and records
the result. When that search comes back empty, the agent reads the channel since
shift start and the open work orders, and drafts a proposal: a sourced handover
document (at most five bullets, each citing the channel message or work order it
came from), the open work to reassign to the incoming technician, and the exact
Slack message to post. The outgoing supervisor sees the absence evidence first,
then the proposal, and taps Approve. Only then does the single write boundary
create the document, reassign the approved work orders, and post the link.
Nothing is written before that tap.

**Who it is for**

Ana, the supervisor closing the night shift at a cold-chain logistics hub. She
coordinates technicians, cold rooms, maintenance work orders and
customer-impacting incidents, and at 06:00 she hands the floor to Bruno. The
handover is the one task most easily lost precisely when the shift was busy —
and its absence is invisible until something falls through it.

**Why the context matters**

The trigger is not a human message — it is an absence. Nobody asked SilentOps
anything; a scheduled job woke at the shift boundary, queried for a record that
did not exist, and preserved the proof (`searched Documents for "Handover Noche
2026-09-12" at 05:45 → 0 results`). A standalone chatbox cannot wake at the
expected shift boundary, query for the record that should exist, and preserve
that chain of evidence — it can only answer when spoken to. Living in the
operations channel is also what makes the control natural: the person approving
is the person going off shift, and the approval is the exit signature they were
already making. The agent has no write access; everything the demo shows was
approved by the technician leaving the floor.

**Sponsor technologies used**

- **CopilotKit Channels** — the Slack surface. The approval card renders the
  absence evidence and the proposal as native Block Kit, and its Approve button
  is the only path to a write.
- **Ambiguous AI** — the system of record, over MCP. Shifts, documents and work
  orders are read to build the proposal and written back on approval; the
  read-only adapter is the only module that knows the provider's tool names, so
  the model can never name a write tool.
- **Auth0** — the scope gate in front of every write. `boundary/write.ts` calls
  `verifyScope` for the action's scope (`write:workspace`, `send:channel`,
  `schedule:job`) before dispatching, and pairs it with an idempotency key.
  **No Auth0 tenant is wired in this build:** the submitted `.env` sets
  `ALLOW_UNVERIFIED_WRITES=1`, the explicit bypass. The gate fails closed
  without it — covered by the test *"sin Auth0 configurado y sin bypass
  explicito, no escribe nada"* — but we do not claim a live tenant we did not
  provision.
- **Google Gemini** — the model actually running this build
  (`MODEL_PROVIDER=google`, `MODEL=gemini-2.5-flash`). Every model call goes
  through `withFallback`, which re-resolves against a second provider on a
  retryable error.
- **OpenAI / OpenRouter** — supported providers of that same fallback, and the
  pairing its 10 hermetic tests exercise. **Neither key is present in the
  submitted build**, so with one provider configured there is no second hop to
  demonstrate: `FORCE_PROVIDER_FAILURE=1` fails the primary and then reports the
  missing key rather than completing the run. The cross-provider path is
  implemented and tested, not demonstrated live here.

Sponsor count is not a judging criterion; each tool above carries a distinct,
visible part of the one workflow. Where a sponsor's integration is implemented
but not provisioned, we say so rather than implying it ran.

**Scheduling — labelled accurately.** The detector is a deterministic scheduled
job, and that schedule is the product's trigger. It runs today through
`packages/loop-core/src/jobs/followup.ts`, an **in-process** scheduler that
reports `durable: false`, plus the reproducible manual run
`npm run silentops:detect -w loop-core`. **Trigger.dev is not installed in this
build.** The `JobScheduler` interface exists so it can be swapped in without
touching the boundary, but we do not claim a durable managed cron we did not
wire, and the video must not imply one.

## Evidence for the judging criteria

Judges score each of the four official criteria from 1–5. This checklist helps you gather evidence; it does not guarantee a score. A working starter is a foundation for your own project.

| Official criterion | Show in your project and demo |
|---|---|
| Core Requirements & Functionality | Run one complete workflow in the intended environment, from user request through tools to a verified result. Repeat it with live integrations; offline tests alone do not prove the deployed flow. |
| Innovation & Theme Alignment | Show the surrounding context before the prompt and explain the original interaction it enables. Compare with the context removed: what value would a standalone chatbox lose? |
| Technical Execution & Integration | Show how tools, data, and the environment connect. Demonstrate a relevant failure or cancellation path and explain recovery, state persistence, and integration limits. |
| Usefulness & Agentic Experience | Identify the user and problem, show a meaningful action in the surface, and demonstrate clear feedback and appropriate user control. Explain what work the agent saves. |

- [ ] We can point to visible evidence for every criterion
- [ ] We distinguish live services, sample data, session-only state, and standalone recipes
- [ ] Sponsor technologies contribute to the workflow; their count is not a judging criterion

## Public repository

- [ ] A new participant can run the quickstart from a clean clone
- [ ] The README lists the credentials and separate processes required
- [ ] `npm run verify` passes; optional recipe checks pass if used
- [ ] `.env`, tokens, generated traces with sensitive data, and account secrets are excluded
- [ ] Sample data, session-only state, and unimplemented integrations are clearly labeled

## Two-minute demo video

- [ ] Show the surface and existing context before the prompt
- [ ] Demonstrate one complete interaction
- [ ] Show a visible result: an actual record, local state change, or research source links
- [ ] If showing an approval, distinguish the decision from execution and demonstrate the resulting behavior
- [ ] State which sponsor technologies made the interaction possible
- [ ] Keep the video within the event's limit and check audio

See [demo prompts](dev-docs/demo-prompts.md) for a reproducible incident workflow.

## Social post and final submission

- [ ] Follow the organizer's posting and sponsor-tagging instructions
- [ ] Link the public repository and video
- [ ] Credit the sponsors you used and applicable local partners
- [ ] Check the live integration once more before recording or submitting
- [ ] Inspect the repository, video and screenshots for secrets

Prepare the post and submission for a human to publish; running the starter kit
does not publish either automatically.
