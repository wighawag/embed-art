<div align="center">
<a href="https://embed.art"><img alt="Embed.Art: Embed Your Art Anywhere." src="https://raw.githubusercontent.com/wighawag/embed-art/main/public/static/preview.png" width="640" /></a>
</div>

# Embed.Art

## Introduction

Platform like twitter and facebook use meta tags to display preview when sharing url.

The format these meta tags support are limited. In particular they do not support SVG, not do they support `ipfs://` urls.

The idea behind Embed.Art is to allow you to have an easy way to share your token on such platform without having to run your own preview generator.

## URLs it serves

| URL | What it does |
|-----|--------------|
| `/eip155:<chainID>/erc721:<contract>/<tokenID>` | an ERC-721 token |
| `/eip155:<chainID>/erc1155:<contract>/<tokenID>` | an ERC-1155 token |
| `/<name>.eth` | resolves the name's ENS avatar record and renders it |

The token path is deliberately identical to the NFT avatar format defined by
[ENSIP-12](https://docs.ens.domains/ensip/12) (via CAIP-22 and CAIP-29), so an
ENS `avatar` text record can be turned into a shareable page by prefixing the
origin, with nothing to translate.

`/<name>.eth` does that resolution for you and branches on what it finds:

- **an NFT avatar** goes through the normal token pipeline;
- **a plain image avatar** (`https`, `ipfs`, `data`) is displayed, with the page
  stating that it is not an NFT and nothing about it is verifiable onchain;
- **no avatar record**, or no resolver at all, gets a page explaining that and
  showing how to set one.

Known limits of the ENS path: `.eth` only, no ENSIP-10 wildcard/CCIP-read (so
offchain subnames report no resolver), ethers' nameprep rather than full
ENSIP-15 normalisation, and no ownership check (ENSIP-12 says clients SHOULD
verify the name's `addr` still owns the token; this one renders regardless).

## How it works ?

When you navigate to `https://embed.art/eip155:<chainID>/erc721:<contractAddress>/<tokenID>` Embed.art backend, running on cloudflare will

- fetch the tokenURI from the blockchain, along with the current block and contract metadata
- It currently caches it, and the plan is to let user refresh if needed.
- It then generate a preview if none already exist, it do so by calling [Cloudflare Browser Run](https://developers.cloudflare.com/browser-rendering/) via the **browser binding** (`env.BROWSER.quickAction("screenshot", ...)`).
  The self-contained screenshot page HTML is sent directly as `html` mode so the headless browser does not need to make any network request — all http/ipfs metadata and images are pre-fetched on the backend and embedded as data-URIs, ensuring the preview cannot fail.
  (It means the first request might timeout, especially for asset using IPFS with low quality pinning)
  (The preview is generated at 824x412, with a transparent background)
- That preview is then saved to R2
- It finally return html page that display the NFT, its title, description, image but also audio (if present). If an iframe is present, it replaces the image.

## Architecture

The project is a **Cloudflare Worker with Static Assets** (the modern replacement for Cloudflare Pages).

```
embed-art/
├── src/index.ts              # Worker entry point — routes all requests
├── functions/                # Handler & utility modules (imported by src/index.ts)
│   ├── _handlers/
│   │   ├── token.ts           # ERC-721 / ERC-1155 logic + screenshot generation
│   │   ├── ens.ts             # ENS avatar resolution and its three outcomes
│   │   ├── errorPage.ts       # Failure pages (blockchain/metadata/image/screenshot)
│   │   ├── pageWithRawData.ts # HTML page generator
│   │   └── screenshotWithAllData.ts # Screenshot page HTML generator
│   └── _utils/
│       ├── ens.ts             # namehash + registry/resolver reads, record parsing
│       ├── rpc.ts             # eth_call helper + endpoint selection
│       ├── base64.ts, metadata.ts, strings.ts, url.ts, request.ts
├── public/                   # Static assets (served by Workers Static Assets)
│   ├── index.html            # Landing page
│   └── static/               # Static images
├── assets/brand/             # Identity sources + build (see its own README)
├── wrangler.toml             # Configuration (bindings, assets, etc.)
```

## Setup

### wrangler.toml

The `wrangler.toml` is the source of truth for all configuration. It declares:

| Binding | Type | Purpose |
|---------|------|---------|
| `BROWSER` | Browser Run | Headless Chromium for screenshot generation (no API token needed) |
| `ASSETS` | Static Assets | Serves files from `public/` |
| `DATA_CACHE` | KV | Caches blockchain data (tokenURI, block, contract metadata) |
| `IMAGES` | R2 | Stores generated preview JPEGs |

The KV namespace ID and R2 bucket name are already filled in.

### Environment variables

| Variable | Purpose |
|----------|---------|
| `ETHEREUM_NODE` | Default Ethereum JSON-RPC endpoint (used for chainId 1) |
| `ETHEREUM_NODE_<chainID>` | Per-chain RPC endpoint, e.g. `ETHEREUM_NODE_5` for Goerli |

Set these in the Cloudflare dashboard (Settings → Environment variables) or
locally via a `.dev.vars` file (gitignored).

### Local development

```bash
pnpm install
pnpm dev   # wrangler dev --remote
```

> **Note:** The browser binding's `quickAction()` runs on Cloudflare's remote
> infrastructure, so `--remote` is required for local development. You need to
> be logged in to Cloudflare (`npx wrangler login`).

### Tests

```bash
pnpm test        # offline: record parsing, path parsing, {id} encoding
pnpm test:live   # also reads mainnet (ENS resolution + an ERC-1155 token)
```

The live suite is opt-in because it needs network and asserts on records other
people control. It earns its keep: the offline tests all passed while
`parseAvatarRecord` was still rejecting `sassal.eth`, whose avatar is registered
with an uppercase `ERC1155` namespace. Only a real record exposed that.
Override the node with `TEST_RPC=https://your-node pnpm test:live`.

### Deploy

```bash
pnpm deploy   # wrangler deploy
```

### Cost

Browser Run has a free tier of 10 browser-minutes/day (Workers Free plan) or
10 browser-hours/month included with the Workers Paid plan ($5/mo), then
$0.09/hour. Since previews are cached in R2 and only generated once per token,
usage is minimal.

## Future plan

- support hot reload so you can watch dyanmic NFT in the page
- test with more assets
- support old contracts (cryptopunks, autoglyphs, etc...)
- a stable direct-image route (`/image/<same path>`) so the generated preview
  can be used as someone else's `og:image` without scraping the page for it
- ENS: CCIP-read for offchain names, and optional ownership verification