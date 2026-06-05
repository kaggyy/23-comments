# Chrome Comment Tool

A Notion-inspired visual feedback MVP for Chrome. The extension captures the visible browser viewport, lets a user draw rectangle annotations, and submits the report to a shared Supabase-backed dashboard.

## Apps

- `apps/extension`: Chrome Manifest V3 extension built with Vite and React.
- `apps/web`: Next.js dashboard for reports, comments, projects, and invite links.
- `packages/shared`: shared Zod schemas and TypeScript types.

## Setup

1. Create a Supabase project.
2. Run the SQL files in `supabase/migrations` in filename order using the Supabase SQL editor or Supabase CLI.
3. Copy `.env.example` to `.env.local` and fill in `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
4. Install dependencies with `npm install`.
5. Run the dashboard with `npm run dev`.
6. Build the extension with `npm run build --workspace @comment-tool/extension` and load `apps/extension/dist` as an unpacked Chrome extension.

The extension popup accepts the same Supabase URL and anon key as the dashboard. All joined users are treated as owners in the MVP.

## Internal rollout

For company trial setup, Vercel deployment, manual Chrome extension distribution, and MVP operating rules, see [docs/internal-rollout.md](docs/internal-rollout.md).
