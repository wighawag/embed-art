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
  //   const tokenURISig = "0xc87b56dd";
  const data = tokenURIInterface.encodeFunctionData("tokenURI", [tokenID]);
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
  const json = await response.json();
  if (json.error || !json.result) {
    throw new Error(json.error || `no result for ${contract}/}${tokenID}}`);
  }

  // TODO try catch
  let tokenURI = tokenURIInterface.decodeFunctionResult(
    "tokenURI",
    json.result
  )[0];

  // ------------------------------------------------------------------------------------------------------------------
  // FIXES for broken projects
  // ------------------------------------------------------------------------------------------------------------------
  // JS24K
  const percentRegex = /50\%/gm;
  tokenURI = tokenURI.replace(percentRegex, "50%25");
  // ------------------------------------------------------------------------------------------------------------------

  const urlDecodedTokenURI = decodeURI(tokenURI);

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
      metadata = await fetch(tokenURI).then((v) => v.json());
    }
  } catch (err) {
    throw new Error(`${err.message}\n${err.stack}\ntokenURI: ${tokenURI}`);
  }

  return metadata;
}
