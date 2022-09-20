export function getImageUrl(request: Request, imageID: string): string {
  const url = new URL(request.url);
  const imageURL = url.protocol + "//" + url.host + "/images/" + imageID;
  return imageURL;
}

const regex = /\//gm;
export function cssURLEscaped(uri: string): string {
  return uri.replace(regex, "\\/");
}
