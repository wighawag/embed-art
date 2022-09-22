import { base64ArrayBuffer } from "./strings";

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
