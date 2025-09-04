## Learning.ua Matematyka Crawler (Node.js)

Parser-only crawler (no Playwright) that collects task links from `https://learning.ua/matematyka/` using axios + cheerio and outputs JSON/CSV.

### Install

```bash
npm install
```

### Run

```bash
npm run crawl
```

Outputs will be saved to:

- `data/tasks.json`
- `data/tasks.csv`
 - `data/html/` (downloaded task HTML workspace)

### Notes

- The crawler is polite: low concurrency, request interval delays, custom User-Agent.
- It starts at the main Matematyka page, discovers category pages (e.g., via "Переглянути") and pagination, and extracts task links whose titles look like `A.1 ...` / `А.1 ...`.
- Heuristics may need tuning if the site structure changes.

### HTML Workspace

- Each task page is downloaded into `data/html/` with a sanitized filename derived from the URL path.
- `tasks.json` and `tasks.csv` include a `localPath` column pointing to the saved HTML file when available.


