import { base64ArrayBuffer } from "./strings";
import { TokenStandard } from "./metadata";

/**
 * Parse the middle path segment of `/eip155:<chain>/<here>/<tokenId>`.
 *
 * CAIP-22 spells it `erc721`, CAIP-29 spells it `erc1155`; `eip721`/`eip1155`
 * are accepted because this service used to emit them.
 */
export function parseTokenSegment(
  segment: string | undefined
): { standard: TokenStandard; contract: string } | null {
  if (!segment) return null;
  const colon = segment.indexOf(":");
  if (colon === -1) return null;
  const kind = segment.slice(0, colon).toLowerCase();
  const contract = segment.slice(colon + 1);
  if (!contract) return null;
  if (kind === "erc721" || kind === "eip721") {
    return { standard: "erc721", contract };
  }
  if (kind === "erc1155" || kind === "eip1155") {
    return { standard: "erc1155", contract };
  }
  return null;
}

export function getImageUrl(request: Request, imageID: string): string {
  const url = new URL(request.url);
  const imageURL = url.protocol + "//" + url.host + "/images/" + imageID;
  return imageURL;
}

const regex = /\//gm;
export function cssURLEscaped(uri: string): string {
  return uri.replace(regex, "\\/");
}

export async function blobToDataURI(blob): Promise<string> {
  const arr = await blob.arrayBuffer();
  return `data:${blob.type};base64,${base64ArrayBuffer(arr)}`;
  // return new Promise((resolve, _) => {
  //   const reader = new FileReader();
  //   reader.onloadend = () => resolve(reader.result as string);
  //   reader.readAsDataURL(blob);
  // });
}
