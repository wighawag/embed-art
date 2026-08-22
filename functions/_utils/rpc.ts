/**
 * Minimal JSON-RPC helpers shared by the token and ENS paths.
 */

export function getEndpoint(env: any, chainId: string): string {
  const endpoint = env[`ETHEREUM_NODE_${chainId}`] || env.ETHEREUM_NODE;
  if (!endpoint) {
    throw new Error(`no ethereum node specified for chainId ${chainId}`);
  }
  return endpoint;
}

export async function ethCall(
  endpoint: string,
  to: string,
  data: string,
  block: string = "latest"
): Promise<string> {
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
    throw new Error(`eth_call transport failed: ${err.message}`);
  }
  if (json.error) {
    throw new Error(`eth_call failed: ${JSON.stringify(json.error)}`);
  }
  if (!json.result) {
    throw new Error(`eth_call returned no result for ${to}`);
  }
  return json.result;
}
