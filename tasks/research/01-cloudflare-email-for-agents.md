# TTR Email Ingestion Surface — Cloudflare "Email for Agents" Technical Brief

**Author:** Research analyst · **Date:** 2026-07-16 · **Status:** Decision brief for PRD
**Scope:** Evaluate Cloudflare's *Email for Agents* / *Email Service* as the inbound email surface for TTR (Transport Tax Recovery), where EU truck drivers forward photos/PDFs of foreign fuel/toll/AdBlue receipts, versus the dossier's default (Postmark/Mailgun inbound webhooks).

> **Confidence key:** **High** = confirmed on a primary Cloudflare docs/blog page. **Med** = stated by Cloudflare secondary/community source or inferred from primary docs. **Low** = single secondary source, unverified, or my inference — treat as an open question.

---

## TL;DR — Recommendation

- **Cloudflare Email Routing + Email Workers is a viable, cheap inbound surface for the TTR POC** (inbound is free and unmetered; you write a small Worker that parses the message with `postal-mime` and writes attachments to R2). **High**
- **BUT the "Email for Agents" framing is mostly a repackaging** of existing primitives (Email Routing, Workers, Durable Objects, R2, Agents SDK) plus a newly **public-beta outbound "Email Sending"** and convenience helpers for agent reply-routing. The genuinely new bits (HMAC-signed reply routing, `routeAgentEmail`) are **nice-to-have, not load-bearing** for TTR's ingest-and-store use case. **High**
- **Data residency is the deciding risk.** R2 gives a real **EU jurisdictional guarantee** and Workers can be pinned to EU processing — but **inbound Email Routing itself has no documented EU-only processing region** (regional email processing is an *Email Security* feature, a different product). This is the single biggest GDPR gap and must be resolved before committing. **High** on the gap; **Med** on whether it's disqualifying.
- **Inbound authentication is weaker than Postmark/Mailgun.** A known open bug means mail delivered to a Worker arrives **without SPF/DKIM/DMARC verdicts** (`Authentication-Results` missing), so a Worker cannot easily verify the sender is who they claim. For TTR, where you map `From:` → driver, this is a real anti-spoofing weakness. **High**
- **Pragmatic recommendation:** For a 25–40 carrier pilot, **use Cloudflare for inbound + R2 storage** if the DPA/residency answer (Section 6) is acceptable; **keep Postmark/Mailgun as the fallback** — it is simpler to operate, has better inbound spam/auth handling and richer inbound-parse webhooks, and its EU-region story is well-trodden. **Do not adopt the Agents SDK email helpers for the POC** — use plain Email Workers, which are lower-magic and easier to reason about for a 2–4 person team.

---

## 1. What the blog post actually proposes

Source: *"Cloudflare Email Service: now in public beta. Ready for your agents"* — https://blog.cloudflare.com/email-for-agents/ **(High)**

The post reframes email as a **bidirectional channel for AI agents**: an agent gets an address, receives mail, does async work (minutes to hours), and replies on its own timeline, with state persisted between messages.

| Primitive | Role in the post | New in 2026? |
|---|---|---|
| **Email Routing** | Receives inbound mail, routes by address pattern to a Worker | No — free, years old **(High)** |
| **Email Sending** | Outbound transactional/agent replies via a Worker **binding** or REST API | **Graduated private → public beta** with this post **(High)** |
| **Agents SDK** | `onEmail()` inbound hook, `sendEmail()` / `replyToEmail()`, `routeAgentEmail()`, email *resolvers* | Helpers new-ish; SDK itself pre-existing **(Med)** |
| **Durable Objects** | Backs each agent instance; persists conversation/contact/context state | No — repurposed **(High)** |
| **Workers** | Runs parse/classify/orchestration logic | No **(High)** |
| **Workers AI** | Email classification in the "Agentic Inbox" reference app | No **(High)** |
| **R2** | Stores attachments in the reference app | No **(High)** |

**What is genuinely new vs. marketing:**
- **New/real:** Outbound **Email Sending is now public beta** (previously private beta). **Secure reply routing** — the agent signs routing headers with **HMAC-SHA256** so a reply comes back to the exact Durable Object instance that sent it. **(High)**
- **Marketing/repackaging:** "Email for Agents" is largely a **narrative + SDK convenience layer** over Email Routing + Workers + DOs + R2, which already existed. For TTR (receive → extract attachments → store → hand to extraction agent), **none of the agent-reply machinery is required**; it is a plain inbound pipeline. **(High)**

**Relevance to TTR:** The post's headline value (agent that reasons then replies over email) is *orthogonal* to TTR's need. TTR needs the boring 20%: reliably receive, parse attachments, map to driver, store in EU. All of that is Email Routing + Email Worker + R2 — usable without the Agents SDK.

---

## 2. Receiving email — Email Routing + Email Workers

Sources: Workers API — https://developers.cloudflare.com/email-service/api/route-emails/email-handler/ ; postal-mime CF guide — https://postal-mime.postalsys.com/docs/guides/cloudflare-workers/ **(High)**

**How an inbound email reaches a Worker:** You verify a domain in Email Routing, add its MX records, and create a routing rule (a specific address or **catch-all**) whose action is **"Send to a Worker."** Cloudflare's MX receives the SMTP message and invokes your Worker's `email()` handler.

**Handler signature** (plain Email Worker, no Agents SDK):
```ts
export default {
  async email(message, env, ctx): Promise<void> { /* ... */ }
}
```

**`message` (`ForwardableEmailMessage`) exposes** **(High)**:

| Property / method | Meaning |
|---|---|
| `message.from` | Envelope MAIL FROM (sender) |
| `message.to` | Envelope RCPT TO (the address that received it — key for per-driver routing) |
| `message.headers` | `Headers` object; `.get("subject")`, `.get("message-id")`, etc. |
| `message.raw` | `ReadableStream` of the full raw MIME source |
| `message.rawSize` | Size of raw email in bytes |
| `message.setReject(reason)` | Bounce with a permanent SMTP error |
| `message.forward(rcptTo, headers?)` | Forward (only `X-` headers may be added) |
| `message.reply(EmailMessage)` | Reply to sender (constraints in §5) |

**Reading body + attachments:** parse the raw stream with **`postal-mime`** — it returns subject, `text`/`html`, and an `attachments[]` array (each with `filename`, `mimeType`, and `content` as an `ArrayBuffer`; can be configured for base64). **(High)**
```ts
import PostalMime from "postal-mime";
const email = await PostalMime.parse(message.raw);
for (const att of email.attachments) { /* att.filename, att.mimeType, att.content */ }
```

**Size limits** (https://developers.cloudflare.com/email-service/platform/limits/) **(High)**:

| Limit | Value |
|---|---|
| **Inbound message size** | **25 MiB** (whole message, after MIME/base64 encoding) |
| Routing rules per domain | 200 |
| Verified destination addresses / account | 200 |
| Domains per zone (Routing or Sending) | 30 |

> **Practical caveat (High):** base64 encoding inflates attachments ~33%, so a ~18 MB raw photo can exceed 25 MiB on the wire and be rejected with `552 5.3.4 email data size exceeded`. Multi-page PDF scans from a phone can hit this. TTR should tell drivers to send one receipt per email and/or compress. There is **no separate per-attachment limit** — it's the whole-message 25 MiB. Sources: community threads on the limits page above.

**Custom addresses vs catch-all:** Both supported. A **catch-all** rule routing `*@ingest.ttr.example` → Worker is the simplest way to accept any per-driver subaddress without pre-registering each one (see §3). **(High)**

---

## 3. Per-driver addressing & mapping inbound → driver

**Two workable schemes** (both **High** that they work; the *choice* is a design decision):

1. **Sub-addressing (plus-addressing):** one catch-all address, encode the driver in the local part, e.g. `receipts+DRV0042@ingest.ttr.example`. The Worker reads `message.to`, extracts the tag after `+`, and looks up the driver. The blog explicitly shows sub-addressing (`Agent+user123@…`). **Pro:** zero per-driver provisioning. **Con:** some sending mail clients strip/rewrite `+` tags; drivers may fat-finger it.
2. **Per-driver full addresses:** `drv0042@ingest.ttr.example`. Cleaner for the driver (looks like a normal address, savable as a contact) but you either pre-create routing rules (capped at 200/domain — **too few for scale, fine for pilot**) or use a catch-all + a Worker-side map from local-part → driver. **(High)**

**Recommended for TTR:** **catch-all → Worker + a driver-address table in your DB (or a KV/D1 map).** Give each driver a memorable full address (`juan.perez@ingest.ttr.example`) that the driver saves as a phone contact. The Worker resolves `message.to` against the table; unknown addresses get a bounce or a "please register" reply. This avoids the 200-rule ceiling and the fragility of `+`-tags. **(Med — design recommendation)**

**Verification / anti-spoofing on inbound — the real weak spot (High):**
- Email Routing **requires inbound mail to pass SPF *or* valid DKIM**, else it's rejected; ARC is supported for forwarded mail. So blatant open-relay spoofing is blocked at the edge. Source: https://developers.cloudflare.com/email-service/concepts/email-authentication/
- **However**, a **known open issue (`cloudflare/workerd` #6740)** reports that mail delivered *to a Worker* arrives **with no `Authentication-Results` header** and an `ARC-Authentication-Results` of `arc=none` — i.e. **the Worker cannot read SPF/DKIM/DMARC verdicts** to make its own trust decision. Source: https://github.com/cloudflare/workerd/issues/6740 **(High)**
- **Consequence for TTR:** you cannot fully trust `message.from` to match a driver on your own. Mitigations: (a) treat driver mapping by **`message.to`** (the secret-ish per-driver address) as the primary key, not `From`; (b) additionally check `From` against the driver's registered email; (c) require a lightweight confirmation step for first email from an unknown `From`. **This is a genuine downgrade vs. Postmark/Mailgun**, which surface SPF/DKIM/DMARC/spam-score in their inbound webhook payloads. **(High)**

---

## 4. Attachment storage — writing to R2 from an Email Worker

Source: R2 data location — https://developers.cloudflare.com/r2/reference/data-location/ ; DLS/R2 — https://developers.cloudflare.com/data-localization/how-to/r2/ **(High)**

- Bind an R2 bucket to the Worker and `await env.BUCKET.put(key, att.content, { httpMetadata: { contentType: att.mimeType }})`. `att.content` is the `ArrayBuffer` from postal-mime. **(High)**
- **Size:** R2 single-object limits are far above the 25 MiB inbound email ceiling, so the *email* size limit binds first — no R2-side attachment problem for TTR. **(High)**
- **EU residency (critical, High):** Create the bucket with **jurisdictional restriction `eu`** — a **hard guarantee** (not a best-effort "location hint") that objects stay in EU data centres, marketed explicitly for GDPR. Set in Wrangler:
  ```toml
  [[r2_buckets]]
  binding = "RECEIPTS"
  bucket_name = "ttr-receipts-eu"
  jurisdiction = "eu"
  ```
  or via the S3 endpoint `https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com`. **Jurisdiction cannot be changed after creation** — get it right on day one. **(High)**
- **Encryption:** R2 encrypts objects at rest by default (AES-256). For tax PII, consider **application-layer encryption** of the object before `put()` if you want key control (Cloudflare holds the at-rest keys otherwise). **(Med — verify exact at-rest key custody in the DPA.)**

---

## 5. Sending replies / confirmations (2026 outbound path)

- **MailChannels free tier for Workers ended 31 Aug 2024** — the old "curl the MailChannels endpoint from a Worker for free" pattern is dead. Sources: https://support.mailchannels.com/hc/en-us/articles/26814255454093-End-of-Life-Notice-Cloudflare-Workers ; https://blog.mailchannels.com/important-update-mailchannels-email-sending-api-for-cloudflare-workers-to-be-terminated/ **(High)**
- **What replaced it — Cloudflare's own Email Sending (public beta, 2026).** Send from a Worker via a **`send_email` binding** or REST API. Pricing (https://developers.cloudflare.com/email-service/platform/pricing/) **(High)**:
  - Sending to **verified destination addresses in your own account: free** (even on free plan).
  - Sending to **arbitrary external recipients: requires Workers Paid ($5/mo)**; **3,000 emails/month included, then $0.35 per 1,000.** *(Note: a secondary source cited $0.09/1k; the primary pricing page says $0.35/1k — trust the primary. **High**)*
  - Outbound content limits: 50 recipients/email, subject ≤ 998 chars, 25 MiB to verified dests / 5 MiB otherwise, custom headers ≤ 16 KB. **(High)**
  - **New accounts start with a conservative daily quota that scales over time** (exact number not published — request increases via form). **This is a cold-start risk for launch day.** **(High that it's unspecified.)**
- **Can an Email Worker reply to the sender directly?** Yes — `message.reply(new EmailMessage(from, to, rawMime))`, but with **strict constraints (High):** message must have a **valid DMARC result**, **only one reply per event**, **recipient must equal the original sender**, domains must match, and `References` < 100 entries. Build the MIME with `mimetext`/`createMimeMessage` (needs `nodejs_compat`). For TTR's "got your receipt ✅" auto-ack, `message.reply()` is the simplest path and **does not require the paid Sending product** (it replies to the verified sender). **(Med — verify reply() is billing-exempt.)**
- **Agents SDK convenience:** `this.replyToEmail(email, { fromName, body })` and `this.sendEmail({...})` wrap this and auto-inject `X-Agent-*` routing headers (optionally HMAC-signed). Source: https://developers.cloudflare.com/agents/communication-channels/email/ **(High)** — but again, **not needed** for a simple ack.
- **Alternatives that remain valid outbound:** **Resend** (Cloudflare-documented), **Postmark**, **Mailgun**, or **MailChannels' own paid Email API** (free tier ~100/day). **(Med)**

---

## 6. GDPR / data residency — the load-bearing section

This is where TTR must be most careful (Spanish AEAT tax filings + PII).

| Component | EU-residency story | Confidence |
|---|---|---|
| **R2 (attachment storage)** | **Strong.** `jurisdiction = "eu"` is a *guaranteed* residency restriction (EU data centres, no transparent NA replication), explicitly for GDPR. Bucket lives under CF's Frankfurt entity for processor purposes. | **High** |
| **Workers (parse/store logic)** | Workers run on CF's global edge by default. Can be constrained with **Data Localization Suite** (Regional Services, EU) and CF has a **`smart_placement`/region** story, but standard Workers may execute at the nearest PoP — which for EU drivers is EU, but not *guaranteed* without DLS. | **Med** |
| **Email Routing (inbound receive/process)** | **Weak / unresolved.** Regional/EU *email processing* is documented **only for Email Security (Area 1)** — a *different, enterprise* product — per the 2025-09 changelog. **Email Routing itself has no documented EU-only processing region.** Where CF's inbound MX processes the message transiently is not clearly localizable today. | **High on the gap** |
| **Contractual** | CF offers a **GDPR-aligned DPA**, is verified under the **EU Cloud Code of Conduct** (Verification-ID 2023LVL02SCOPE4316), and offers the **Data Localization Suite**. Sources: https://www.cloudflare.com/trust-hub/gdpr/ , https://developers.cloudflare.com/data-localization/ | **High** |

**Sources:** DLS — https://developers.cloudflare.com/data-localization/ ; Regional Services — https://developers.cloudflare.com/data-localization/regional-services/ ; Regional *Email Security* processing (NOT Routing) — https://developers.cloudflare.com/changelog/2025-09-11-regional-email-processing-gia/ ; R2 jurisdiction — https://developers.cloudflare.com/r2/reference/data-location/

**Interpretation (Med):** You can achieve **EU-resident *storage*** (R2 `eu`) and likely EU processing for the Worker with DLS, but the **inbound email transit/processing layer (Email Routing MX) is not demonstrably EU-pinned**, and the CLOUD Act exposure of a US-parent processor persists regardless of region. Some secondary EU-sovereignty analyses flag exactly this for R2. For a tax product, this needs a **direct answer from Cloudflare Sales/Legal** and a signed DPA before production — **it is not something to infer.**

---

## 7. Pricing & limits for a low-volume pilot

| Item | Cost for TTR pilot | Confidence |
|---|---|---|
| **Email Routing (inbound)** | **Free, unlimited** on Free and Paid plans; no per-message charge, no card required | **High** |
| **Email Workers** | Free plan covers 100k requests/day; pilot volume (≤ a few hundred emails/day) is trivially inside free tier. Workers Paid $5/mo if you exceed or need Sending. | **High** |
| **R2** | ~$0.015/GB-month storage, **no egress fees**; a pilot's receipt images (a few GB) cost cents. Free tier: 10 GB storage + generous Class A/B ops. | **Med** (standard R2 pricing; verify current numbers) |
| **Email Sending (outbound acks)** | If replying only to the original sender via `reply()` → likely free. If using the Sending product to arbitrary recipients → **Workers Paid $5/mo**, 3,000/mo free, then $0.35/1k. | **High** |

**Net:** the whole inbound+storage pilot can run at **$0–$5/month**. Cost is not a differentiator vs Postmark/Mailgun for *inbound* (both have free inbound tiers), but R2's zero-egress is nice long-term. **(High)**

---

## 8. Minimal concrete architecture for the POC

```
Driver phone ──email──▶ Cloudflare MX (Email Routing, catch-all *@ingest.ttr.example)
                              │  invokes email() handler
                              ▼
                      ┌───────────────────────┐
                      │   Email Worker         │
                      │ 1. read message.to     │──▶ lookup driver (D1/KV/Postgres)
                      │ 2. postal-mime parse    │
                      │ 3. validate attachment  │   (mime allowlist: jpg/png/pdf; size)
                      │ 4. put() to R2 (eu)     │──▶ R2 bucket (jurisdiction=eu)
                      │ 5. write intake row     │──▶ DB: {driver_id, r2_key, from, msgId, ts}
                      │ 6. enqueue extraction   │──▶ Queue / Workflow ─▶ AI extraction agent
                      │ 7. message.reply() ack  │──▶ "✅ recibido" to driver
                      └───────────────────────┘
```

**Custom code you must write (the whole job):**
1. **Worker `email()` handler** — orchestrates steps 1–7. (~150–250 lines.)
2. **Driver resolver** — `message.to` (and cross-check `message.from`) → driver record; handle unknown addresses (bounce/register). Backing store: **D1** or your existing Postgres.
3. **Attachment validation** — MIME allowlist (`image/jpeg`, `image/png`, `application/pdf`), reject others via `setReject`; guard total size; handle emails with *no* attachment (nudge reply).
4. **R2 write** — deterministic key scheme e.g. `receipts/{driver_id}/{yyyy}/{mm}/{messageId}-{n}.{ext}`; store original filename in object metadata.
5. **Intake record + idempotency** — dedupe on `Message-ID` (drivers/clients resend); persist provenance for the audit trail AEAT will expect.
6. **Handoff** — enqueue to a **Queue** or **Workflow** that calls the AI extraction agent (Workers AI or external LLM). Keep extraction *out* of the email handler (the handler should return fast).
7. **Ack reply** — `message.reply()` with a short bilingual confirmation.

**Explicitly NOT needed for POC:** Agents SDK, Durable Objects, HMAC reply routing, `routeAgentEmail`. Add them only if TTR later wants a conversational back-and-forth with drivers.

---

## 9. Honest cons / risks & recommendation

**Cons / risks of Cloudflare (vs Postmark/Mailgun):**
- **Inbound auth verdicts unavailable to the Worker** (workerd #6740) → weaker spoofing defense; you must lean on the secret per-driver address. **(High)** — *biggest functional gap.*
- **Inbound Email Routing has no documented EU-only processing region** (that's an Email Security feature) → residency gap at the receive layer; needs Legal sign-off. **(High)**
- **Email Sending is public *beta*** with an unpublished, ramp-up daily quota → not something to depend on for guaranteed outbound at launch. **(High)**
- **25 MiB whole-message limit + base64 inflation** can reject multi-page phone scans. **(High)**
- **No built-in inbound spam scoring / rich parse webhook** like Postmark's inbound JSON (which pre-parses attachments, strips signatures, gives spam score). You rebuild parsing yourself with postal-mime. **(Med)**
- **CLOUD Act / US-parent processor** exposure persists even with EU storage. **(Med)**
- **"Email for Agents" magic (Agents SDK, DOs) adds concepts a 2–4 person team must learn** for little POC benefit. **(Med)**

**Where Cloudflare wins:** free unlimited inbound; R2 zero-egress + hard EU jurisdiction for storage; everything in one platform (Worker + storage + queue + AI); trivial cost; easy `message.reply()` acks. **(High)**

**Where Postmark/Mailgun is simpler:** turnkey **inbound parse webhook** with attachments + spam + full auth verdicts in one JSON POST; mature EU regions (Mailgun EU region; Postmark's established DPA); no beta on outbound; less to build. **(Med)**

### Recommendation
- **Adopt Cloudflare Email Routing + Email Worker + R2 (`eu`) for the POC IF** (a) Cloudflare Legal confirms an acceptable DPA + residency posture for the *inbound* layer, and (b) you accept mapping-by-address (not by-From) as the trust model. Use **plain Email Workers, not the Agents SDK.**
- **Otherwise fall back to Postmark or Mailgun (EU region) inbound webhooks** → your own store (which can still be R2/S3 EU). This is the lower-risk path if residency-at-receive or inbound-auth is a blocker, and it's what the dossier already assumed.
- **Either way, store attachments in an EU-jurisdiction object store and keep the AI extraction step decoupled** behind a queue.

---

## Open questions for the PRD

1. **Residency at the receive layer (blocking):** Where does Cloudflare *Email Routing* process inbound mail, and can it be EU-pinned? Get a written answer + DPA from Cloudflare before production. (If "no," this alone may force Postmark/Mailgun EU.)
2. **Inbound sender trust:** Given the Worker can't read SPF/DKIM/DMARC verdicts (workerd #6740), is "trust the secret per-driver address + cross-check From" an acceptable anti-fraud control for tax documents, or do we need a stronger identity step (e.g., per-driver token, first-use confirmation)?
3. **Outbound reliability:** Does TTR need guaranteed outbound (confirmations, AEAT correspondence)? If yes, the beta Email Sending daily-quota ramp is a risk — decide between CF Sending, Resend, Postmark, or MailChannels paid, and confirm whether `message.reply()`-only acks avoid the paid tier.
4. **Addressing scheme:** Full per-driver addresses (catch-all + DB map) vs `+`-subaddressing — decide, and validate that target driver mail clients don't mangle the chosen format.
5. **Attachment reality:** Will drivers' multi-page phone PDFs exceed 25 MiB after encoding? Need a size/compression policy and a graceful "too big — send pages separately" bounce.
6. **R2 at-rest key custody & encryption:** Is CF-managed AES-256 sufficient, or does TTR need app-layer encryption with its own keys for AEAT-grade PII?
7. **Audit trail:** What provenance must be stored per document (raw MIME retention? `Message-ID`? original `From`?) to satisfy AEAT/GDPR record-keeping, and for how long?
8. **DLS cost/tier:** Which residency features require Enterprise? Confirm the pilot can get EU guarantees on a self-serve plan (R2 `eu` is self-serve; Regional Services for Workers may not be).

---

## Sources

- Cloudflare blog — *Email Service now in public beta, ready for your agents*: https://blog.cloudflare.com/email-for-agents/
- Email Workers API (handler, `ForwardableEmailMessage`, reply): https://developers.cloudflare.com/email-service/api/route-emails/email-handler/
- Email Service limits (25 MiB, 200 rules, recipients): https://developers.cloudflare.com/email-service/platform/limits/
- Email Service pricing (inbound free; $0.35/1k, 3,000 free): https://developers.cloudflare.com/email-service/platform/pricing/
- Email authentication (SPF/DKIM/DMARC/ARC on inbound): https://developers.cloudflare.com/email-service/concepts/email-authentication/
- workerd issue #6740 (missing Authentication-Results to Worker): https://github.com/cloudflare/workerd/issues/6740
- postal-mime + Cloudflare Workers guide: https://postal-mime.postalsys.com/docs/guides/cloudflare-workers/
- Agents SDK email (`onEmail`, `routeAgentEmail`, resolvers, `sendEmail`/`replyToEmail`): https://developers.cloudflare.com/agents/communication-channels/email/
- R2 data location (jurisdictional restriction `eu` vs location hint): https://developers.cloudflare.com/r2/reference/data-location/
- Data Localization Suite / R2 how-to: https://developers.cloudflare.com/data-localization/ · https://developers.cloudflare.com/data-localization/how-to/r2/
- Regional Services (EU pinning): https://developers.cloudflare.com/data-localization/regional-services/
- Regional email processing = **Email Security only** (not Routing): https://developers.cloudflare.com/changelog/2025-09-11-regional-email-processing-gia/
- Cloudflare GDPR / DPA / EU Cloud CoC: https://www.cloudflare.com/trust-hub/gdpr/
- MailChannels EOL for Cloudflare Workers (31 Aug 2024): https://support.mailchannels.com/hc/en-us/articles/26814255454093-End-of-Life-Notice-Cloudflare-Workers · https://blog.mailchannels.com/important-update-mailchannels-email-sending-api-for-cloudflare-workers-to-be-terminated/
- Workers pricing ($5/mo Paid plan): https://developers.cloudflare.com/workers/platform/pricing/

*Prices, quotas, and beta statuses were current as of the July 2026 research date and should be re-verified against the live docs before implementation. Items marked Med/Low, and every "Open question," require primary confirmation from Cloudflare before TTR commits.*
