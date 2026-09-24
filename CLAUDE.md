# Attribution Platform

A first-party marketing attribution platform for a Shopify store. It records how visitors arrive (UTMs, ad click IDs, referrers), follows them through checkout, and ties each Shopify order back to the touchpoints that led to it.

The current scope is **Phase 1**, which is specified in `docs/phase-1-spec.md`. Read it before starting any work. Anything not in that spec is out of scope until the owner approves it.

## Stack

- **App:** Next.js 16 (App Router; `proxy.ts` replaces `middleware.ts`) with TypeScript in strict mode, deployed on Vercel.
- **Database:** Supabase Postgres. Schema changes go through migrations in `supabase/migrations/` only.
- **Tests:** Vitest. Docker isn't installed, so there's no local Supabase: logic is tested as pure functions, and migrations are tested against PGlite.
- **Package manager:** npm.

## How to work

1. **Plan first.** Before writing code for a new piece, show the plan and wait for approval.
2. **Tests before moving on.** Each piece needs passing tests before the next piece starts. Write the test for a behavior alongside or before the code.
3. **Build in spec order:** collect endpoint → tracking script → Shopify webhooks → stitching → backfill → debug page.
4. **Small commits.** Commit one piece at a time, with a clear message.
5. **Ask before running** commands that touch the remote database (`supabase db push`), deploy, or push to GitHub.
6. **Stop and ask** when the spec is ambiguous. Don't invent requirements.

## Commands

```bash
npm run dev          # local dev server
npm test             # Vitest (includes migration tests on in-process Postgres via PGlite)
npm run lint         # ESLint
npm run typecheck    # next typegen && tsc --noEmit
npm run build:tracker  # bundle tracker/ into public/t.js
npx supabase migration new <name>   # create a migration
npx supabase db push                # apply migrations to the linked project (ask first)
```

## Project layout

```
app/api/collect/route.ts          # event ingestion endpoint
app/api/webhooks/shopify/route.ts # Shopify webhook receiver
app/debug/                        # internal debug page
lib/                              # shared logic (stitching, attribution, hmac, db)
public/t.js                       # built tracking script served to the storefront
tracker/                          # tracking script source
pixel/                            # Shopify custom pixel source (pasted into Shopify admin)
scripts/backfill.ts               # historical order backfill
supabase/migrations/              # SQL migrations
tests/                            # Vitest tests
```

## Rules

### Secrets
- Secrets live in `.env.local` (never committed) and in Vercel environment variables.
- `SUPABASE_SERVICE_ROLE_KEY`, `SHOPIFY_ADMIN_TOKEN` and `SHOPIFY_CLIENT_SECRET` are **server-only**. Never import them into client components, the tracking script or the pixel.
- Never log secrets, full request headers or raw webhook bodies.

### Database
- Every table has Row Level Security enabled. Phase 1 adds no public policies, so only the server (service role) can read or write.
- Use `timestamptz` for all times and store them in UTC.
- Store money as `numeric(12,2)` together with a currency code.
- Keep Shopify IDs as `bigint` or `text`, never as floats.

### Privacy
- Never store raw emails or phone numbers. Normalize them (trim, lowercase) and store a SHA-256 hash.
- Don't store full IP addresses. Hash them if they're needed for deduplication.
- The tracking script and pixel must respect Shopify's customer privacy/consent state (see the spec).

### Shopify
- Verify the HMAC on every webhook **before** parsing the body. Use a constant-time comparison.
- Webhook handlers must be idempotent. Deduplicate on the `X-Shopify-Webhook-Id` header.
- Pin the Admin API version in a single constant in `lib/shopify.ts`.

### Code style
- Use pure functions for logic (stitching, attribution, parsing) so it can be unit-tested without a database.
- Validate every external input (collect payloads, webhook bodies) with `zod`.
- Don't add dependencies without saying why.

@AGENTS.md
