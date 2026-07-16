# Agent-Orchestration Approach for the TTR Receipt→Tax-Claim Pipeline

**Research brief · 2026-07-16 · Task 02**
Scope: choose an orchestration approach for the human-in-the-loop pipeline
`ingest → LLM-vision extract → reconcile 2nd extractor → validate → compute recoverable € → route low-confidence to asesor → assemble claim packet`.
Filing stays human (asesor files Spanish *modelo 360*) in the POC. Team: 2–4 devs. Pilot: 25–40 carriers, low volume. Email intake planned on **Cloudflare Email Workers**.

Confidence flags: **High** = verified against primary docs; **Med** = one good source / reasonable inference; **Low** = thin evidence, verify before relying.

---

## TL;DR recommendation

- **Don't adopt a heavyweight agent framework for the POC.** The pipeline is a **fixed, deterministic sequence with a branch-on-confidence** — a plain state machine plus a handful of LLM/API calls. Autonomous planning (the whole point of "deep agents") is not what this workload needs yet. **(High)**
- **Build the POC entirely in TypeScript on Cloudflare**, since email intake is already there. Use **Cloudflare Workflows** (`step.do` / `step.sleep` / `step.waitForEvent`) as the durable orchestrator and a **Durable Object** (or plain D1/Postgres) as the per-claim state store. This keeps you **one language, one platform, near-zero ops** for a tiny team. **(High)**
- **The "LangGraph is Python-first" premise is now only half-true.** LangGraph.js is a first-class citizen at feature parity, and **`deepagents` ships a TS build (`deepagentsjs`, v1.10.2, May 2026)** — so language is *not* the deciding factor. The real question is **"do we need an agent framework at all"** (no, not yet), and **"where does the compute run"** (Cloudflare). **(High)**
- **Human-in-the-loop is a solved problem on all three stacks**: LangGraph `interrupt()` + checkpointer, Cloudflare Workflows `step.waitForEvent`, Durable Object durable state. Pick the one that matches your runtime — on Cloudflare that's `waitForEvent`. **(High)**
- **Reserve LangGraph (Python or JS) for the MVP/Platform phase**, when you add self-serve flows, multi-country rules, and genuinely open-ended sub-tasks (e.g. an agent that *chases missing invoice data* across email threads). Migration path below. **(Med)**

---

## 1. The three options, defined (2025–2026 status)

### (a) LangGraph — Python & LangGraph.js
- **What it is:** a low-level library for building agents as an explicit **graph / state machine**: you define nodes (functions), edges (including **conditional edges** for branch-on-confidence), and a shared typed **state** object. Not an "agent" abstraction per se — it's the runtime under most LangChain agents. **(High)** [[LangGraph HITL docs]](https://docs.langchain.com/oss/python/deepagents/human-in-the-loop) [[DeepWiki: HITL & interrupts]](https://deepwiki.com/langchain-ai/langgraph/3.7-human-in-the-loop-and-interrupts)
- **Checkpointing & interrupts:** first-class. A **checkpointer** serializes the full state snapshot per `thread_id`; `interrupt()` (and static `interrupt_before`/`interrupt_after`) pause the graph, persist state, surface a payload to the caller, and **resume exactly where it stopped** on the next invoke. Checkpointers: `MemorySaver` (dev only), `SqliteSaver` (single process), Postgres/Redis/MongoDB (production). **(High)** [[interrupt reference]](https://reference.langchain.com/python/langgraph/types/interrupt)
- **LangGraph.js parity:** As of late-2025/2026 the TS version reached **1.0 GA (Oct 2025)** alongside Python, sharing `StateGraph`, conditional edges, checkpointers (Memory/SQLite/Postgres/Mongo/Redis), `interrupt()` HITL, streaming, subgraphs, and Platform deploy. LangChain staff call LG.js **"absolutely a first-class citizen"**; the honest gap is **documentation and community volume** (LG.js ≈ 42% of Python's npm/download share), not features. **(High)** [[Python vs JS parity]](https://www.crewship.dev/learn/langgraph-vs-langgraphjs) [[LangChain forum: first-class?]](https://forum.langchain.com/t/is-langgraph-js-a-first-class-citizen/478)
- **LangGraph Platform / Server (now "LangSmith Deployment", Oct 2025 rename):** managed hosting for long-running stateful agents. Free self-host of a basic LangGraph Server (up to 100k nodes/mo); Plus **$49/mo** (1 deployment), Pro **$99/mo** (5). Fully self-hosted / BYOC is **Enterprise-only**. Framework itself is **MIT-licensed** → self-host is free with no usage cap. **(High)** [[Platform GA]](https://www.langchain.com/blog/langgraph-platform-ga) [[pricing]](https://www.langchain.com/pricing) [[ZenML pricing guide]](https://www.zenml.io/blog/langgraph-pricing)

### (b) `deepagents` (the LangChain deep-agents harness)
- **What it is:** an **opinionated, batteries-included agent harness built on LangGraph**. Four ingredients: a **planning tool** (`write_todos` — the agent decomposes a task into a to-do list), a **virtual filesystem** (pluggable: in-memory / local disk / LangGraph store), **sub-agents** with isolated context windows, and **detailed system prompts**. Aimed at **long-horizon, open-ended** tasks where the agent must plan and self-direct across many steps. **(High)** [[Deep Agents overview]](https://docs.langchain.com/oss/python/deepagents/overview) [[deepagents repo]](https://github.com/langchain-ai/deepagents) [["Doubling down on Deep Agents"]](https://www.langchain.com/blog/doubling-down-on-deepagents)
- **Maturity:** actively developed. Python `deepagents` **v0.6.12** (Jun 2026); **TS `deepagentsjs` v1.10.2** (May 2026). `createDeepAgent()` returns a **compiled LangGraph graph** (so you inherit checkpointers, streaming, HITL). Marketed as "production-ready", but it is a **thin, fast-moving harness on top of LangGraph**, not an independently battle-hardened runtime — treat as **Med maturity**. **(High for facts; Med for "is it safe to bet on")** [[deepagents npm]](https://www.npmjs.com/package/deepagents) [[deepagentsjs repo]](https://github.com/langchain-ai/deepagentsjs)
- **Language:** **both Python and TS.** This partially **invalidates the "deep agents = Python-only" concern** in the brief. **(High)**
- **When it helps (per LangChain's own FAQ):** use deepagents "when you want the full harness — planning, context management, delegation — out of the box"; drop to plain LangGraph "when the agent loop itself isn't the right shape and you need a custom graph." **Our pipeline is the latter case.** **(High)**

### (c) Cloudflare Agents SDK (+ Workflows)
- **Agents SDK:** TS SDK to build **stateful agents**, where **each agent instance is a Durable Object with its own embedded SQLite DB**. State persists automatically across requests and hibernation via `this.setState()` / `this.sql` / `this.state`. Built-in WebSockets, scheduling (cron), **email handling**, and a starter template that **already includes human-in-the-loop approval**. **(High)** [[Agents docs]](https://developers.cloudflare.com/agents/) [[state & sync]](https://developers.cloudflare.com/agents/api-reference/store-and-sync-state/) [[agents repo]](https://github.com/cloudflare/agents)
- **Cloudflare Workflows (the more relevant primitive here):** a **durable multi-step execution engine** (GA, Free + Paid plans). Steps via **`step.do()`** (auto-retry), **`step.sleep()` / `step.sleepUntil()`** (pause for seconds→weeks), and crucially **`step.waitForEvent()`** — pause the workflow and wait for a webhook / user input / external event, then resume, with a timeout. This is a **native, purpose-built human-in-the-loop pause/resume mechanism**, e.g. `await step.waitForEvent('await approval', { event: 'approved', timeout: '24 hours' })`. Language: **TypeScript**. **(High)** [[Workflows docs]](https://developers.cloudflare.com/workflows/)
- **Email Workers:** incoming mail hits an **`email()` handler** in a Worker; access **raw MIME** via `message.raw` (parse attachments with e.g. postal-mime), **25 MiB inbound size limit**, can reply/forward/reject. Runtime is **JS/TS** (Python Workers exist but are beta). **(High)** [[Email Workers docs]](https://developers.cloudflare.com/email-routing/email-workers/)
- **Lock-in note:** Durable Objects / Workflows are **Cloudflare-proprietary APIs** — portable business logic, non-portable orchestration glue. **(High)**

---

## 2. Fit to THIS pipeline — does an "agent" framework earn its complexity?

**The pipeline is deterministic and bounded.** It is a fixed DAG with exactly one dynamic decision (confidence threshold → human review or auto-continue). There is **no open-ended reasoning loop, no need for the LLM to decide *what step comes next***. The LLM is used as a **tool** (vision extraction, maybe field normalization), not as a planner.

| Pipeline stage | Nature | Needs "agent" autonomy? |
|---|---|---|
| Ingest email attachment | I/O | No |
| LLM-vision extraction + confidence | **single LLM call** | No (it's a tool call) |
| Reconcile 2nd extractor (Veryfi/Mindee) | deterministic diff | No |
| Validate (VIES VAT-ID, required fields, gross = net + VAT, date window) | **deterministic rules** | No |
| Compute recoverable € (per-country rules) | **deterministic rules engine** | No |
| Route low-confidence/blocked → asesor | **conditional branch** | No |
| Assemble claim packet | templating | No |

**Verdict:** A full agent framework — **especially deepagents' autonomous planning + sub-agents + virtual filesystem — does not earn its complexity here.** You would be paying (in tokens, latency, non-determinism, and debugging surface) for a planner you don't want to run over a workflow whose steps are already known. For a regulated, money-moving, auditable pipeline you *want* determinism, not an LLM improvising the order of validation. **(High)**

**A simple state machine + a few LLM/API calls is the correct POC choice.** LangGraph-style graphs, Cloudflare Workflows, or even a plain typed switch/reducer all express this cleanly. The only "framework" value you need is **durable pause/resume for the human step** and **retries** — both available without any agent abstraction.

**When would deep-agents-style autonomy actually pay off for TTR?** Genuinely open-ended, variable-length sub-tasks — not the happy path:
- **Chasing missing/ambiguous invoice data:** an agent that reads a fuel-card statement, notices a missing VAT breakdown, drafts a clarifying email to the carrier or supplier, parses the reply, and loops until the claim is complete. Variable steps, tool use, memory → a real planning task. **(Med)**
- **Multi-document, multi-step validation** across a batch (e.g. matching toll invoices to fuel-card statements to reconcile a whole month), where the number of comparisons isn't known up front. **(Med)**
- **Cross-country rule discovery / edge-case triage** where the path depends on what the documents turn out to be.

These are **MVP/Platform-phase** features, and even then a **bounded LangGraph subgraph** is likely enough — deepagents' full harness is justified only once these become the *dominant* workload. **(Med)**

---

## 3. Human-in-the-loop: pause-for-review-then-resume

The asesor must review flagged/low-confidence claims and **resume** the pipeline. All three stacks support this; they differ in ergonomics and where state lives.

| | Mechanism | How resume works | Fit for TTR |
|---|---|---|---|
| **LangGraph** | `interrupt()` + checkpointer (SQLite/Postgres) | Graph pauses, full state snapshot saved under `thread_id`; resume by re-invoking with the review decision via `Command(resume=…)` | Excellent, but requires running a LangGraph process (Python or JS) with a checkpoint DB **(High)** [[interrupt ref]](https://reference.langchain.com/python/langgraph/types/interrupt) |
| **Cloudflare Workflows** | **`step.waitForEvent(name, { event, timeout })`** | Workflow durably suspends (can wait hours/days), resumes when the asesor's approve/edit event is delivered (API call → workflow event) | Excellent + **native to your intended runtime**; no extra service **(High)** [[Workflows]](https://developers.cloudflare.com/workflows/) |
| **Cloudflare Agents SDK / Durable Object** | Durable state (`setState`/`sql`) + `onStateChanged` hooks; workflow step state methods (`updateAgentState`/`mergeAgentState`) | DO holds the claim state indefinitely; a review submission mutates state and triggers continuation. **Note:** a *dedicated* built-in pause/resume-on-human-input primitive is **less explicitly documented** than Workflows' `waitForEvent` — you may hand-roll the wait | Good; but if you want a clean pause primitive, prefer **Workflows** over raw DO **(Med)** [[state docs]](https://developers.cloudflare.com/agents/api-reference/store-and-sync-state/) |
| **deepagents** | Inherits LangGraph's `interrupt()`/checkpointer (built on LangGraph) + a built-in HITL/approval interrupt for tool calls | Same as LangGraph | Works, but you'd adopt the whole harness for a feature LangGraph already gives you **(High)** [[deepagents HITL]](https://docs.langchain.com/oss/python/deepagents/human-in-the-loop) |

**Takeaway:** HITL is **not a differentiator** — every option does it. On Cloudflare, `step.waitForEvent` is the cleanest match because the pause can last **hours/days** (an asesor reviews on their own schedule) with a **timeout** for SLA, and it needs **no extra infrastructure**. **(High)**

---

## 4. Runtime / deployment reality (email intake is on Cloudflare)

Three concrete shapes:

### (i) All-TS on Cloudflare — **recommended for POC**
Email Worker (`email()` handler) → enqueue/trigger a **Cloudflare Workflow** → steps call the vision LLM API (Anthropic/OpenAI), Veryfi/Mindee, VIES, the rules engine → `waitForEvent` for asesor review → assemble packet. State in a Durable Object or **D1/Postgres**. Optionally wrap the async/stateful bits in the **Agents SDK**, or run **LangGraph.js** inside a Worker if you want the graph abstraction.
- **Pros:** one language, one platform, one deploy, **near-zero ops**, no cold-start hop between services, unified logs. Ideal for 2–4 devs / low volume. **(High)**
- **Cons:** Cloudflare-proprietary orchestration (lock-in on glue, not logic); Workers CPU/time limits push heavy work into Workflow steps (fine) or a container; the richest agent ecosystem (LangChain) is more mature in Python. **(High)**

### (ii) Cloudflare email + separate Python service (LangGraph)
Email Worker parses + drops the doc into a **Queue / R2 / HTTP call** to a Python LangGraph service (Fly.io / Render / Cloud Run / LangGraph Platform).
- **Pros:** best-in-class LangGraph + Python ML/tooling ecosystem; richer docs.
- **Cons:** **two languages, two deploys, a network boundary, two observability stacks, cold starts** on the Python side — real ops tax for a tiny team, and **overkill for a deterministic pipeline**. **(High)**

### (iii) Hybrid
Cloudflare for edge/email/queue + a thin Python worker **only** for the one thing that truly wants Python (e.g. a specific ML lib). Defer until such a need is proven.

**For a 2–4 person team running a 25–40 carrier pilot, (i) wins decisively:** the pipeline's determinism removes the main reason to reach for Python/LangChain, and staying single-language/single-platform is the biggest ops lever you have. **(High)**

---

## 5. Persistence, observability, cost, lock-in

| Concern | Cloudflare (Workflows/DO) | LangGraph (self-host) | LangGraph Platform / LangSmith |
|---|---|---|---|
| **Checkpoint / state store** | Durable Object SQLite / D1 / Workflow durable state (persists weeks) | Bring your own: SQLite (dev), Postgres/Redis (prod) | Managed Postgres checkpointer |
| **Observability** | Workers logs, Tail, Analytics; wire your own tracing | Add **LangSmith** SDK (works with self-host) | LangSmith built in |
| **Tracing cost** | Included in platform; DIY traces | LangSmith overage **$2.50 / 1k traces** (14-day) | same |
| **Platform cost** | Workers Paid **$5/mo** min (1M DO req + 400K GB-s incl.; +$0.15/M req). SQLite-DO storage billing began Jan 2026 | Free (MIT) infra you rent | Plus **$49/mo**, Pro **$99/mo**; +$0.005/run, +$0.0036/min prod uptime |
| **LLM token cost** | Same regardless of orchestrator — dominated by the **vision-extraction call** per document; deepagents' planning/sub-agents would **add** tokens you don't need | same | same |
| **Vendor lock-in** | **High on orchestration glue** (DO/Workflows APIs), low on business logic | **Low** (MIT, portable) | Med (managed features) |

Sources: [[CF Workers pricing]](https://developers.cloudflare.com/workers/platform/pricing/), [[CF DO pricing]](https://developers.cloudflare.com/durable-objects/platform/pricing/), [[LangGraph/LangSmith pricing]](https://www.langchain.com/pricing), [[ZenML pricing guide]](https://www.zenml.io/blog/langgraph-pricing).

**Cost reality:** at pilot volume (25–40 carriers, low doc throughput), **orchestration cost is negligible** on either platform (~$5/mo Cloudflare or free self-hosted LangGraph). The dominant cost is **LLM vision tokens + Veryfi/Mindee per-page fees**, which are **independent of orchestrator choice** — another reason not to pay the complexity tax of an agent framework. **(High)**

---

## 6. Recommendation — concrete POC architecture

**Build a deterministic, TypeScript, Cloudflare-native pipeline. No agent framework in the POC.**

```
Cloudflare Email Worker  (email() handler; parse MIME, extract attachment → R2)
        │  enqueue / trigger
        ▼
Cloudflare Workflow  "processClaim"   (one instance per document/claim)
   step.do  → LLM-vision extraction (Anthropic/OpenAI API) + confidence
   step.do  → 2nd extractor (Veryfi or Mindee); reconcile fields
   step.do  → validate: VIES VAT-ID lookup · required fields · gross = net + VAT · date-in-window
   step.do  → compute recoverable € (per-country rules module)
   branch   → if confidence < τ OR validation blocked:
                 step.waitForEvent('asesor-review', { event:'reviewed', timeout:'72h' })
   step.do  → assemble claim-ready packet (PDF/JSON) → R2 / admin console
        │
        ▼
Admin console / simple CRM  (asesor reviews flagged items, submits decision → fires the workflow event)
State: Durable Object or D1/Postgres per claim; docs in R2.  Filing: human asesor (modelo 360).
```

**Rationale**
- **Matches the workload:** fixed steps + one confidence branch = a workflow, not an agent. Determinism = auditability = what a tax pipeline needs. **(High)**
- **One language, one platform, ~$5/mo, near-zero ops** — right-sized for 2–4 devs and 25–40 carriers. **(High)**
- **`step.waitForEvent` is a purpose-built HITL pause/resume** that survives multi-day asesor turnaround with a timeout. **(High)**
- **Keeps the extraction/rules logic provider-agnostic and portable**; only the orchestration glue is Cloudflare-specific. **(High)**
- **If you prefer an explicit graph abstraction** but want to stay on Cloudflare, run **LangGraph.js inside a Worker** with a SQLite/Postgres checkpointer — a reasonable variant, at the cost of more moving parts than raw Workflows. Do **not** reach for deepagents. **(Med)**

### Migration path — when LangGraph / deep-agents earns its place
1. **POC (now):** Cloudflare Workflows state machine, no agent framework.
2. **MVP:** self-serve PWA + *modelo 360* flow, dual-extractor reconcile, dashboard. If orchestration grows branchy, introduce **LangGraph.js** (still on Cloudflare) or a **Python LangGraph service** behind a queue — a clean, low-risk lift because your steps are already isolated functions.
3. **Platform:** when you build genuinely **open-ended sub-tasks** — an agent that *chases missing invoice data* over email, or reconciles unbounded document batches — introduce a **bounded LangGraph subgraph**, and only adopt **`deepagents`** if planning + sub-agents + a virtual filesystem become the *dominant* pattern (not a one-off). Consider **LangGraph Platform / LangSmith Deployment** ($49–99/mo) for managed checkpointing + tracing at that scale.

---

## Open questions for the PRD

1. **CPU/time budget per document:** does vision extraction + 2 extractor calls + VIES fit within a Workflow **step's** limits, or does a step need to offload to a Cloudflare Container / external function? (Verify current Workers/Workflows step limits.) **(Med)**
2. **VIES reliability & rate limits:** the EU VIES service has known downtime/latency; the workflow needs retry/backoff (`step.do` retries) and a graceful "VAT-ID unverifiable → route to asesor" path. What SLA do we assume? **(Med)**
3. **Extractor choice & cost:** Veryfi vs Mindee (accuracy on EU fuel/toll invoices, per-page pricing, EU data residency/GDPR). This drives the reconcile logic and unit economics far more than the orchestrator does. **(High)**
4. **Confidence threshold τ and reconcile policy:** how do we combine two extractors' confidences into one route-to-human decision? What's the target auto-approve rate for the pilot (dossier gate G3 = ≥90% extraction accuracy)?
5. **State store & audit trail:** Durable Object SQLite vs D1 vs external Postgres — which gives the audit/immutability we want for a money-moving, regulated claim, and simplest GDPR data-handling in the EU?
6. **Admin console:** build vs. buy the asesor review UI, and how it fires the `waitForEvent` resume event (auth, per-claim linking). (Dossier says "simple admin console / CRM.")
7. **Data residency / GDPR:** where do LLM vision calls and document blobs physically process/store? Cloudflare region pinning + LLM-provider EU processing terms must be pinned down before onboarding real carrier data.
8. **Is any step genuinely open-ended today?** If "chase missing invoice data" is in POC scope, that single sub-task might justify a small LangGraph agent *now* — decide explicitly rather than by default.

---

## Sources

**LangGraph & HITL**
- Human-in-the-loop — https://docs.langchain.com/oss/python/deepagents/human-in-the-loop
- `interrupt` reference — https://reference.langchain.com/python/langgraph/types/interrupt
- HITL & interrupts (DeepWiki) — https://deepwiki.com/langchain-ai/langgraph/3.7-human-in-the-loop-and-interrupts
- LangGraph vs LangGraph.js (parity) — https://www.crewship.dev/learn/langgraph-vs-langgraphjs
- Is LangGraph.js a first-class citizen? (forum) — https://forum.langchain.com/t/is-langgraph-js-a-first-class-citizen/478
- LangGraph Platform GA — https://www.langchain.com/blog/langgraph-platform-ga
- LangSmith / LangGraph pricing — https://www.langchain.com/pricing
- LangGraph pricing guide (ZenML) — https://www.zenml.io/blog/langgraph-pricing

**deepagents**
- Deep Agents overview — https://docs.langchain.com/oss/python/deepagents/overview
- deepagents repo (Python) — https://github.com/langchain-ai/deepagents
- deepagentsjs repo (TS) — https://github.com/langchain-ai/deepagentsjs
- deepagents npm — https://www.npmjs.com/package/deepagents
- "Doubling down on Deep Agents" — https://www.langchain.com/blog/doubling-down-on-deepagents

**Cloudflare**
- Agents SDK docs — https://developers.cloudflare.com/agents/
- Store & sync state — https://developers.cloudflare.com/agents/api-reference/store-and-sync-state/
- Cloudflare Workflows — https://developers.cloudflare.com/workflows/
- Email Workers — https://developers.cloudflare.com/email-routing/email-workers/
- Workers pricing — https://developers.cloudflare.com/workers/platform/pricing/
- Durable Objects pricing — https://developers.cloudflare.com/durable-objects/platform/pricing/
- cloudflare/agents repo — https://github.com/cloudflare/agents
