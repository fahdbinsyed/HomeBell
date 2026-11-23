/**
 * BFF proxy (ADR-0016). Phase 1 runs on the in-browser mock API, so this route is not used.
 * Phase 3 implements: session cookie → bearer token, refresh, CSRF check, /api/hb/* → /v1/*.
 */
const notYet = () =>
  Response.json(
    {
      type: 'about:blank',
      title: 'Real API bridge arrives in Phase 3',
      status: 501,
      code: 'SERVICE_UNAVAILABLE',
      traceId: 'bff-phase1',
    },
    { status: 501, headers: { 'Content-Type': 'application/problem+json' } },
  );

export const GET = notYet;
export const POST = notYet;
export const PUT = notYet;
export const PATCH = notYet;
export const DELETE = notYet;
