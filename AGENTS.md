# AGENTS.md — working in the TTR repo

Guidance for AI agents (and new contributors) working on **TTR — Transport Tax
Recovery**. Read this before editing anything.

## What this project is

A pre-product startup: a platform to help **individual truck drivers and
small/medium EU road-freight carriers reclaim fuel VAT, professional-diesel
excise, and cross-border per-diem income-tax relief** — by forwarding a photo of
a receipt, not hiring an accountant. Billing is **no-win-no-fee** (~15% success
fee on money recovered).

## Current state (2026-07)

- The repo holds a **market-research dossier** only — 9 print-first HTML pages in
  [`research/`](research/) plus a shared stylesheet. This is the **source of
  truth** for what TTR is, the market, the product plan, and the numbers.
- **No application code exists.** `src/` and `tests/` are empty (`.gitkeep`); the
  stack is not chosen.
- `docs/ARCHITECTURE.md` is an early, **US-flavored (IFTA-style) draft** that
  predates the dossier. The **EU-focused dossier supersedes it** — treat
  `docs/DOSSIER.md` + the dossier as current direction.
- If asked to build product code, **confirm scope first** — nothing is committed
  to a stack. The dossier's §6 sketches a provider-agnostic direction (multimodal
  AI extraction + per-country rules engine + human-in-the-loop).

## Deep context

- **`docs/DOSSIER.md`** — the dossier's substance: the three tax streams, key
  numbers (TAM/SAM/SOM, per-truck, Spain slice), the gated Spain pilot,
  competition, and product direction. Read it before editing `research/*.html`.

## Editorial voice & terminology — FOLLOW THESE

Explicit product-owner preferences set while building the dossier. Ignoring them
creates rework.

- **Don't lead with "AI-native."** AI should solve the problem *implicitly* — never
  stamp "AI-native platform" as the headline selling point. Describe the outcome
  ("forward a photo → a filed claim"). Mechanism-level mentions are fine.
- **Provider-agnostic.** Write "multimodal AI / OCR + vision LLMs / an LLM API",
  not a single vendor. A parenthetical example ("e.g. Claude") is acceptable.
- **"first market", never "beachhead."**
- The POC is a **"concierge" POC, never "Wizard-of-Oz."**
- **Don't name "Airtable"** — say "a simple admin console / CRM".
- **Plain language over jargon** (e.g. "helps us / hurts us", not "tailwind /
  headwind"; spell out acronyms on first use). Prefer **bullets, tables, and
  diagrams over dense paragraphs** — the owner repeatedly asked to "condense and
  make it graphic."
- Flag estimates honestly. The two **load-bearing numbers** are € recovered per
  international truck (~€6,000) and the success-fee % (~15%) — validate before
  relying on them.

## Editing the dossier (`research/*.html`)

- **Print-first / A4.** Each page is a `.sheet` that must print to a clean PDF.
  View by opening `research/index.html`; export via Print → Save as PDF.
- **Shared design system** in `research/assets/styles.css`. Reuse components; don't
  invent new patterns without cause. Key components:
  - `.stats` (big-number cards; `.eq` variant for word-stats)
  - `.callout` (+ `.good` green / `.key` navy / `.warn` amber / `.gold`)
  - `.pill` (+ `.p0`–`.p3` priorities, `.good/.amber/.navy/.gray/.gold`)
  - `.cascade` (numbered vertical step-flow with a rail)
  - `.phase` cards and expandable `<details class="phase" open><summary class="ph-head">`
  - `.riskboard` / `.risktier` / `.risk.sev-hi|md|lo` (severity board)
  - `.ptl` (the **unified vertical pilot timeline** used on page 8 — one rail, `.ptl-badge` stations, `.ptl-gate` KPI boxes)
  - `.gantt`, `.cols` / `.cols-3`, `.t-tight` tables
  - inline SVG charts inside `<figure><div class="diagram-wrap">…</figure>` with a `<figcaption>`
- **Inline SVG convention:** do **not** set `font-family` on SVG `<text>` (let it
  inherit the page font, Inter). Use CSS palette tokens for fills: `--accent
  #0d7c6c`, `--accent-d #0a5f53`, `--navy #17324f`, `--ink #181f2a`, `--muted
  #77839a`, `--gold #a9822f`; gridlines `#e7e9f0`, axes/box-strokes `#d3d8e4`.
- **Links:** external sources and appendix/glossary links open in a new tab
  (`target="_blank" rel="noopener"`); in-page section navigation stays same-tab.
- Every content page ends with a `.sources` block — keep citations and confidence
  flags accurate. The glossary (`09-glossary.html`) is **bilingual EN/ES** with a
  small JS toggle; keep the `tr-en` / `tr-es` spans balanced (equal counts).
- After edits, sanity-check `<div>` balance and open the page in a browser to
  verify layout (especially SVG coordinates and table widths).

## Ops

- **View / share:** open `research/index.html`. `TTR-research-dossier.zip`
  (git-ignored) is the shippable static site with `index.html` at the zip root.
  Rebuild: `cd research && zip -rq ../TTR-research-dossier.zip . -x '.DS_Store' '*/.DS_Store'`.
- **Git push gotcha:** remote is `github.com/rmadrazo97/TTR`. The local git user
  `amadrazo-hhw` has **no write access**, and the macOS keychain defaults to it, so
  a plain `git push` returns 403. Push as the owner account:
  ```sh
  gh auth switch --user rmadrazo97
  git -c credential.helper='' -c credential.helper='!gh auth git-credential' push origin main
  ```
- Commit/push only when asked. Branch off `main` for anything non-trivial unless
  told otherwise.

## Pointers

- Product & filing integration → `research/06-product.html` (POC/MVP/Platform; the
  AEAT *apoderamiento* / colaborador social + web-service filing path).
- The execution plan → `research/08-spain-pilot.html` (single gated timeline).
- Glossary of terms (EN/ES) → `research/09-glossary.html`.
- Business facts & numbers → `docs/DOSSIER.md`.
