# DebtVerge

Debt management plan (DMP) software for FCA-regulated debt advice firms — case management, Standard Financial Statement (SFS) builder, creditor ledger and pro-rata distribution, payment gateway and cashier operations, vulnerability and compliance tooling, IVA/insolvency workflows, omnichannel communications and a debtor self-service portal.

This repository was separated out of the Stormreef/Bolt monorepo so DebtVerge can be developed, deployed and sold as its own product.

## Stack

Vite · React 18 · TypeScript · Tailwind CSS · Supabase (Postgres, Auth, Edge Functions) · Recharts · jsPDF

## Getting started

```bash
cp .env.example .env      # add your Supabase URL + anon key
npm install
npm run dev
```

Scripts: `npm run dev`, `npm run build`, `npm run typecheck`, `npm run lint`.

Routes: `/` (sign in → workspace), `/debtverge/signup` (public tenant sign-up wizard).

## Layout

```
src/
  App.tsx                 auth gate -> DebtVerge workspace
  components/DebtVerge.tsx   main workspace (cases, SFS, creditors, IVA, ...)
  components/DebtVergeNav.tsx  DebtVerge-only top bar
  components/debt/ comms/ iva/ income-calc/   feature modules
  lib/                    Supabase client, hooks, types, UK tax, insolvency docs
supabase/
  migrations/             schema history copied from the source project
  functions/              payment-gateway, recurring-collection, batch-processing,
                          disbursement-run, queue-worker, provision-debtverge-tenant,
                          knowledge-assistant, storm-call-ai
docs/                     standalone specification + architecture documents
```

## Status and known follow-ups

- The frontend builds and bundles standalone. Cross-app switching (Stormreef launcher, other Storm apps) has been removed; IVA/Draft transfer buttons are hidden until an API handover exists.
- Migrations are the debt-related chain plus the platform tables it depends on (organizations, RBAC, licensing, background jobs, StormCall, knowledge). They were applied incrementally to the source Supabase project and **cannot be replayed from an empty database** — some platform migrations assume rows that already existed. Point the app at the existing Supabase project, or consolidate into a clean schema per `docs/DEBTVERGE_STANDALONE_ARCHITECTURE.md` (`dv_` tables, local org/RBAC tables).
- `npm run typecheck` reports legacy type errors carried over from the source project (the Vite build does not type-check). They are not runtime errors but should be cleaned up.
- Next steps are in the architecture doc, Section 12/13: real Stripe/GoCardless gateway, BACS file generation, handover API, MFA.
