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
  main.tsx                entry point
  shell/                  sign-in, MFA, routing, and the list of apps (apps.ts)
  core/                   code every app shares: Supabase client, auth, licences and
                          roles, types, formatting, UI kit
  apps/debtverge/         the DebtVerge app (loaded only when shown)
    Root.tsx              what the shell mounts after sign-in
    public.tsx            pages that need no staff sign-in (payment link, e-sign, sign-up)
    components/           workspace, debt/ comms/ iva/ compliance/ phone/ ...
    lib/                  DebtVerge hooks, UK tax, insolvency documents
  Rule: an app may import from core, never from another app.
supabase/
  migrations/             schema history copied from the source project
  functions/              payment-gateway, recurring-collection, batch-processing,
                          disbursement-run, queue-worker, provision-debtverge-tenant,
                          knowledge-assistant, storm-call-ai
docs/                     standalone specification + architecture documents
```

## Status and known follow-ups

- The frontend builds and bundles standalone. Cross-app switching (Stormreef launcher, other Storm apps) has been removed; IVA/Draft transfer buttons are hidden until an API handover exists.
- **Database setup:** on a new, empty Supabase project, paste `supabase/schema.sql` into the SQL editor and run it once. It is the whole migration chain in one verified script (tested in a scratch Postgres); legacy Stormreef seed rows are removed at the end.
- `supabase/migrations/` keeps the original history for reference. It is the debt-related chain plus the platform tables it depends on (organizations, RBAC, licensing, background jobs, StormCall, knowledge). They were applied incrementally to the source Supabase project and **cannot be replayed from an empty database** — some platform migrations assume rows that already existed. Point the app at the existing Supabase project, or consolidate into a clean schema per `docs/DEBTVERGE_STANDALONE_ARCHITECTURE.md` (`dv_` tables, local org/RBAC tables).
- `npm run typecheck` reports legacy type errors carried over from the source project (the Vite build does not type-check). They are not runtime errors but should be cleaned up.
- Next steps are in the architecture doc, Section 12/13: real Stripe/GoCardless gateway, BACS file generation, handover API, MFA.
