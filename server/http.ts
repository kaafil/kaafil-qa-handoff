/**
 * The whole HTTP layer, which is about a hundred lines because this server
 * does seven things.
 *
 * `node:http` only. There is no Express here and adding one would change what
 * the exercise measures: a QA reading this backend should be able to see the
 * three Kaafil calls without first learning a framework's middleware order.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { isKaafilError, isRetryable } from 'kaafil-js';

export interface RouteContext {
  readonly req: IncomingMessage;
  readonly url: URL;
  /** Path parameters captured by a `:name` segment in the route's pattern. */
  readonly params: Readonly<Record<string, string>>;
  /** Parsed JSON body. `{}` for a request that sent none. */
  readonly body: unknown;
}

export interface Route {
  readonly method: 'GET' | 'POST';
  /** `/api/crm/trips/:tourId` — one `:name` segment matches one path segment. */
  readonly pattern: string;
  handle(ctx: RouteContext): Promise<unknown> | unknown;
}

/**
 * An error this server itself is raising, as opposed to one that came back
 * from Kaafil. Kept distinct so `serializeError` never dresses a local
 * validation mistake up as an engine response code.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = 'CRM_REQUEST_INVALID',
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads a required string field off a JSON body, or explains what was missing. */
export function requireString(body: unknown, field: string): string {
  if (!isRecord(body)) {
    throw new HttpError(400, 'Request body must be a JSON object.');
  }
  const value = body[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new HttpError(400, `"${field}" is required and must be a non-empty string.`);
  }
  return value;
}

/** Same, for a field that may legitimately be absent. */
export function optionalString(body: unknown, field: string): string | undefined {
  if (!isRecord(body)) {
    return undefined;
  }
  const value = body[field];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string' || value.length === 0) {
    throw new HttpError(400, `"${field}", when present, must be a non-empty string.`);
  }
  return value;
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' } as const;

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, JSON_HEADERS);
  res.end(JSON.stringify(body));
}

// Generous for a JSON POST of three fields, bounded so a stuck client cannot
// grow this process's heap without limit.
const MAX_BODY_BYTES = 1024 * 1024;

export function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    req.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        reject(new HttpError(413, `Request body exceeds ${MAX_BODY_BYTES} bytes.`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'Request body is not valid JSON.'));
      }
    });
    req.on('error', (cause) => reject(cause));
  });
}

/**
 * Turns anything thrown into a response.
 *
 * A `kaafil-js` error keeps its own `code`, `status` and — the field that
 * actually ends a support conversation — its `requestId`. Debugging a 403
 * against a real tenant without the request id means guessing; with it, the
 * engine's own logs can be read for that exact call. Never invent a code: an
 * error this function does not recognise becomes a plain 500 carrying its own
 * message, not a fabricated Kaafil failure.
 */
export function serializeError(error: unknown): {
  status: number;
  body: { error: Record<string, unknown> };
} {
  if (error instanceof HttpError) {
    return {
      status: error.status,
      body: {
        error: {
          source: 'crm',
          name: error.name,
          code: error.code,
          status: error.status,
          message: error.message,
        },
      },
    };
  }

  if (isKaafilError(error)) {
    // `status` is undefined for a pure transport failure — no response
    // envelope was ever parsed, so there is no engine status to report. 502 is
    // this server's own honest "the upstream call did not complete", and it is
    // deliberately distinguishable from any status Kaafil actually returned.
    return {
      status: error.status ?? 502,
      body: {
        error: {
          source: 'kaafil',
          name: error.name,
          kind: error.kind,
          code: error.code ?? null,
          status: error.status ?? null,
          requestId: error.requestId ?? null,
          message: error.message,
          details: error.details ?? null,
          retryable: isRetryable(error),
        },
      },
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    status: 500,
    body: {
      error: {
        source: 'crm',
        name: error instanceof Error ? error.name : 'Error',
        code: 'CRM_UNEXPECTED',
        status: 500,
        message,
      },
    },
  };
}

/**
 * First route whose method and pattern match, with its captured parameters.
 * Patterns are compared segment by segment — no regex, no precedence rules to
 * remember, and a literal segment never loses to a `:param` one because the
 * table below is short enough to order by hand.
 */
export function matchRoute(
  routes: readonly Route[],
  method: string,
  pathname: string,
): { route: Route; params: Record<string, string> } | null {
  const actual = pathname.split('/').filter((segment) => segment.length > 0);
  for (const route of routes) {
    if (route.method !== method) {
      continue;
    }
    const expected = route.pattern.split('/').filter((segment) => segment.length > 0);
    if (expected.length !== actual.length) {
      continue;
    }
    const params: Record<string, string> = {};
    let matched = true;
    for (let i = 0; i < expected.length; i += 1) {
      const want = expected[i] as string;
      const got = actual[i] as string;
      if (want.startsWith(':')) {
        params[want.slice(1)] = decodeURIComponent(got);
      } else if (want !== got) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return { route, params };
    }
  }
  return null;
}
