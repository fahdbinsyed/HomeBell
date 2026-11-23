/**
 * Minimal, dependency-free stand-in for the parts of MSW the mock handlers use:
 * `http.<method>(path, resolver)`, `HttpResponse`, `getResponse(handlers, request)`.
 *
 * Why: MSW 3 pulls in @mswjs/interceptors / rettime, which extend browser globals such as
 * `MessageEvent` at module load. React Native's Hermes engine has no `MessageEvent`, so the real
 * MSW crashes on the phone. The guardian app aliases `msw` to this file (metro.config.js and the
 * Jest moduleNameMapper). Web apps and the contract-conformance tests keep using real MSW, so
 * the handlers stay MSW-compatible. Only standard Fetch API globals are required (Request,
 * Response, Headers, URL), which React Native provides.
 */

type Params = Record<string, string>;
type Resolver = (info: {
  request: Request;
  params: Params;
  requestId: string;
  cookies: Record<string, string>;
}) => Response | undefined | Promise<Response | undefined>;

interface LiteHandler {
  method: string;
  pattern: RegExp;
  keys: string[];
  resolver: Resolver;
}

function compile(path: string): { pattern: RegExp; keys: string[] } {
  const keys: string[] = [];
  const source = path
    .split(/(\*|:[A-Za-z0-9_]+)/)
    .map((part) => {
      if (part === '*') return '.*';
      if (part.startsWith(':')) {
        keys.push(part.slice(1));
        return '([^/]+)';
      }
      return part.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('');
  return { pattern: new RegExp(`^${source}/?$`), keys };
}

const make =
  (method: string) =>
  (path: string, resolver: Resolver): LiteHandler => ({ method, resolver, ...compile(path) });

export const http = {
  get: make('GET'),
  post: make('POST'),
  put: make('PUT'),
  patch: make('PATCH'),
  delete: make('DELETE'),
  all: make('*'),
};

/** Callable with `new` (returns a plain Response — no subclassing of polyfilled classes). */
export const HttpResponse = function HttpResponse(body?: BodyInit | null, init?: ResponseInit) {
  return new Response(body ?? null, init);
} as unknown as {
  new (body?: BodyInit | null, init?: ResponseInit): Response;
  json(body: unknown, init?: ResponseInit): Response;
};
HttpResponse.json = (body: unknown, init: ResponseInit = {}) => {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return new Response(JSON.stringify(body), { ...init, headers });
};

let counter = 0;

export async function getResponse(
  handlers: unknown[],
  request: Request,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const target = `${url.origin}${url.pathname}`;
  for (const h of handlers as LiteHandler[]) {
    if (h.method !== '*' && h.method !== request.method.toUpperCase()) continue;
    const m = h.pattern.exec(target);
    if (!m) continue;
    const params: Params = {};
    h.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1] ?? '')));
    const response = await h.resolver({
      request,
      params,
      requestId: String(++counter),
      cookies: {},
    });
    if (response) return response;
  }
  return undefined;
}

export type RequestHandler = LiteHandler;
