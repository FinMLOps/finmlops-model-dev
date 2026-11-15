# UI setup

> [!WARNING]
> `frontend/demo_server.py` shows **fake data** and is temporary, for UI design only. It gets removed once the real data is ready.

## Preview with fake data

Needs only Python 3, no installs.

```bash
python3 frontend/demo_server.py
```

Open http://localhost:8001. Port taken? Use `PORT=8002 python3 frontend/demo_server.py`.

Edit files in `frontend/static/` and refresh the browser to see changes.

**Auto-reload instead** (needs Node): keep the server above running, and in a second terminal run

```bash
npx browser-sync start --proxy localhost:8001 --files "frontend/static/**/*" --no-notify
```

then open http://localhost:3000. CSS updates live, HTML/JS changes reload the page.

## Run with real data

```bash
uv sync --extra cpu                         # or --extra gpu
uv run python -m frontend.server score      # label all articles with the champion model
uv run python -m frontend.server prices     # daily closing prices
uv run python -m frontend.server            # http://localhost:8000
```
