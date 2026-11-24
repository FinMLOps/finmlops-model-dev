"""Deployment helpers, used by deploy/deploy.sh and the deploy workflow (see DEPLOY.md).

uv run python -m scripts.deploy pull                    # the champion and registry.json from MODEL_BUCKET into bundle/
uv run python -m scripts.deploy check API_URL [WEB_URL] # smoke test the deployed services
"""

import json
import shutil
import sys
import time
import urllib.request

from google.cloud import storage

from scripts import registry
from scripts.config import REGISTRY_NAME, ROOT

BUNDLE = ROOT / "bundle"  # what Dockerfile.api bakes into the API image (gitignored)
PREFIX = f"models/{REGISTRY_NAME}"


def pull(bucket=None):
    """download the champion named in gs://<bucket>/models/finbert-sentiment/registry.json into bundle/model/,
    with registry.json beside it; returns the champion's version"""
    gcs = storage.Client().bucket(registry.bucket_name(bucket))
    manifest = json.loads(gcs.blob(f"{PREFIX}/registry.json").download_as_text())
    version = manifest["champion"]
    folder = f"{PREFIX}/v{version}/"
    blobs = [b for b in gcs.list_blobs(prefix=folder) if not b.name.endswith("/")]
    if not blobs:
        raise RuntimeError(f"registry.json names v{version}, but gs://{gcs.name}/{folder} is empty; run `scripts.registry push`")
    shutil.rmtree(BUNDLE, ignore_errors=True)
    for blob in blobs:
        dest = BUNDLE / "model" / blob.name.removeprefix(folder)
        dest.parent.mkdir(parents=True, exist_ok=True)
        blob.download_to_filename(str(dest))
    (BUNDLE / "registry.json").write_text(json.dumps(manifest, indent=1))
    return version


def request(url, body=None, timeout=120):
    """(status, text) of a GET, or a POST when body is given; a cold Cloud Run service can take a while to answer"""
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return res.status, res.read().decode()


def check(api, web=None, tries=5, wait=10):
    """fail unless the API serves a champion, labels a headline and has the dashboard data, and (with web) the site
    loads and reaches the API through its /api proxy. Retries, since a new revision may still be starting."""
    api, web = api.rstrip("/"), (web or "").rstrip("/")
    for attempt in range(1, tries + 1):
        try:
            health = json.loads(request(f"{api}/api/health")[1])
            pred = json.loads(request(f"{api}/api/predict", {"text": "Nvidia beats revenue estimates"})[1])
            overview = json.loads(request(f"{api}/api/overview")[1])
            assert health["status"] == "ok", health
            assert pred["label"] in {"positive", "neutral", "negative"}, pred
            assert len(overview["tickers"]) == 7, "the overview should have all seven tickers"
            if web:
                status, page = request(web)
                assert status == 200 and "FinMLOps" in page, "the home page didn't load"
                assert json.loads(request(f"{web}/api/health")[1])["status"] == "ok", "the site can't reach the API"
            return {"champion": health["champion"], "news_as_of": health["news_as_of"], "sample_label": pred["label"]}
        except Exception as exc:
            if attempt == tries:
                raise RuntimeError(f"smoke test failed after {tries} tries: {exc}") from exc
            print(f"smoke test try {attempt} failed ({exc}); retrying in {wait}s", flush=True)
            time.sleep(wait)


def main(args):
    if args == ["pull"]:
        print(f"champion v{pull()} -> {BUNDLE}")
    elif args and args[0] == "check" and len(args) in (2, 3):
        print("smoke test passed:", json.dumps(check(*args[1:])))
    else:
        sys.exit("usage: python -m scripts.deploy pull | check API_URL [WEB_URL]")


if __name__ == "__main__":
    main(sys.argv[1:])
