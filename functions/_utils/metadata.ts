import { Interface } from "@ethersproject/abi";
import { BigNumber } from "@ethersproject/bignumber";
import { Base64 } from "./base64";
import { getEndpoint } from "./rpc";

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

export type Metadata = {
  name?: string;
  description?: string;
  image?: string;
  animation_url?: string;
  external_url?: string;
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
};

export async function fetchBlockchainData(
  env: any,
  chainId: string,
  contract: string,
  tokenID: string,
  standard: TokenStandard = "erc721"
): Promise<BlockchainData> {
  const endpoint = getEndpoint(env, chainId);
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

  let json;
  try {
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
    json = await response.json();
  } catch (err) {
    throw new Error(
      `failed to eth_call (${block.hash}): ${err.message}\n${err.stack}`
    );
  }

  if (json.error || !json.result) {
    throw new Error(
      `eth_call failed (${block.hash}):  \n` +
        (json.error
          ? JSON.stringify(json.error, null, 2)
          : `no result for ${contract}/}${tokenID}}`)
    );
  }

  let tokenURI;
  try {
    tokenURI = tokenURIInterface.decodeFunctionResult(
      uriMethod,
      json.result
    )[0];
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
      if (tokenURI.startsWith("ipfs://")) {
        tokenURI = `https://ipfs.io/ipfs/${tokenURI.slice(7)}`;
      }
      fetchedFrom = tokenURI;
      try {
        const response = await fetch(tokenURI);
        cors = corsFromHeader(
          response.headers.get("access-control-allow-origin")
        );
        if (!response.ok) {
          // A 404 body is often still valid JSON (OpenSea answers with
          // {"errors":[...]}), and parsing it as metadata yields a document
          // with no image, which then burns 30s in the headless browser
          // waiting for something that will never render.
          throw new HttpStatusError(response.status, tokenURI);
        }
        metadata = await response.json();
        metadata = recursiveReplace(
          metadata,
          "ipfs://",
          `https://ipfs.io/ipfs/`
        );
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
