import createClient, { type Middleware } from 'openapi-fetch';
import { isProblem, type ErrorCode, type paths, type Problem } from '@homebell/contracts';

export type HomeBellClient = ReturnType<typeof createClient<paths>>;

export interface HomeBellClientOptions {
  /**
   * Web apps: the BFF prefix (e.g. "/api/hb") — the BFF adds the bearer token server-side.
   * Mobile: the API origin (e.g. "https://api.example.com").
   */
  baseUrl: string;
  /** Mobile only. Web apps rely on the BFF and must not provide tokens in the browser. */
  getAccessToken?: () => string | null | Promise<string | null>;
  /** Guardian app: returns the install ID sent as X-Device-Id. */
  getDeviceId?: () => string | null | Promise<string | null>;
  /** Called for 401 responses (e.g. to trigger refresh or forced logout). */
  onUnauthorized?: (problem: Problem | null, response: Response) => void;
  /** Override fetch (tests, MSW, React Native polyfills). */
  fetch?: typeof globalThis.fetch;
  /** Generates X-Request-Id values; defaults to crypto.randomUUID. */
  requestId?: () => string;
}

const randomId = (): string =>
  typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;

/** Create one Idempotency-Key per user intent and reuse it for retries of that intent. */
export const newIdempotencyKey = (): string => randomId();

export function createHomeBellClient(options: HomeBellClientOptions): HomeBellClient {
  const client = createClient<paths>({
    baseUrl: options.baseUrl,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });

  const headers: Middleware = {
    async onRequest({ request }) {
      request.headers.set('X-Request-Id', (options.requestId ?? randomId)());
      if (options.getAccessToken && !request.headers.has('Authorization')) {
        const token = await options.getAccessToken();
        if (token) request.headers.set('Authorization', `Bearer ${token}`);
      }
      if (options.getDeviceId && !request.headers.has('X-Device-Id')) {
        const deviceId = await options.getDeviceId();
        if (deviceId) request.headers.set('X-Device-Id', deviceId);
      }
      return request;
    },
    async onResponse({ response }) {
      if (response.status === 401 && options.onUnauthorized) {
        const body: unknown = await response
          .clone()
          .json()
          .catch(() => null);
        options.onUnauthorized(isProblem(body) ? body : null, response);
      }
      return response;
    },
  };
  client.use(headers);
  return client;
}

/** Error thrown by `unwrap` for non-2xx responses. Branch on `code`, never on message text. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | 'NETWORK_OR_UNKNOWN';
  readonly problem: Problem | null;

  constructor(status: number, problem: Problem | null) {
    super(problem?.title ?? `HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.problem = problem;
    this.code = problem?.code ?? 'NETWORK_OR_UNKNOWN';
  }

  is<C extends ErrorCode>(code: C): this is ApiError & { code: C } {
    return this.code === code;
  }
}

type FetchResult = { data?: unknown; error?: unknown; response: Response };

/**
 * Await an openapi-fetch call and return its data, or throw ApiError with the problem body.
 * For 204 responses the resolved value is `undefined`.
 */
export async function unwrap<R extends FetchResult>(
  call: Promise<R>,
): Promise<Exclude<R['data'], undefined>> {
  const result = await call;
  if (result.error !== undefined || !result.response.ok) {
    throw new ApiError(result.response.status, isProblem(result.error) ? result.error : null);
  }
  return result.data as Exclude<R['data'], undefined>;
}
