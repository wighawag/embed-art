/**
 * GET /api/resolve/<name>.eth -> what that name's `addr` record points at.
 *
 * The URL builder on the front page needs this: a collection is often easier
 * to name than to spell, and `bleeps.eth` is its NFT contract. The lookup has
 * to happen here rather than in the page, because resolving a name needs an
 * Ethereum node and the node URL is a server secret.
 *
 * The answer is never cached and says so, for the reason ENS pages are not
 * cached either: a name is a mutable pointer with no hash to notice a change.
 */
import { normalizeEnsName, resolveEnsAddress } from "../_utils/ens";

/** Why a well-formed name still produced no address. */
export type NoAddressReason = "not-registered" | "no-resolver" | "no-address";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function resolveApiRoute(
  env: any,
  rawName: string
): Promise<Response> {
  const name = normalizeEnsName(rawName);
  if (!name) {
    return json(
      { name: rawName, error: "not a resolvable name (.eth only)" },
      400
    );
  }

  let resolution;
  try {
    resolution = await resolveEnsAddress(env, name);
  } catch (err: any) {
    // A dead node is not the visitor's fault and not a "no such name": say so
    // rather than letting the field claim the name does not exist.
    return json({ name, error: err.message }, 502);
  }

  if (resolution.address) {
    return json({ name, address: resolution.address }, 200);
  }

  const reason: NoAddressReason = !resolution.owner
    ? "not-registered"
    : !resolution.resolver
    ? "no-resolver"
    : "no-address";

  return json({ name, address: null, reason }, 200);
}
