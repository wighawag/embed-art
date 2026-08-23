/**
 * ENS avatar resolution (ENSIP-12).
 *
 * The point of interest for this project: an NFT avatar record is written as
 *
 *     eip155:1/erc721:0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d/0
 *
 * which is byte-for-byte the path Embed.Art already serves. So resolving a
 * name to its avatar record and prefixing the origin is the whole feature.
 *
 * Known limits, deliberate for now:
 *  - `.eth` only. DNS-namespace ENS names resolve differently.
 *  - No ENSIP-10 wildcard / CCIP-read, so offchain names (many L2 subnames)
 *    report "no resolver" rather than resolving.
 *  - namehash() applies ethers' nameprep, not full ENSIP-15 normalisation.
 *  - No ownership verification. ENSIP-12 says clients SHOULD check the name's
 *    addr still owns the token; we render regardless and say so on the page.
 */
import { Interface } from "@ethersproject/abi";
import { namehash } from "@ethersproject/hash";
import { TokenStandard } from "./metadata";
import { ethCall, getEndpoints } from "./rpc";

export const ENS_REGISTRY = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const registryInterface = new Interface([
  "function resolver(bytes32 node) view returns (address)",
  "function owner(bytes32 node) view returns (address)",
]);
const resolverInterface = new Interface([
  "function text(bytes32 node, string key) view returns (string)",
  "function addr(bytes32 node) view returns (address)",
]);

export type AvatarRef =
  | { kind: "none" }
  | {
      kind: "nft";
      standard: TokenStandard;
      chainId: string;
      contract: string;
      tokenID: string;
      record: string;
    }
  | { kind: "image"; uri: string; record: string }
  | { kind: "unknown"; record: string };

// CAIP-22 (erc721) and CAIP-29 (erc1155), as referenced by ENSIP-12.
//
// Case-insensitive on purpose. CAIP-19 specifies a lowercase asset namespace,
// but records in the wild do not comply: sassal.eth, for one, is registered as
// `eip155:1/ERC1155:0x495f...`. Rejecting those would mean showing a real NFT
// avatar as unreadable, so we normalise instead.
const NFT_RECORD =
  /^eip155:(\d+)\/(erc721|erc1155):(0x[0-9a-fA-F]{40})\/(\d+)$/i;

const ENS_NAME = /^[^\s/?#]+\.eth$/i;

/**
 * Accepts a bare name as a user would type it and returns the lowercased form,
 * or null if it is not a name this service can resolve (`.eth` only).
 * Separate from isEnsName because the builder's contract field and the resolve
 * API take a name that never was a path.
 */
export function normalizeEnsName(value: string | null | undefined): string | null {
  const trimmed = (value || "").trim();
  return ENS_NAME.test(trimmed) ? trimmed.toLowerCase() : null;
}

export function isEnsName(pathname: string): string | null {
  const match = /^\/([^/?#]+)$/.exec(pathname);
  if (!match) return null;
  try {
    return normalizeEnsName(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}

export function parseAvatarRecord(record: string | null): AvatarRef {
  const trimmed = (record || "").trim();
  if (!trimmed) return { kind: "none" };

  const match = NFT_RECORD.exec(trimmed);
  if (match) {
    return {
      kind: "nft",
      chainId: match[1],
      standard: match[2].toLowerCase() as TokenStandard,
      contract: match[3],
      tokenID: match[4],
      record: trimmed,
    };
  }
  if (/^(https?:\/\/|ipfs:\/\/|ar:\/\/|data:)/i.test(trimmed)) {
    return { kind: "image", uri: trimmed, record: trimmed };
  }
  return { kind: "unknown", record: trimmed };
}

export type EnsResolution = {
  name: string;
  /** null means the registry has no owner for this node: never registered,
   *  or registered and since expired and released */
  owner: string | null;
  resolver: string | null;
  record: string | null;
  address: string | null;
};

function nodeOf(name: string): string {
  try {
    return namehash(name);
  } catch (err: any) {
    throw new Error(`not a valid ENS name: ${err.message}`);
  }
}

// owner() distinguishes "nobody has ever registered this" from "registered
// but never configured", which are very different things to tell a visitor.
async function lookupOwner(
  endpoint: string[],
  node: string
): Promise<string | null> {
  try {
    const ownerResult = await ethCall(
      endpoint,
      ENS_REGISTRY,
      registryInterface.encodeFunctionData("owner", [node])
    );
    const decoded = registryInterface.decodeFunctionResult(
      "owner",
      ownerResult
    )[0];
    return decoded && decoded !== ZERO_ADDRESS ? decoded : null;
  } catch {
    return null;
  }
}

async function lookupResolver(
  endpoint: string[],
  node: string
): Promise<string | null> {
  const resolverResult = await ethCall(
    endpoint,
    ENS_REGISTRY,
    registryInterface.encodeFunctionData("resolver", [node])
  );
  const resolver: string = registryInterface.decodeFunctionResult(
    "resolver",
    resolverResult
  )[0];
  return !resolver || resolver === ZERO_ADDRESS ? null : resolver;
}

async function lookupAddress(
  endpoint: string[],
  resolver: string,
  node: string
): Promise<string | null> {
  try {
    const addrResult = await ethCall(
      endpoint,
      resolver,
      resolverInterface.encodeFunctionData("addr", [node])
    );
    const decoded = resolverInterface.decodeFunctionResult(
      "addr",
      addrResult
    )[0];
    return decoded && decoded !== ZERO_ADDRESS ? decoded : null;
  } catch {
    return null;
  }
}

async function resolveUncached(
  env: any,
  name: string
): Promise<EnsResolution> {
  const endpoint = getEndpoints(env, "1");
  const node = nodeOf(name);

  const owner = await lookupOwner(endpoint, node);
  const resolver = await lookupResolver(endpoint, node);

  if (!resolver) {
    return { name, owner, resolver: null, record: null, address: null };
  }

  // A resolver that does not implement text() is not an error worth failing
  // the page over; it is simply a name with no avatar.
  let record: string | null = null;
  try {
    const textResult = await ethCall(
      endpoint,
      resolver,
      resolverInterface.encodeFunctionData("text", [node, "avatar"])
    );
    record = resolverInterface.decodeFunctionResult("text", textResult)[0];
  } catch {
    record = null;
  }

  const address = await lookupAddress(endpoint, resolver, node);

  return {
    name,
    owner,
    resolver,
    record: record && record.length > 0 ? record : null,
    address,
  };
}

/**
 * Deliberately NOT cached.
 *
 * A name to avatar mapping is mutable: the owner can repoint it at any moment,
 * and unlike a token URI there is no hash to notice the change. Caching it
 * means serving somebody's previous avatar, which is worse than the two
 * eth_calls this costs. What IS cached is everything downstream keyed by
 * content: the token's own data, and the rendered image keyed by the URI it
 * came from.
 */
export async function resolveEns(
  env: any,
  name: string
): Promise<EnsResolution> {
  return resolveUncached(env, name);
}

export type EnsAddress = {
  name: string;
  owner: string | null;
  resolver: string | null;
  address: string | null;
};

/**
 * Just the `addr` record: what a name points at, with no avatar read.
 *
 * This is the lookup behind the builder's contract field, where a name like
 * `bleeps.eth` stands for its NFT contract. It is a different question from
 * resolveEns(), with no avatar involved, and it is asked on every debounced
 * keystroke, so it does not pay for the text() call it would never read.
 * Not cached, for the same reason nothing keyed by a name is.
 */
export async function resolveEnsAddress(
  env: any,
  name: string
): Promise<EnsAddress> {
  const endpoint = getEndpoints(env, "1");
  const node = nodeOf(name);

  const owner = await lookupOwner(endpoint, node);
  const resolver = await lookupResolver(endpoint, node);
  if (!resolver) return { name, owner, resolver: null, address: null };

  const address = await lookupAddress(endpoint, resolver, node);
  return { name, owner, resolver, address };
}
