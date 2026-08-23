import { Interface } from "@ethersproject/abi";
import { BigNumber } from "@ethersproject/bignumber";
import { Base64 } from "./base64";
import { fetchFirstAvailable } from "./request";
import { findAdapter } from "./adapters";
import { ethCall, getEndpoints } from "./rpc";
import { candidateURIs, GATEWAYS, gatewayPath } from "./url";

export type TokenStandard = "erc721" | "erc1155";

/**
 * EIP-1155 metadata: clients MUST replace an `{id}` substring with the token
 * id in lowercase hex, zero-padded to 64 characters, no 0x prefix.
 */
export function erc1155IdHex(tokenID: string): string {
  return BigNumber.from(tokenID)
    .toHexString()
    .slice(2)
    .padStart(64, "0")
    .toLowerCase();
}

const tokenURIInterface = new Interface([
  {
    inputs: [
      {
        internalType: "uint256",
        name: "id",
        type: "uint256",
      },
    ],
    name: "uri",
    outputs: [
      {
        internalType: "string",
        name: "",
        type: "string",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "id",
        type: "uint256",
      },
    ],
    name: "tokenURI",
    outputs: [
      {
        internalType: "string",
        name: "",
        type: "string",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "name",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "symbol",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "contractURI",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
]);

/** Thrown when the metadata URL answers, but not with a success status. */
export class HttpStatusError extends Error {
  status: number;
  url: string;
  constructor(status: number, url: string) {
    super(`metadata URL returned HTTP ${status}: ${url}`);
    this.status = status;
    this.url = url;
  }
}

/** Nothing in the document can be drawn: no image and no animation. */
export function isRenderable(metadata: Metadata): boolean {
  return !!(metadata && (metadata.image || metadata.animation_url));
}

/**
 * One row of the trait table every marketplace shows next to a token. The
 * value is deliberately loose: the field is a convention, not a standard, and
 * collections put strings, numbers and booleans in it.
 */
export type Attribute = {
  trait_type?: string;
  value?: string | number | boolean | null;
  display_type?: string;
};

export type Metadata = {
  name?: string;
  description?: string;
  image?: string;
  animation_url?: string;
  external_url?: string;
  attributes?: Attribute[];
  // TODO more
};

export type ContractMetadata = {
  name?: string;
  symbol?: string;
};

function recursiveReplace(json: any, from: string, to: string): any {
  if (typeof json === "string") {
    return json.split(from).join(to);
  } else if (typeof json === "object" && json !== null) {
    if (Array.isArray(json)) {
      return json.map((v) => recursiveReplace(v, from, to));
    } else {
      for (const key of Object.keys(json)) {
        json[key] = recursiveReplace(json[key], from, to);
      }
    }
  }
  return json;
}

const finality = 12; // TODO parametrize

export type BlockchainData = {
  tokenURI: string;
  tokenURIBase64Encoded: string;
  contractMetadata: ContractMetadata;
  block: { number: number; hash: string };
  /**
   * Set when the tokenURI was NOT used as returned, which for now means it
   * was never returned at all and an adapter read the art elsewhere. The page
   * shows this: a viewer should never have to guess where a picture came from.
   */
  via?: {
    collection: string;
    note: string;
    reason: string;
    source: { address: string; method: string };
  };
};

export async function fetchBlockchainData(
  env: any,
  chainId: string,
  contract: string,
  tokenID: string,
  standard: TokenStandard = "erc721",
  /** `?strict` asks for the standard and nothing else, adapters included */
  strict = false
): Promise<BlockchainData> {
  const endpoints = getEndpoints(env, chainId);
  // Block reads are cheap and every node answers them; only the tokenURI call
  // is worth trying across the list.
  const endpoint = endpoints[0];
  // ERC-721 exposes tokenURI(uint256); ERC-1155 exposes uri(uint256).
  const uriMethod = standard === "erc1155" ? "uri" : "tokenURI";

  // ------------------------------------------------------------------------------------------------------------------
  // Block informatiom
  // ------------------------------------------------------------------------------------------------------------------

  let rawBlockNumber;
  let blockNumber;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: 1,
        jsonrpc: "2.0",
        method: "eth_blockNumber",
        params: [],
      }),
    });
    const json = await response.json();
    if (json.error || !json.result) {
      throw new Error(
        `cannot get latest block number: \n` +
          (json.error
            ? JSON.stringify(json.error, null, 2)
            : `no result for ${contract}/}${tokenID}}`)
      );
    } else {
      rawBlockNumber = json.result;
      blockNumber = parseInt(rawBlockNumber.slice(2), 16);
    }
  } catch (err) {
    throw new Error(`failed to get latest block: ${err.message}\n${err.stack}`);
  }

  let block: { number: number; hash: string };
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: 1,
        jsonrpc: "2.0",
        method: "eth_getBlockByNumber",
        params: [
          "0x" + Math.max(0, blockNumber - finality).toString(16),
          false,
        ],
      }),
    });
    const json = await response.json();
    if (json.error || !json.result) {
      throw new Error(
        `cannot get latest block: \n` +
          (json.error
            ? JSON.stringify(json.error, null, 2)
            : `no result for ${contract}/}${tokenID}}`)
      );
    } else {
      block = {
        number: parseInt(json.result.number.slice(2), 16),
        hash: json.result.hash,
      };
    }
  } catch (err) {
    throw new Error(`failed to get latest block: ${err.message}\n${err.stack}`);
  }

  // ------------------------------------------------------------------------------------------------------------------
  // contract level metadata
  // ------------------------------------------------------------------------------------------------------------------
  // TODO use contractURI
  let name;
  try {
    const data = tokenURIInterface.encodeFunctionData("name");
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: 1,
        jsonrpc: "2.0",
        method: "eth_call",
        params: [{ to: contract, data }, rawBlockNumber],
      }),
    });
    const json = await response.json();
    if (json.error || !json.result) {
    } else {
      try {
        name = tokenURIInterface.decodeFunctionResult("name", json.result)[0];
      } catch (err) {}
    }
  } catch (err) {}

  let symbol;
  try {
    const data = tokenURIInterface.encodeFunctionData("symbol");
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: 1,
        jsonrpc: "2.0",
        method: "eth_call",
        params: [{ to: contract, data }, rawBlockNumber],
      }),
    });
    const json = await response.json();
    if (json.error || !json.result) {
    } else {
      try {
        symbol = tokenURIInterface.decodeFunctionResult(
          "symbol",
          json.result
        )[0];
      } catch (err) {}
    }
  } catch (err) {}

  // ------------------------------------------------------------------------------------------------------------------
  // tokenURI
  // ------------------------------------------------------------------------------------------------------------------
  let data;
  try {
    //   const tokenURISig = "0xc87b56dd";
    data = tokenURIInterface.encodeFunctionData(uriMethod, [tokenID]);
  } catch (err) {
    throw new Error(`failed to encode eth_call: ${err.message}\n${err.stack}`);
  }

  // A collection with no tokenURI at all is somebody else's problem to fix
  // and ours to be useful about: see _utils/adapters.ts for the whole list of
  // exceptions and the rules they live under. Never under ?strict.
  const adapter = strict ? null : findAdapter(chainId, contract);
  if (adapter) {
    const { metadata, note, source } = await adapter.read(env, tokenID);
    const synthesised = `data:application/json;base64,${Base64.encode(
      JSON.stringify(metadata)
    )}`;
    return {
      tokenURI: synthesised,
      tokenURIBase64Encoded: Base64.encode(synthesised),
      contractMetadata: { name, symbol },
      block,
      via: {
        collection: adapter.collection,
        note,
        reason: adapter.reason,
        source,
      },
    };
  }

  // Across every configured endpoint: a renderer that builds its document in
  // memory can cost more gas than one node will spend on a read while another
  // returns it, and that difference is a fact about the nodes, not the token.
  const result = await ethCall(endpoints, contract, data, rawBlockNumber);

  let tokenURI;
  try {
    tokenURI = tokenURIInterface.decodeFunctionResult(uriMethod, result)[0];
  } catch (err) {
    throw new Error(
      `failed to decode eth_call result for ${contract}/${tokenID}\n${err.message}\n${err.stack}`
    );
  }

  if (standard === "erc1155") {
    tokenURI = tokenURI.split("{id}").join(erc1155IdHex(tokenID));
  }

  // ------------------------------------------------------------------------------------------------------------------
  // FIXES for broken projects
  // ------------------------------------------------------------------------------------------------------------------
  if (
    chainId === "4" &&
    contract.toLowerCase() ===
      "0x72361C9f3d4475CE13dA1997D34aFFB350cB17fB".toLowerCase()
  )
    try {
      const percentRegex = /50\%/gm;
      tokenURI = tokenURI.replace(percentRegex, "50%25");
    } catch (err) {
      throw new Error(
        `failed to fix URI for ${contract}/${tokenID}\n${err.message}\n${err.stack}\ntokenURI: ${tokenURI}`
      );
    }
  // ------------------------------------------------------------------------------------------------------------------
  // ------------------------------------------------------------------------------------------------------------------
  // ------------------------------------------------------------------------------------------------------------------

  return {
    tokenURI,
    tokenURIBase64Encoded: Base64.encode(tokenURI),
    contractMetadata: { name, symbol },
    block,
  };
}

/**
 * Whether a browser would be allowed to fetch this metadata itself.
 *
 * The token page renders client-side on purpose, so a metadata server that
 * omits Access-Control-Allow-Origin breaks the page even though the preview
 * card is fine (we fetch it server-side, where CORS does not apply). The
 * browser cannot tell a CORS rejection from a dropped connection, but we can:
 * we make the same request and can read the headers.
 */
export type CorsStatus = "allowed" | "blocked" | "unknown" | "not-applicable";

export type MetadataResult = {
  metadata: Metadata;
  cors: CorsStatus;
  /** the URL the browser would have to reach, after ipfs:// rewriting */
  fetchedFrom?: string;
};

function corsFromHeader(value: string | null): CorsStatus {
  if (value === null) return "blocked";
  if (value === "*") return "allowed";
  // A specific origin (or a Vary-driven echo) may or may not match ours; we
  // cannot decide that here, so do not claim to know.
  return "unknown";
}

export async function parseMetadata(
  tokenURI: string,
  idHex?: string
): Promise<Metadata> {
  return (await parseMetadataWithCors(tokenURI, idHex)).metadata;
}

export async function parseMetadataWithCors(
  tokenURI: string,
  idHex?: string
): Promise<MetadataResult> {
  // ------------------------------------------------------------------------------------------------------------------
  // DECODE URI
  // ------------------------------------------------------------------------------------------------------------------
  let urlDecodedTokenURI;
  try {
    urlDecodedTokenURI = decodeURIComponent(tokenURI);
  } catch (err) {
    // fallback ?
    urlDecodedTokenURI = tokenURI;
    // throw new Error(
    //   `failed to decode URI:\n${err.message}\n${err.stack}\ntokenURI: ${tokenURI}`
    // );
  }

  // ------------------------------------------------------------------------------------------------------------------
  // parse metadata
  // ------------------------------------------------------------------------------------------------------------------
  let metadata;
  let cors: CorsStatus = "not-applicable";
  let fetchedFrom: string | undefined;
  try {
    /// ata:text/plain;charset=utf-8,
    if (urlDecodedTokenURI.startsWith("data:")) {
      if (urlDecodedTokenURI.startsWith("data:text/plain")) {
        if (urlDecodedTokenURI.startsWith("data:text/plain,")) {
          metadata = JSON.parse(urlDecodedTokenURI.slice(16));
        } else if (urlDecodedTokenURI.startsWith("data:text/plain;base64,")) {
          metadata = JSON.parse(atob(urlDecodedTokenURI.slice(23)));
        } else if (
          urlDecodedTokenURI.startsWith("data:text/plain;charset=utf-8,")
        ) {
          metadata = JSON.parse(urlDecodedTokenURI.slice(30));
        } else {
          // attempting genericly
          const indexOfComma = urlDecodedTokenURI.indexOf(",");
          if (indexOfComma === -1) {
            throw new Error(`not supported : ${tokenURI}`);
          }
          metadata = JSON.parse(urlDecodedTokenURI.slice(indexOfComma + 1));
        }
      } else if (urlDecodedTokenURI.startsWith("data:application/json,")) {
        metadata = JSON.parse(urlDecodedTokenURI.slice(22));
      } else if (
        urlDecodedTokenURI.startsWith("data:application/json;base64,")
      ) {
        metadata = JSON.parse(atob(urlDecodedTokenURI.slice(29)));
      } else {
        throw new Error(`not supported : ${tokenURI}`);
      }
    } else {
      // A content-addressed URI is read back by the browser through THIS
      // origin, so no cross-origin request is made and the gateway's CORS
      // headers say nothing about what the visitor will experience. Asking
      // them anyway is how a page ended up claiming "allowed" while every
      // browser got a 403 challenge from ipfs.io.
      const contentAddressed = gatewayPath(tokenURI) !== null;
      // Our gateways first, the token's own courier last: same list the page
      // works from, so both sides agree on where the bytes came from.
      const candidates = candidateURIs(tokenURI);
      try {
        const { response, last, attempts } = await fetchFirstAvailable(
          candidates
        );
        const answered = response || last;
        if (!answered) {
          // Nobody answered at all, which for a CID means nobody is providing
          // those bytes any more: report it as gone rather than as slow.
          throw new Error(
            `no source answered for ${tokenURI}\n` +
              attempts.map((a) => `  ${a.url} -> ${a.outcome}`).join("\n")
          );
        }
        fetchedFrom = attempts[attempts.length - 1].url;
        tokenURI = fetchedFrom;
        cors = contentAddressed
          ? "not-applicable"
          : corsFromHeader(answered.headers.get("access-control-allow-origin"));
        if (!answered.ok) {
          // A 404 body is often still valid JSON (OpenSea answers with
          // {"errors":[...]}), and parsing it as metadata yields a document
          // with no image, which then burns 30s in the headless browser
          // waiting for something that will never render.
          throw new HttpStatusError(answered.status, tokenURI);
        }
        metadata = await answered.json();
        metadata = recursiveReplace(metadata, "ipfs://", GATEWAYS.ipfs[0]);
      } catch (err) {
        if (err instanceof HttpStatusError) throw err;
        throw new Error(
          `failed to fetch URI:\n${err.message}\n${err.stack}\ntokenURI: ${tokenURI}`
        );
      }
    }
  } catch (err) {
    if (err instanceof HttpStatusError) throw err;
    throw new Error(
      `failed to parse metadata: ${err.message}\n${err.stack}\ntokenURI: ${tokenURI}`
    );
  }

  // EIP-1155 allows `{id}` inside the metadata document too, not just the URI.
  if (idHex) {
    metadata = recursiveReplace(metadata, "{id}", idHex);
  }

  return { metadata, cors, fetchedFrom };
}
