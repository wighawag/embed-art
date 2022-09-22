import { cssURLEscaped } from "../_utils/url";

export async function screenshot(imageURI: string): Promise<Response> {
  const imageEscaped = cssURLEscaped(imageURI);
  const page = `<!DOCTYPE html>
<html lang="en">
    <head>
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
            background-image: url("${imageEscaped}");
        }
    </style>
    </head>
    <body><div id="img"></div><img src="${imageURI}"/></body>
</html>`;
  return new Response(page, {
    headers: { "content-type": "text/html" },
  });
}
