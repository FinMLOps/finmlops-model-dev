# FinMLOps web (Next.js)

The dashboard as a Next.js app, built to be deployed on Google Cloud. The model still runs in the FastAPI server
(`frontend/server.py`); this app serves the pages and forwards every `/api/*` request to it.

```bash
# terminal 1: the API (repo root)
uv run python -m frontend.server            # http://localhost:8000

# terminal 2: this app
cd web
npm install
npm run dev                                 # http://localhost:3000
```

`API_URL` (see `.env.example`) points the app at the API. It's read on every request, so one build works locally
and on Cloud Run.

Pages: Home, Dashboard, News, Analyzer and Models, plus the detail drawer, the Ctrl/⌘ K palette, the guided tour
and the loading splash. Pages have real URLs (`/dashboard?ticker=NVDA`). This is the only UI: `frontend/server.py`
is just the API (opening http://localhost:8000 in a browser shows a short JSON note pointing here).

## Docker / Cloud Run

```bash
docker build -t finmlops-web web/
docker run -p 8080:8080 -e API_URL=http://host.docker.internal:8000 finmlops-web   # http://localhost:8080
```

On Cloud Run, deploy this image and set `API_URL` to the URL of the FastAPI service.
