# TTR — Transportation Tax Recovery Platform

TTR helps transportation and logistics operators identify, document, and recover
overpaid taxes and eligible tax credits (e.g. fuel tax credits, IFTA
reconciliation, excise tax refunds, and jurisdictional overpayments).

> **Status:** early scaffold. The stack and modules below describe the intended
> direction; nothing here is production-ready yet.

## Goals

- **Recover** — surface overpaid or refundable transportation taxes automatically.
- **Document** — generate audit-ready filings and supporting records.
- **Reconcile** — cross-check fuel purchases, mileage, and jurisdictional rates.
- **Report** — give operators a clear view of pending and recovered amounts.

## Planned modules

| Module | Purpose |
| ------ | ------- |
| `ingestion` | Import fuel receipts, mileage logs, and filing data. |
| `rules` | Jurisdiction- and tax-type-specific recovery rules. |
| `recovery` | Match transactions to recovery opportunities. |
| `filings` | Generate refund claims and audit packages. |
| `reporting` | Dashboards and export for recovered/pending amounts. |

## Repository layout

```
TTR/
├── src/      # application source
├── tests/    # test suite
├── docs/     # design notes and documentation
└── README.md
```

## Getting started

The stack is not yet chosen. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
for the current thinking. Once a stack lands, setup instructions go here.

## License

[MIT](LICENSE)
