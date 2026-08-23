/**
 * How this service identifies itself when it fetches somebody else's content.
 *
 * Not decoration. An unidentified request is treated as anonymous traffic:
 * arweave.net answers the default worker request `403` and answers the very
 * same request carrying a name `200`, which is the difference between a token
 * page and an error page. It is also the courteous arrangement, since a host
 * that wants us to stop can see who to ask.
 */
export const USER_AGENT = "embed.art (+https://embed.art)";

/**
 * fetch(), with this service's name on it and a bound on how long it may wait
 * for a RESPONSE.
 *
 * The timer is cleared the moment the headers arrive, so it limits "time to
 * answer" and never interrupts a body already streaming: a 30MB image on a
 * slow link is fine, an IPFS gateway holding the connection open while it
 * hunts for a provider that does not exist is not. Without this a token whose
 * content is unpinned takes minutes to fail, because each gateway sits on the
 * request until its own timeout (ipfs.io: 28 seconds) and we then ask the
 * next one.
 */
export async function fetchAsService(
  url: string,
  init: RequestInit = {},
  timeoutMs?: number
): Promise<Response> {
  const headers = new Headers((init.headers as HeadersInit) || {});
  if (!headers.has("user-agent")) headers.set("user-agent", USER_AGENT);
  if (!timeoutMs) return fetch(url, { ...init, headers });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** How long one source may take to answer, and how long we try in total. */
export const FETCH_BUDGET = { perAttemptMs: 12000, totalMs: 25000 };

/**
 * Below this, an attempt is not worth making: a source given a second to
 * answer has been set up to fail, and the honest report is that we ran out of
 * time rather than that it refused.
 */
const MIN_ATTEMPT_MS = 1500;

export type Attempt = { url: string; outcome: string };

/**
 * The first of several URLs that actually answers, within a time budget.
 *
 * Used wherever one piece of content has more than one address: our gateways
 * in order, then the courier the token named. A CID that nobody pins any more
 * has to be reported as gone in seconds rather than minutes, and the budget is
 * what makes "gone" a conclusion instead of a hang.
 *
 * The fetcher is injectable so the budget can be tested without a network.
 */
export async function fetchFirstAvailable(
  urls: string[],
  init: RequestInit = {},
  budget: { perAttemptMs?: number; totalMs?: number; now?: () => number } = {},
  fetcher: (
    url: string,
    init: RequestInit,
    timeoutMs: number
  ) => Promise<Response> = fetchAsService
): Promise<{ response?: Response; last?: Response; attempts: Attempt[] }> {
  const perAttemptMs = budget.perAttemptMs ?? FETCH_BUDGET.perAttemptMs;
  const totalMs = budget.totalMs ?? FETCH_BUDGET.totalMs;
  const now = budget.now ?? Date.now;
  const deadline = now() + totalMs;
  const attempts: Attempt[] = [];
  // The most recent real HTTP answer, kept even when it was a refusal: a 404
  // from the last source is a fact about the token (no such id), while a
  // timeout is only a fact about the network.
  let last: Response | undefined;

  for (const url of urls) {
    const remaining = deadline - now();
    if (remaining < MIN_ATTEMPT_MS) {
      attempts.push({ url, outcome: "skipped: out of time" });
      continue;
    }
    try {
      const response = await fetcher(
        url,
        init,
        Math.min(perAttemptMs, remaining)
      );
      last = response;
      attempts.push({ url, outcome: `${response.status}` });
      if (response.ok || response.status === 304 || response.status === 206) {
        return { response, last, attempts };
      }
    } catch (err: any) {
      attempts.push({ url, outcome: err?.message || "failed" });
    }
  }

  return { last, attempts };
}

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

export function handleOptions(request: Request) {
  if (
    request.headers.get("Origin") !== null &&
    request.headers.get("Access-Control-Request-Method") !== null &&
    request.headers.get("Access-Control-Request-Headers") !== null
  ) {
    // Handle CORS pre-flight request.
    return new Response(null, {
      headers: corsHeaders,
    });
  } else {
    // Handle standard OPTIONS request.
    return new Response(null, {
      headers: {
        Allow: "GET, HEAD, POST, OPTIONS",
      },
    });
  }
}

export function createJSONResponse(
  data: any,
  options?: { status: number }
): Response {
  return new Response(JSON.stringify(data), {
    headers: {
      ...corsHeaders,
      "content-type": "application/json;charset=UTF-8",
    },
    status: options?.status,
  });
}

export function pathFromURL(urlAsString: string) {
  const url = new URL(urlAsString);
  const pathname = url.pathname;
  const patharray = pathname
    .slice(1, pathname.endsWith("/") ? pathname.length - 1 : undefined)
    .split("/");
  return { url, pathname, patharray };
}

export function parseGETParams(urlAsString: string): {
  [key: string]: number | string;
} {
  const { searchParams } = new URL(urlAsString);
  const params = Array.from(searchParams.entries()).reduce(
    (prev: { [key: string]: string | number }, curr) => {
      let value: string | number;
      // number need to be prefixed by $
      // string that start with $ need to be prefixed by $ too
      if (curr[1].startsWith("$")) {
        if (curr[1].startsWith("$$")) {
          value = curr[1].substring(1);
        } else {
          const valueStr = curr[1].substring(1);
          value = parseInt(valueStr);
          if (isNaN(value)) {
            value = valueStr;
          }
        }
      } else {
        value = curr[1];
      }
      prev[curr[0]] = value;
      return prev;
    },
    {}
  );
  return params;
}
