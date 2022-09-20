import { eip721 } from "./_handlers/eip721";

export async function onRequest(context) {
  // Contents of context object
  const {
    request, // same as existing Worker API
    env, // same as existing Worker API
    params, // if filename includes [id] or [[path]]
    waitUntil, // same as ctx.waitUntil in existing Worker API
    next, // used for middleware or to fetch assets
    data, // arbitrary space for passing data between middlewares
  } = context;

  console.log(JSON.stringify(env, null, 2));

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

  if (paths[0].startsWith("eip155:")) {
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
        paths[3] === "preview"
      );
    }
  } else if (paths[0] === "eip721" || paths[0] === "erc721") {
    return eip721(
      env,
      request,
      "1",
      paths[1],
      paths[2],
      paths[3] === "preview"
    );
  }
  return new Response(pathname);
}
