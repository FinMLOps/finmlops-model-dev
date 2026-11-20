// Forwards /api/* to the FastAPI server, which runs the model. API_URL is read on every request, so the same
// build talks to a local server (default) or to the Cloud Run service, depending on the environment.
const API = process.env.API_URL ?? "http://localhost:8000";

async function forward(req: Request, ctx: RouteContext<"/api/[...path]">) {
  const { path } = await ctx.params;
  const target = `${API}/api/${path.join("/")}${new URL(req.url).search}`;
  try {
    const res = await fetch(target, {
      method: req.method,
      headers: { "content-type": req.headers.get("content-type") ?? "application/json" },
      body: req.method === "GET" ? undefined : await req.text(),
      cache: "no-store",
    });
    return new Response(res.body, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
    });
  } catch {
    return Response.json({ detail: `The API server isn't reachable at ${API}` }, { status: 502 });
  }
}

export { forward as GET, forward as POST };
