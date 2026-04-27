# Project Field Hub Pro

Production-ready scaffold for a mobile-friendly multi-user construction project app built with:

- Next.js App Router
- Supabase Auth, Postgres, and Storage
- PDF report generation with `pdf-lib`

## What this version includes

- secure login scaffold for project teams
- protected dashboard route
- modern mobile-friendly UI
- typed project domain model
- demo dashboard data when Supabase is not configured yet
- PDF route for dilapidation / pre-construction survey export
- starter Supabase schema with row-level security
- live create/delete flows for all major project modules
- file uploads to Supabase Storage with attachment metadata

## Folder map

- `app/`
  Next.js routes and API endpoints.
- `components/`
  Dashboard and auth UI.
- `lib/`
  Supabase clients, helpers, and data access.
- `types/`
  Shared TypeScript types.
- `supabase/schema.sql`
  Starter database schema and policies.

## Recommended setup

### 1. Install Node.js

Install Node.js 20 or newer, then from this folder run:

```bash
npm install
```

### 2. Create a Supabase project

1. Create a new project in Supabase.
2. Copy `.env.example` to `.env.local`.
3. Fill in:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`

### 3. Create the database

Run the SQL in `supabase/schema.sql` inside the Supabase SQL editor.

### 4. Start the app

```bash
npm run dev
```

Then open:

- `http://localhost:3000`

## How the app is structured

### Login

- `/auth`
  Email/password login and account creation using Supabase Auth.
- `middleware.ts`
  Protects `/dashboard` and redirects unauthenticated users.

### Dashboard

- `/dashboard`
  Main project control dashboard.
- `components/dashboard-shell.tsx`
  Renders project modules: survey, daily, weekly, finance, completion, and defects.

### Cloud sync

- `lib/supabase/client.ts`
  Browser Supabase client.
- `lib/supabase/server.ts`
  Server-side Supabase client.
- `lib/projects.ts`
  Example dashboard data loader. It currently falls back to demo data if your database is empty or not configured.

### PDF generation

- `/api/projects/[projectId]/reports/dilapidation`
  Generates a downloadable PDF report.

## What to build next

This scaffold is intentionally the clean production starting point. The next implementation passes should be:

1. add edit forms for existing records, not just create/delete
2. add project membership and role-based permissions
3. add richer PDF templates and include attachments/thumbnails
4. add filters, search, and better project switching UX
5. add camera-first mobile flows and offline sync

## Recommended product roadmap

### Phase 1

- project CRUD
- section CRUD for all records
- storage bucket uploads
- live query hydration per project

### Phase 2

- create users by role with starter passwords
- per-project access control
- richer PDF exports
- project filters and search

### Phase 3

- offline-friendly mobile capture
- camera-first upload flows
- notifications and reminders
- approval workflows for handover, VO, and defect closure

## Use With Codex Web

This project can be used in Codex web after you publish this folder to GitHub as its own repository.

### 1. Keep secrets local

- commit `.env.example`
- do not commit `.env.local`
- do not commit `node_modules` or `.next`

### 2. Push this folder to GitHub

If you want this app to live in its own repo, run these commands from this folder:

```bash
git init
git checkout -b main
git add .
git commit -m "Initial Project Field Hub Pro commit"
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

### 3. Open it in Codex web

1. Connect GitHub to ChatGPT.
2. Select this repository in Codex web.
3. Choose the branch you want Codex to work on.
4. Ask Codex to edit, review, or extend the codebase.

### 4. Pull the changes back locally

```bash
git pull
npm install
npm run dev
```
