export async function onRequest(context) {
  const { env, params } = context;
  try {
    const pathname = "/" + (params.path?.join("/") || "");
    const fromR2 = await env.IMAGES.get(pathname.slice(1));
    if (fromR2) {
      const headers = new Headers();
      fromR2.writeHttpMetadata(headers);
      headers.set("etag", fromR2.httpEtag);

      return new Response(fromR2.body, {
        headers,
      });
    } else {
      return new Response(`Not found`, { status: 404 });
    }
  } catch (err) {
    return new Response(`${err.message}\n${err.stack}`, { status: 500 });
  }
}
