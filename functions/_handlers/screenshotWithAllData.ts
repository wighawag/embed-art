export async function screenshotWithAllData(
  tokenURI?: string
): Promise<Response> {
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
      ${
        tokenURI
          ? ""
          : `<script>
          var atobUTF8=function(){"use strict";function h(b){var a=b.charCodeAt(0)<<24,d=k(~a),c=0,f=b.length,e="";if(5>d&&f>=d){a=a<<d>>>24+d;for(c=1;c<d;++c)a=a<<6|b.charCodeAt(c)&63;65535>=a?e+=g(a):1114111>=a?(a-=65536,e+=g((a>>10)+55296,(a&1023)+56320)):c=0}for(;c<f;++c)e+="\\ufffd";return e}var l=Math.log,m=Math.LN2,k=Math.clz32||function(b){return 31-l(b>>>0)/m|0},g=String.fromCharCode,n=atob;return function(b,a){a||"\\u00ef\\u00bb\\u00bf"!==b.substring(0,3)||(b=b.substring(3));return n(b).replace(/[\\xc0-\\xff][\\x80-\\xbf]*/g,
            h)}}() 
          </script>`
      }
      <script>
        const tokenURI = ${
          tokenURI ? "`" + tokenURI + "`" : `atobUTF8(location.hash.slice(1))`
        };
        const regex = /\\//gm;
        const cssURLEscaped = (uri) => {
          return uri.replace(regex, "\\/");
        };
        async function fetchImage(tokenURI) {
          let metadataURLToFetch = tokenURI;
          if (metadataURLToFetch.startsWith('ipfs://')) {
            metadataURLToFetch = 'https://ipfs.io/ipfs/' + tokenURI.slice(7);
          }
          const metadataResponse = await fetch(metadataURLToFetch);
          const metadata = await metadataResponse.json();
          
          if (metadata.image) {
            let cssImage = metadata.image;
            if (cssImage.startsWith('ipfs://')) {
              cssImage = 'https://ipfs.io/ipfs/'  + tokenURI.slice(7);
            } else if (cssImage.startsWith('data:')) {
              cssImage = cssURLEscaped(cssImage);
            }
            const elem = document.getElementById('img');
            elem.style.backgroundImage = 'url("' + cssImage + '")';
            let ready = document.getElementById('ready');
            if (!ready) {
              setTimeout(() => {
                ready = document.getElementById('ready');
                if (!ready) {
                  ready = document.createElement('div');
                  ready.id = 'ready';
                  document.body.appendChild(ready);
                }
              }, 200);
            }
          }
        }
        fetchImage(tokenURI);
      </script>
    </body>
</html>`;
  return new Response(page, {
    headers: { "content-type": "text/html" },
  });
}
