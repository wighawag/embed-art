# Embed.Art

## Introduction

Platform like twitter and facebook use meta tags to display preview when sharing url.

The format these meta tags support are limited. In particular they do not support SVG, not do they support `ipfs://` urls.

The idea behind Embed.Art is to allow you to have an easy way to share your token on such platform without having to run your own preview generator.

## How it works ?

When you navigate to `https://embed.art/eip155:<chainID>/erc721:<contractAddress>/<tokenID>` Embed.art backend, running on cloudflare (For now) will

- fetch the tokenURI from the blockchain, along with the current block and contract metadata
- It currently caches it, and the plan is to let user refresh if needed.
- It then generate a preview if none already exist, it do so currently by calling an external service which use headless chrome.
  (The preview is generated without chrome needed to make any network request, this is to ensure the preview cannot fails)
  (The preview is actually a html page that contains the image, this allow the preview to control the format, currently 824x412 without browser dictating background color, etc...)
- That preview is then saved
- It finally return html page that display the NFT, its title, description, image but also audio (if present). If an iframe is present, it replaces the image.

## Future plan

- support hot reload so you can watch dyanmic NFT in the page
- test with more assets
- support old contracts (cryptopunks, autoglyphs, etc...)
