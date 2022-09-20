import { Metadata } from "../_utils/metadata";
// const regex = /\(|\)|\'|\"|\ |\//gm;
// function cssURLEscaped(uri: string): string {
//   return uri.replace(regex, (v) => {
//     switch (v) {
//       case "(":
//         return "%28";
//       case ")":
//         return "%29";
//       case " ":
//         return "%20";
//       case "/":
//         return "\\/";
//     }
//     return v; //`\\${v}`;
//   });
// }

//needed for css ?
// https://stackoverflow.com/a/851753/1663971
// https://www.w3.org/TR/CSS2/syndata.html#value-def-uri
const regex = /\//gm;
function cssURLEscaped(uri: string): string {
  return uri.replace(regex, "\\/");
}

export async function preview(metadata: Metadata): Promise<Response> {
  const title = metadata.name;
  const description = metadata.description;
  const image = metadata.image;
  const imageEscaped = cssURLEscaped(image);
  const page = `<!DOCTYPE html>
<html lang="en">
    <head>
        <title>${title}</title>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta name="title" content="${title}" />
        <meta name="description" content="${description}" />
    <style>
        body {
            margin: 0 0;
            background-color: black;
        }
        #img {
            position: absolute;
            top: 5vh;
            left: 5vw;
            margin: auto;
            background-position: center center;
            background-repeat: no-repeat;
            background-size: contain;
            height: 90vh;
            width: 90vw;
            background-image: url("${imageEscaped}");
        }
    </style>
    </head>
    <body><div id="img"></div></body>
</html>`;
  return new Response(page, {
    headers: { "content-type": "text/html" },
  });
}
