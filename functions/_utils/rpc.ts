/**
 * Minimal JSON-RPC helpers shared by the token and ENS paths.
 */

/**
 * The endpoints to try for a chain, best first.
 *
 * `ETHEREUM_NODE` (or `ETHEREUM_NODE_<chainId>`) may hold a comma-separated
 * list. One node is enough until a token is expensive to read: nodes cap the
 * gas an `eth_call` may burn, the caps differ, and a heavy onchain renderer
 * lands on the wrong side of one node's cap while another returns the whole
 * document. Non-Fungible Moons is the case in hand.
 */
export function getEndpoints(env: any, chainId: string): string[] {
  const configured = env[`ETHEREUM_NODE_${chainId}`] || env.ETHEREUM_NODE;
  const endpoints = String(configured || "")
    .split(",")
    .map((endpoint) => endpoint.trim())
    .filter(Boolean);
  if (endpoints.length === 0) {
    throw new Error(`no ethereum node specified for chainId ${chainId}`);
  }
  return endpoints;
}

/** The first configured endpoint, for callers that only need one. */
export function getEndpoint(env: any, chainId: string): string {
  return getEndpoints(env, chainId)[0];
}

/**
 * "This call needs more gas than I am willing to spend on a read."
 *
 * Worth recognising rather than reporting as a generic failure: the token is
 * fine, the contract is fine, and the answer exists. What ran out is a policy
 * limit on the node we asked, so the fix is another node rather than another
 * token.
 */
export function isGasCapError(message: string): boolean {
  return /out of gas|gas required exceeds|exceeds .*gas limit|intrinsic gas|gas exhausted/i.test(
    message || ""
  );
}

export class RpcError extends Error {
  /** true when every endpoint refused for want of gas */
  gasCapped: boolean;
  constructor(message: string, gasCapped: boolean) {
    super(message);
    this.gasCapped = gasCapped;
  }
}

/**
 * eth_call against the first endpoint that answers.
 *
 * A JSON-RPC error is not fatal on its own: a second node may have a higher
 * gas cap, or simply be up. Only when every endpoint has refused does this
 * throw, carrying what each one said.
 */
export async function ethCall(
  endpoints: string | string[],
  to: string,
  data: string,
  block: string = "latest"
): Promise<string> {
  const list = Array.isArray(endpoints) ? endpoints : [endpoints];
  const failures: string[] = [];
  let gasCapped = false;

  for (const endpoint of list) {
    let json: any;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: 1,
          jsonrpc: "2.0",
          method: "eth_call",
          params: [{ to, data }, block],
        }),
      });
      json = await response.json();
    } catch (err: any) {
      failures.push(`transport failed: ${err.message}`);
      continue;
    }
    if (json.error) {
      const message = json.error.message || JSON.stringify(json.error);
      if (isGasCapError(message)) gasCapped = true;
      failures.push(message);
      continue;
    }
    if (!json.result) {
      failures.push(`no result for ${to}`);
      continue;
    }
    return json.result;
  }

  // The first line carries the reason, because the error page shows the first
  // line: "refused by 1 node" on its own tells a visitor nothing at all.
  const detail = failures
    .map((failure, index) => `  ${hostOf(list[index])}: ${failure}`)
    .join("\n");
  const summary =
    failures.length === 1
      ? `eth_call refused by ${hostOf(list[0])}: ${failures[0]}`
      : `eth_call refused by all ${failures.length} nodes, first: ${failures[0]}`;
  throw new RpcError(`${summary}\n${detail}`, gasCapped);
}

/** The host of an endpoint, since the full URL usually carries a key. */
export function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return "node";
  }
}
