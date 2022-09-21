import { Interface } from "@ethersproject/abi";

const tokenURIInterface = new Interface([
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
    return json.replace(from, to);
  } else if (typeof json === "object") {
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

export async function fetchMetadata(
  env: any,
  chainId: string,
  contract: string,
  tokenID: string
): Promise<{
  metadata: Metadata;
  contractMetadata: ContractMetadata;
  block: { number: number; hash: string };
}> {
  let endpoint = env[`ETHEREUM_NODE_${chainId}`];
  if (!endpoint) {
    endpoint = env.ETHEREUM_NODE;
    if (!endpoint) {
      throw new Error(`no ethereum node specified for chainId ${chainId}`);
    }
  }

  // let blockNumber;
  // try {
  //   const response = await fetch(endpoint, {
  //     method: "POST",
  //     headers: { "Content-Type": "application/json" },
  //     body: JSON.stringify({
  //       id: 1,
  //       jsonrpc: "2.0",
  //       method: "eth_blockNumber",
  //       params: [],
  //     }),
  //   });
  //   const json = await response.json();
  //   if (json.error || !json.result) {
  //     throw new Error(
  //       `cannot get latest block number: \n` +
  //         (json.error
  //           ? JSON.stringify(json.error, null, 2)
  //           : `no result for ${contract}/}${tokenID}}`)
  //     );
  //   } else {
  //     blockNumber = parseInt(json.result.slice(2), 16);
  //   }
  // } catch (err) {
  //   throw new Error(`failed to get latest block: ${err.message}\n${err.stack}`);
  // }

  let block;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: 1,
        jsonrpc: "2.0",
        method: "eth_getBlockByNumber",
        params: ["latest", false],
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
      block = { number: json.result.number, hash: json.result.hash };
    }
  } catch (err) {
    throw new Error(`failed to get latest block: ${err.message}\n${err.stack}`);
  }

  let data;
  try {
    //   const tokenURISig = "0xc87b56dd";
    data = tokenURIInterface.encodeFunctionData("tokenURI", [tokenID]);
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
        params: [{ to: contract, data }, block.hash],
      }),
    });
    json = await response.json();
  } catch (err) {
    throw new Error(`failed to eth_call: ${err.message}\n${err.stack}`);
  }

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
        params: [{ to: contract, data }, block.hash],
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
        params: [{ to: contract, data }, block.hash],
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

  if (json.error || !json.result) {
    throw new Error(
      `eth_call failed: \n` +
        (json.error
          ? JSON.stringify(json.error, null, 2)
          : `no result for ${contract}/}${tokenID}}`)
    );
  }

  let tokenURI;
  try {
    tokenURI = tokenURIInterface.decodeFunctionResult(
      "tokenURI",
      json.result
    )[0];
  } catch (err) {
    throw new Error(
      `failed to decode eth_call result for ${contract}/${tokenID}`
    );
  }

  // ------------------------------------------------------------------------------------------------------------------
  // FIXES for broken projects
  // ------------------------------------------------------------------------------------------------------------------
  // JS24K
  try {
    const percentRegex = /50\%/gm;
    tokenURI = tokenURI.replace(percentRegex, "50%25");
  } catch (err) {
    throw new Error(
      `failed to fix URI for ${contract}/${tokenID}\ntokenURI: ${tokenURI}`
    );
  }

  // ------------------------------------------------------------------------------------------------------------------

  let urlDecodedTokenURI;
  try {
    urlDecodedTokenURI = decodeURI(tokenURI);
  } catch (err) {
    throw new Error(
      `failed to decode URI for ${contract}/${tokenID}\ntokenURI: ${tokenURI}`
    );
  }

  let metadata;
  try {
    /// ata:text/plain;charset=utf-8,
    if (tokenURI.startsWith("data:")) {
      if (tokenURI.startsWith("data:text/plain")) {
        if (tokenURI.startsWith("data:text/plain,")) {
          metadata = JSON.parse(urlDecodedTokenURI.slice(16));
        } else if (tokenURI.startsWith("data:text/plain;base64,")) {
          metadata = JSON.parse(atob(urlDecodedTokenURI.slice(23)));
        } else if (tokenURI.startsWith("data:text/plain;charset=utf-8,")) {
          metadata = JSON.parse(urlDecodedTokenURI.slice(30));
        } else {
          // attempting genericly
          const indexOfComma = urlDecodedTokenURI.indexOf(",");
          if (indexOfComma === -1) {
            throw new Error(`not supported : ${tokenURI}`);
          }
          metadata = JSON.parse(urlDecodedTokenURI.slice(indexOfComma + 1));
        }
      } else if (tokenURI.startsWith("data:application/json,")) {
        metadata = JSON.parse(urlDecodedTokenURI.slice(22));
      } else if (tokenURI.startsWith("data:application/json;base64,")) {
        metadata = JSON.parse(atob(urlDecodedTokenURI.slice(29)));
      } else {
        throw new Error(`not supported : ${tokenURI}`);
      }
    } else {
      if (tokenURI.startsWith("ipfs://")) {
        tokenURI = `https://ipfs.io/ipfs/${tokenURI.slice(7)}`;
      }
      try {
        metadata = await fetch(tokenURI).then((v) => v.json());
        metadata = recursiveReplace(
          metadata,
          "ipfs://",
          `https://ipfs.io/ipfs/`
        );
      } catch (err) {
        throw new Error(
          `failed to fetch URI for ${contract}/${tokenID}\ntokenURI: ${tokenURI}`
        );
      }
    }
  } catch (err) {
    throw new Error(
      `failed to parse metadata: ${err.message}\n${err.stack}\ntokenURI: ${tokenURI}`
    );
  }

  return { metadata, contractMetadata: { name, symbol }, block };
}
