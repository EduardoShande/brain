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

## The frontend

Open `frontend/index.html` in a browser. Today it stores data in the browser's
`localStorage` (per device). As the backend comes online it will move to accounts
so data syncs across devices.

## Roadmap

- [x] **Phase 1** — Backend skeleton: FastAPI app, Postgres, Docker, health checks.
- [ ] **Phase 2** — Auth: users, signup/login, password hashing, JWT, migrations.
- [ ] **Phase 3** — Data API: per-user CRUD for thoughts, learnings, wishlist, certs, progress.
- [ ] **Phase 4** — Frontend wiring: login/signup UI, replace localStorage with the API.
- [ ] **Phase 5** — Deploy: Docker on a VPS, HTTPS, domain, backups.
- [ ] **Phase 6** — Harden: validation, rate limiting, CORS lockdown, security headers, tests.
