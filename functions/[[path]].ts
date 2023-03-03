import {
  eip721,
  generateDataURIForScreenshot,
  getData,
} from "./_handlers/eip721";
import { screenshotWithAllData } from "./_handlers/screenshotWithAllData";
import { Base64 } from "./_utils/base64";
import { parseMetadata } from "./_utils/metadata";

export async function onRequest(context: {
  env: any;
  request: Request;
  params: { path: string[] };
}) {
  // Contents of context object
  const {
    request, // same as existing Worker API
    env, // same as existing Worker API
    params, // if filename includes [id] or [[path]]
  } = context;

  const pathname = "/" + (params.path?.join("/") || "");
  const paths = params.path || [];
  if (
    pathname === "/" ||
    pathname === "/index.html" ||
    pathname.startsWith("/static")
  ) {
    try {
      const asset = await env.ASSETS.fetch(request);
      return asset;
    } catch (err) {
      return new Response(`${err.message}\n${err.stack}`, { status: 500 });
    }
  }

  if (paths[0] === "screenshot") {
    const capture = !!new URL(request.url).searchParams.get("capture");
    const hash = new URL(request.url).searchParams.get("hash");
    if (hash) {
      return screenshotWithAllData(undefined, capture);
    }

    const tokenURI = new URL(request.url).searchParams.get("tokenURI");
    const tokenURIBase64Encoded = new URL(request.url).searchParams.get(
      "tokenURIBase64Encoded"
    );
    if (tokenURIBase64Encoded) {
      return screenshotWithAllData(
        Base64.decode(tokenURIBase64Encoded),
        capture
      );
    } else if (tokenURI) {
      return screenshotWithAllData(tokenURI, capture);
    }

    const id = new URL(request.url).searchParams.get("id");
    if (id) {
      const splitted = id.split("/");
      const [, chainId] = splitted[0].split(":");
      const [erc, contract] = splitted[1].split(":");
      if (erc !== "erc721") {
        throw new Error(`ERC ${erc} not supported for now`);
      }
      const tokenID = splitted[2];
      const data = await getData(env, chainId, contract, tokenID);
      const metadata = await parseMetadata(data.tokenURI);
      const tokenURIToUse = await generateDataURIForScreenshot(
        data.tokenURI,
        metadata
      );
      return screenshotWithAllData(tokenURIToUse, capture);
    }

    return new Response(`no image specified: ${request.url}`, {
      status: 500,
    });
  } else if (paths[0].startsWith("eip155:")) {
    const chainIdAsNumber = parseInt(paths[0].slice(7));
    if (isNaN(chainIdAsNumber)) {
      return new Response(`invalid chainId: ${chainIdAsNumber}`, {
        status: 500,
      });
    }
    const chainId = chainIdAsNumber.toString();
    if (
      paths[1] &&
      (paths[1].startsWith("erc721:") || paths[1].startsWith("eip721:"))
    ) {
      const contract = paths[1].slice(7);
      const tokenID = paths[2];
      return eip721(
        env,
        request,
        chainId,
        contract,
        tokenID,
        !!new URL(request.url).searchParams.get("showScreenshot")
      );
    }
  } else if (paths[0] === "eip721" || paths[0] === "erc721") {
    return eip721(
      env,
      request,
      "1",
      paths[1],
      paths[2],
      !!new URL(request.url).searchParams.get("showScreenshot")
    );
  }
  return new Response(pathname);
}
