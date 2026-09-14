# Brain

A personal learning operating system, evolving into a multi-user product. It tracks
everything you're learning and building: skill roadmaps, thoughts, learnings, a
wishlist, and the certifications you're chasing.

The project is a **monorepo**:

```
.
├── frontend/           # the web app (single self-contained index.html for now)
│   ├── index.html
│   └── archive/        # earlier standalone pages, kept for reference
├── backend/            # FastAPI + PostgreSQL API (multi-user, in progress)
│   ├── app/
│   │   ├── main.py         # FastAPI entrypoint
│   │   ├── core/config.py  # settings from environment
│   │   ├── db/             # engine, session, declarative base
│   │   ├── models/         # SQLAlchemy models (users, thoughts, ...)
│   │   ├── schemas/        # Pydantic request/response models
│   │   └── api/routes/     # endpoints (health, auth, ...)
│   ├── requirements.txt
│   └── Dockerfile
├── docker-compose.yml  # Postgres + API for local development
└── .env.example        # copy to .env and fill in
```

## Why a custom backend (not a BaaS)

This is deliberately built from scratch, FastAPI, PostgreSQL, SQLAlchemy, and JWT
auth, to learn backend, APIs, and databases end to end. A managed service would be
faster to ship, but the point here is the skills and full control.

## Run the backend (development)

Prerequisites: Docker Desktop.

```bash
cp .env.example .env      # then edit JWT_SECRET
docker compose up --build
```

Then:

- API root: http://localhost:8000/
- Interactive docs (Swagger): http://localhost:8000/docs
- Health: http://localhost:8000/health
- DB health: http://localhost:8000/health/db

Postgres is exposed on `localhost:5432` (user/password/db default to `brain`).

## Accounts, Pro access and QR payments (Supabase)

The live academy signs students in and sells Pro access through a Supabase project
(`supabase/`). The FastAPI backend above stays as a learning project.

- `supabase/migrations/` holds the schema: profiles, plans, entitlements, orders,
  payment events, and `course_content`. Row level security decides who reads what,
  so paid lessons only reach an account with active access.
- `supabase/functions/` holds four Edge Functions: `create-order` (makes a QR charge),
  `check-order` (the checkout polls it), `payment-webhook` (the provider calls it),
  and `mock-pay` (test mode only, admins only).
- Payment providers sit behind one interface in `functions/_shared/payments.ts`.
  An order is marked paid only after the provider itself confirms it. To go live,
  write an adapter for the provider (CUCU, a bank API), set the `PAYMENT_PROVIDER`
  secret, and set `payment_mode` to `live` in `public.app_settings`.
- Paid course HTML is not in this repo. It lives in the `course_content` table; the
  local copy in `private-content/` is gitignored.

## The frontend

Open `frontend/index.html` in a browser, or serve the folder
(`python -m http.server 8770 --directory frontend`). Accounts and access come from
Supabase; notes, progress and XP still live in the browser's `localStorage`.

## Roadmap

- [x] **Phase 1** — Backend skeleton: FastAPI app, Postgres, Docker, health checks.
- [x] **Phase 2** — Auth: users table + migration, signup/login, bcrypt hashing, JWT, `/me` profile.
- [ ] **Phase 3** — Data API: per-user CRUD for thoughts, learnings, wishlist, certs, progress.
- [x] **Phase 4** — Frontend wiring: login/signup UI (Supabase Auth), Pro access, QR checkout.
- [ ] **Phase 5** — Deploy: Docker on a VPS, HTTPS, domain, backups.
- [ ] **Phase 6** — Harden: validation, rate limiting, CORS lockdown, security headers, tests.
