import { NextRequest } from "next/server";
export const dynamic = "force-dynamic";
async function proxy(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  if (
    !path.length ||
    path.some((p) => !/^[-a-zA-Z0-9]+$/.test(p)) ||
    !["platform", "platform-auth"].includes(path[0])
  )
    return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
  const origin = process.env.PLATFORM_ORIGIN ?? "https://localhost:3100";
  if (
    !["GET", "HEAD"].includes(req.method) &&
    req.headers.get("origin") !== origin
  )
    return Response.json({ error: { code: "CSRF_INVALID" } }, { status: 403 });
  const backend = process.env.HOMEBELL_API_ORIGIN ?? "http://127.0.0.1:3000";
  const url = new URL(`/api/v1/${path.join("/")}`, backend);
  url.search = req.nextUrl.search;
  const headers = new Headers();
  for (const name of [
    "cookie",
    "content-type",
    "x-csrf-token",
    "idempotency-key",
    "origin",
  ]) {
    const v = req.headers.get(name);
    if (v) headers.set(name, v);
  }
  try {
    const response = await fetch(url, {
      method: req.method,
      headers,
      body: ["GET", "HEAD"].includes(req.method) ? undefined : await req.text(),
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    const result = new Headers({ "Cache-Control": "no-store" });
    for (const name of ["content-type", "location", "x-request-id"]) {
      const v = response.headers.get(name);
      if (v) result.set(name, v);
    }
    for (const cookie of response.headers.getSetCookie())
      result.append("set-cookie", cookie);
    return new Response(response.body, {
      status: response.status,
      headers: result,
    });
  } catch {
    return Response.json(
      { error: { code: "API_UNAVAILABLE" } },
      { status: 503 },
    );
  }
}
export { proxy as GET, proxy as POST };
