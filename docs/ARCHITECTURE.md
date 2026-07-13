# Architecture (draft)

This document captures early thinking for TTR. It is intentionally
technology-agnostic until the first real requirements land.

## Problem

Transportation operators routinely overpay taxes or miss refundable credits
because the data (fuel receipts, mileage by jurisdiction, filings) lives in
disconnected systems and the recovery rules are complex and jurisdiction-specific.

## High-level flow

```
Ingestion  ->  Normalization  ->  Rules engine  ->  Recovery matching  ->  Filings  ->  Reporting
```

1. **Ingestion** — pull in fuel purchases, mileage logs, and prior filings.
2. **Normalization** — map everything to a common schema (dates, jurisdictions,
   tax types, amounts).
3. **Rules engine** — encode recovery rules per jurisdiction and tax type.
4. **Recovery matching** — flag transactions eligible for refund/credit.
5. **Filings** — assemble audit-ready refund claims.
6. **Reporting** — expose recovered vs. pending amounts.

## Open questions

- Which jurisdictions and tax types do we support first? (IFTA? federal fuel tax
  credits? state excise?)
- Data sources: manual upload, ELD/telematics integrations, accounting systems?
- Stack: TypeScript full-stack vs. Python data backend + JS frontend.
- Compliance and record-retention requirements for filings.

## Decisions log

_Nothing decided yet. Record each stack/scope decision here with a date._
