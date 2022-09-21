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
]);

export type Metadata = {
  name?: string;
  description?: string;
  image?: string;
  animation_url?: string;
  external_url?: string;
  // TODO more
};

export async function fetchMetadata(
  env: any,
  chainId: string,
  contract: string,
  tokenID: string
): Promise<Metadata> {
  let endpoint = env[`ETHEREUM_NODE_${chainId}`];
  if (!endpoint) {
    endpoint = env.ETHEREUM_NODE;
    if (!endpoint) {
      throw new Error(`no ethereum node specified for chainId ${chainId}`);
    }
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
        params: [{ to: contract, data }, "latest"],
      }),
    });
    json = await response.json();
  } catch (err) {
    throw new Error(`failed to eth_call: ${err.message}\n${err.stack}`);
  }

  if (json.error || !json.result) {
    throw new Error(json.error || `no result for ${contract}/}${tokenID}}`);
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
    if (tokenURI.startsWith("data:")) {
      if (tokenURI.startsWith("data:text/plain,")) {
        metadata = JSON.parse(urlDecodedTokenURI.slice(16));
      } else if (tokenURI.startsWith("data:text/plain;base64,")) {
        metadata = JSON.parse(atob(urlDecodedTokenURI.slice(23)));
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

  return metadata;
}
