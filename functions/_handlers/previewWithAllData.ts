import { Metadata } from "../_utils/metadata";
import { cssURLEscaped } from "../_utils/url";
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

export async function previewWithAllData(tokenURI: string): Promise<Response> {
  const page = `<!DOCTYPE html>
<html lang="en">
    <head>
        <title>Screenshot</title>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
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
        }
    </style>
    </head>
    <body>
      <div id="img"></div>
      <script>
        const regex = /\//gm;
        function cssURLEscaped(uri) {
          return uri.replace(regex, "\\/");
        }
        async function refresh() {
          const tokenURI = ${"`" + tokenURI + "`"};
          const metadataURLToFetch = tokenURI.startsWith('ipfs://') ? 'https://ipfs.io/ipfs/' + tokenURI.slice(7) : tokenURI;
          const metadata = await fetch(metadataURLToFetch).then(v => v.json());
          
          if (metadata.image) {
            const cssImage = metadata.image.startsWith('ipfs://') ? 'https://ipfs.io/ipfs/'  + tokenURI.slice(7) : (metadata.image.startsWith('data:') ? cssURLEscaped(etadata.image) : metadata.image);   
            document.getElementById('img').style.['background-image'] = cssImage;
          }
        }
      </script>
    </body>
</html>`;
  return new Response(page, {
    headers: { "content-type": "text/html" },
  });
}
