import {
  eip721,
  generateDataURIForScreenshot,
  getData,
} from "../functions/_handlers/eip721";
import { screenshotWithAllData } from "../functions/_handlers/screenshotWithAllData";
import { Base64 } from "../functions/_utils/base64";
import { parseMetadata } from "../functions/_utils/metadata";

export default {
  async fetch(
    request: Request,
    env: any,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // ------------------------------------------------------------------
    // Static assets — with run_worker_first = false (default) the asset
    // system serves these before the Worker is invoked.  This block is a
    // fallback for when the Worker is reached on a static-looking path.
    // ------------------------------------------------------------------
    if (
      pathname === "/" ||
      pathname === "/index.html" ||
      pathname.startsWith("/static")
    ) {
      if (env.ASSETS) {
        return env.ASSETS.fetch(request);
      }
      return new Response("Not found", { status: 404 });
    }

    // ------------------------------------------------------------------
    // R2 image handler — serve generated preview JPEGs from R2
    // ------------------------------------------------------------------
    if (pathname.startsWith("/images/")) {
      try {
        const imageID = pathname.slice("/images/".length);
        const fromR2 = await env.IMAGES.get(imageID);
        if (fromR2) {
          const headers = new Headers();
          fromR2.writeHttpMetadata(headers);
          headers.set("etag", fromR2.httpEtag);
          return new Response(fromR2.body, { headers });
        }
        return new Response(`Not found : ${pathname}`, { status: 404 });
      } catch (err: any) {
        return new Response(`${err.message}\n${err.stack}`, { status: 500 });
      }
    }

    // ------------------------------------------------------------------
    // Screenshot handler
    // ------------------------------------------------------------------
    if (pathname === "/screenshot") {
      const capture = !!url.searchParams.get("capture");
      const hash = url.searchParams.get("hash");
      if (hash) {
        return screenshotWithAllData(undefined, capture);
      }

      const tokenURI = url.searchParams.get("tokenURI");
      const tokenURIBase64Encoded = url.searchParams.get(
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

      const id = url.searchParams.get("id");
      if (id) {
        const splitted = id.split("/");
        const [, chainId] = splitted[0].split(":");
        const [erc, contract] = splitted[1].split(":");
        if (erc !== "erc721") {
          return new Response(`ERC ${erc} not supported for now`, {
            status: 500,
          });
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
    }

    // ------------------------------------------------------------------
    // eip721 handler — /eip155:<chainId>/erc721:<contract>/<tokenID>
    // ------------------------------------------------------------------
    if (pathname.startsWith("/eip155:")) {
      const pathSegments = pathname.slice(1).split("/").filter(Boolean);
      const chainIdAsNumber = parseInt(pathSegments[0].slice(7));
      if (isNaN(chainIdAsNumber)) {
        return new Response(`invalid chainId: ${chainIdAsNumber}`, {
          status: 500,
        });
      }
      const chainId = chainIdAsNumber.toString();
      if (
        pathSegments[1] &&
        (pathSegments[1].startsWith("erc721:") ||
          pathSegments[1].startsWith("eip721:"))
      ) {
        const contract = pathSegments[1].slice(7);
        const tokenID = pathSegments[2];
        return eip721(
          env,
          request,
          chainId,
          contract,
          tokenID,
          !!url.searchParams.get("showScreenshot")
        );
      }
    }

    // ------------------------------------------------------------------
    // Legacy paths — /eip721/<contract>/<tokenID> or /erc721/<contract>/<tokenID>
    // ------------------------------------------------------------------
    if (pathname.startsWith("/eip721/") || pathname.startsWith("/erc721/")) {
      const pathSegments = pathname.slice(1).split("/").filter(Boolean);
      return eip721(
        env,
        request,
        "1",
        pathSegments[1],
        pathSegments[2],
        !!url.searchParams.get("showScreenshot")
      );
    }

    return new Response(pathname);
  },
} satisfies ExportedHandler<any>;