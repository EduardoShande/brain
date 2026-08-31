# Brain — Field Manual

A personal learning operating system: one page that tracks everything I'm learning and building, from skill roadmaps to the certs I'm chasing.

**Live:** open `index.html` in any browser, or enable GitHub Pages to serve it at a URL.

## What's inside

- **Dashboard** — current focus, live progress across every roadmap, quick counts, recent thoughts, and next actions.
- **Roadmaps** — phase-based, checkable learning paths for Automation Engineering, Generative AI, Cloud, Security & Secure Coding, Data Analytics, and Databases. Each stage lists sub-concepts, resources, and a "do this" action.
- **Thoughts** — capture ideas and reflections, tagged by category and dated, searchable.
- **Learnings** — log what I've learned, tagged by domain, with the source and what I can now do with it.
- **Wishlist** — a prioritized backlog of what to learn next, with status.
- **Certifications** — track certs, cost, status, exam date, and study progress.

## How it works

- **Single self-contained file.** Everything (HTML, CSS, JS) lives in `index.html`. No build step, no dependencies, no server. It runs by opening the file, and the same file publishes cleanly as a shareable web page.
- **Vanilla JavaScript.** A small client-side router switches pages; no framework.
- **Local-first data.** Thoughts, learnings, wishlist, certs, and roadmap progress are saved in the browser's `localStorage`. Data stays on the device and is never uploaded, so nothing personal is committed to this repo.
- **Light and dark themes**, following the system preference.
- **Fonts** load from Google Fonts (Poppins, DM Sans, JetBrains Mono).

## Structure

```
.
├── index.html      # the entire app
├── archive/        # earlier standalone pages, kept for reference
└── README.md
```

## Notes

Because the data is local to each browser, opening the page on a new device or after clearing site data starts empty. A future version could add optional cloud sync.
