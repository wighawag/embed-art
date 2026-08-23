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
| `/eip155:<chainID>/erc721:<contract>/<tokenID>` | an ERC-721 token (add `?strict` for the standard and nothing else) |
| `/eip155:<chainID>/erc1155:<contract>/<tokenID>` | an ERC-1155 token |
| `/<name>.eth` | resolves the name's ENS avatar record and renders it |
| `/image/<token path>` | 302 to the generated preview JPEG |
| `/audio/<token path>` | the token's audio, if its `animation_url` is one |
| `/api/resolve/<name>.eth` | JSON: what that name's `addr` record points at |
| `/ipfs/<cid>`, `/ipns/<name>`, `/ar/<txid>` | content-addressed bytes, fetched server-side |
| `/unpinned` | a survey of how much sampled NFT art no gateway can still fetch |
| `/data/unpinned-survey.json` | that survey's raw dataset |

The preview's real URL embeds `sha256(tokenURI)`, which nothing outside the
worker can compute, so `/image/` exists to give it a stable, guessable address:
use it as your own `og:image`, or as a thumbnail, without scraping a page for
it. Both media routes fall back to the matching `static/error-*.png` rather
than failing, and set a cache lifetime so a dead metadata server is not
re-queried on every view.

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

An ENS page always shows the token's **canonical** address, and points
`rel=canonical`, `og:url` and `twitter:url` at it rather than at the name. The
name is a mutable pointer; the `eip155:` path is the permanent one. Direct
token pages get a canonical too, which normalises the legacy `/erc721/` and
`eip721:` aliases onto the modern form. The visible "permanent address" block
only appears when you did not already arrive by it.

A name with no avatar is reported precisely, because the cases differ: the
registry's `owner` distinguishes **not registered** from **registered but no
resolver**, which in turn differs from **resolver set, avatar empty**. Each
gets its own explanation and its own branded unfurl card, rather than
borrowing the front page's.

**Nothing keyed by an ENS name is cached.** The owner can repoint a record at
any moment and, unlike a token URI, there is no hash that would reveal the
change, so a cached mapping just serves yesterday's avatar. Resolution runs on
every request, and ENS-derived pages are returned `cache-control: no-store`.
Everything keyed by *content* is still cached normally: the token's own data,
and rendered images, which for a plain-image avatar are stored under
`avatar_<sha256(uri)>.jpg` with the name deliberately absent from the key.

Known limits of the ENS path: `.eth` only, no ENSIP-10 wildcard/CCIP-read (so
offchain subnames report no resolver), ethers' nameprep rather than full
ENSIP-15 normalisation, and no ownership check (ENSIP-12 says clients SHOULD
verify the name's `addr` still owns the token; this one renders regardless).

## The front page's URL builder

The builder (`public/static/builder.js`) is the only part a visitor drives by
hand, and it takes two liberties with what you type.

**The contract field accepts an ENS name.** Many collections are easier to name
than to spell: `bleeps.eth` *is* the Bleeps ERC-721. The name is resolved
through `/api/resolve/<name>.eth`, which reads the `addr` record server-side
because the node URL is a secret, and the **address** is what goes in the URL.
The name never does. A name is a mutable pointer, so a link built from one
would quietly come to mean a different token the day it is repointed. Until it
resolves the URL keeps its `<contract>` placeholder and the open button stays
disabled, rather than producing a link that looks finished and is not. A name
that fails says which way it failed: not registered, no resolver, or resolver
with no address. Nothing about the lookup is cached, for the reason ENS pages
are not either.

**The token id field accepts hex.** Explorers and calldata quote ids as
`0x119c`; the ENSIP-12 path is `(\d+)`. Typing hex converts it to decimal, and
the field says `0x119c → 4508` so the rewrite is visible rather than a surprise
in the URL bar. The conversion is done digit by digit, not through `Number`,
because token ids run well past 2^53.

**A known-collection list** fills chain, standard, contract and a sample id in
one pick. Two rules decide what is on it: the ids have to be small counting
numbers, and the entry has to have been checked **through this service**, its
sample id rendering a page rather than an error. That is why Mandalas is absent
despite being the front page's own example of onchain art: its ids are 40-digit
numbers derived from an address, and they do not exist until minted, so there
is nothing you could type.

Checking through the service rather than from a laptop is what found the next
bug: CrypToadz rendered here and 403'd there, because arweave.net refuses a
request with no `User-Agent` and the worker was sending none. Every outbound
fetch now identifies itself as `embed.art` (see `fetchAsService`), which is
both what fixed it and the courteous arrangement: a host that wants us to stop
can see who to ask.

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

### The token page is a gallery wall, not a debug view

The art gets the top of the fold and as much of the viewport's short side as it can take (`72vh`), because that is the only thing on the page anyone came for. Everything else is a label under it: the collection, the title, the description, the traits, and last a provenance block saying where the token permanently lives and where its document is kept (`onchain (data: URI)`, `content-addressed`, or the host that answers). HTML art is framed square, since token art overwhelmingly is and any other shape shows the artwork's own page background in the leftover band. An image is scaled to that frame instead of being left at its natural size, and a source small enough to be pixel art (≤256px) is drawn with `image-rendering: pixelated` so deliberate pixels do not turn to mush on the way up.

The page carries the site's letterhead, linking home, in the corner and again in the footer. For most people who ever see it, a shared token link *is* the front door, and a page with no way back is a dead end.

Audio does not loop. A piece of audio art has an end, and repeating it forever turns a composition into hold music with no way to stop it short of leaving.

Everything a contract writes, including its own `tokenURI`, is escaped on the way into the page: as markup in the document, and as a JS string literal in the injected script, where a stray backtick, `${` or `</script>` would otherwise let a token author run code on our origin.

### When a token does not exist

A metadata host may answer a missing token with `404` and a body that is still
valid JSON, as OpenSea's does. Parsing that as metadata yields a document with
no image, and the screenshot then waits the full 30 seconds for content that
will never appear, reporting "Preview Generation Failed" for what is really
"no such token". So the HTTP status is now checked, a 404 is reported as **No
Such Token**, and metadata carrying neither `image` nor `animation_url` is
rejected before the browser is involved at all.

Every failure state has a branded 1280x640 card under `public/static/`,
generated from `assets/brand/spec.py`, so a link that unfurls to an error still
unfurls as Embed.Art instead of borrowing the front page's card and implying
everything worked.

### Content-addressed content is served from here, http(s) is not

The token page fetches metadata in the **browser**, which is the point: what
you see comes from the token's own URI rather than from a copy we made. That
holds for `https://` URLs, and it must, because a metadata host that refuses
cross-origin reads is the project's own mistake and hiding it would be doing
nobody a favour.

A public IPFS gateway is a different thing entirely. It is not the token's
claim about anything: which gateway serves a CID is the client's business, and
ideally it would not be a gateway at all but a local p2p node. It also does not
answer a browser the way it answers a server. ipfs.io sits behind Cloudflare's
bot mitigation, and for the same URL at the same moment it answers this worker
`200` with `access-control-allow-origin: *` while answering a browser-shaped
request `403 cf-mitigated: challenge` with no CORS header at all. The trigger
is the **User-Agent**. A browser can only report that as a CORS failure.

That is how a BAYC page came to say "Could not fetch token's metadata" while
the server, having asked the same URL and been answered normally, told the page
CORS was `allowed`. The check was not wrong, it was about the wrong request:
CORS is a property of a (request, response) pair, not of a URL.

So `ipfs://`, `ipns://` and `ar://` are now read back through this origin, via
`/ipfs/`, `/ipns/` and `/ar/`, which fetch upstream **without forwarding the
visitor's headers** (passing the browser's User-Agent on would recreate the
very challenge the route exists to dodge) and return the bytes with an
immutable cache lifetime.

**A hardcoded gateway URL counts as content-addressed too.** A token that says
`https://ipfs.io/ipfs/<cid>`, or `https://gateway.pinata.cloud/ipfs/<cid>`, or
`https://<cid>.ipfs.dweb.link/1.json`, or `https://arweave.net/<txid>/1`, has
not chosen that gateway in any meaningful sense: it named a **CID** and wrote
down whichever courier was in the tutorial. The CID is the claim, the courier
is a detail, and picking the courier is the client's job. Those URLs are
recognised and served from here as well, in every form seen in the wild:
path (`<host>/ipfs/<cid>`), subdomain (`<cid>.ipfs.<host>`), and Arweave's
sandboxed `<base32>.arweave.net/<txid>`, which is what CloneX writes onchain.

The line is drawn at the CID itself: the thing in the gateway position has to
parse as a content address (v0 base58, v1 base32/base36, or a 43-character
Arweave txid), so `https://example.com/ipfs/readme.txt` is not mistaken for a
gateway and `https://api.opensea.io/...` stays exactly what it is.

We try our own gateways in order and, if the token named one itself, that one
**last**: ours first because the courier is ours to pick, theirs last because a
courier we cannot reach still beats no bytes at all. The page does the same,
falling back to the token's own URL if our path cannot produce the content.

### A hash is a promise about which bytes, not that anyone kept them

Content addressing removes the courier from the trust list. It does not remove
the need for somebody to keep the file, and when nobody does, every gateway
hunts for a provider and eventually gives up. Dirt Birds is the front page's
example: 10,000 profile pictures from 2022, still owned and still trading,
whose single metadata CID ipfs.io, dweb.link, w3s.link and nftstorage.link all
answer with `504` and Pinata with `404`.

It was found rather than remembered, by a survey that is now part of the repo
and published at **[/unpinned](https://embed.art/unpinned)**. See
[the survey](#the-unpinned-survey) below.

That case is also why every outbound fetch now has a **time budget**
(`fetchFirstAvailable`): 12 seconds for one source to answer, 25 seconds
overall. Gateways hold a request open while they search (ipfs.io for 28
seconds), so trying three of them in sequence turned unpinned content into a
minute of silence before the error page. The timer bounds *time to answer* and
is cleared the moment the headers arrive, so a large image still streams for as
long as it needs. A CID nobody pins is now reported as gone in 25 seconds
rather than eventually.

### Metadata that does not follow the standard

The page fetches and renders the way a browser does, deliberately, so what you
see comes from the token rather than from a copy we made. Some tokens cannot
survive that, not because the art is gone but because the document describing
it breaks the rules it claims to follow. Two real cases:

- **`the_coin` #36** returns `data:text/plain,` followed by JSON that was never
  percent-encoded. RFC 2397 requires it, and the payload contains `fill='#eee'`,
  so a browser treats everything from that `#` as a fragment and receives 791
  of 14,137 bytes. Its `image` is also the SVG document itself rather than a
  URI to one, which the ERC-721 schema defines as *"a URI pointing to a
  resource with mime type image/\*"*.

Neither is the owner's mistake to suffer, so the page repairs both as a
**courtesy**: a `data:` URI that fails the compliant read is parsed from the
string instead of fetched, and markup in a media field is wrapped into a data
URI so it can load at all. The token then renders, and gets a card to unfurl.

Every repair is named on the page, and **`?strict` withdraws all of them**, so
anyone judging a token can see exactly what a compliant client sees. That is
how both cases above were diagnosed.

The repairs live in `functions/_utils/clientCourtesy.ts` and are injected into
**both** page templates, because the preview is not rendered by the server: it
is this page, screenshotted. A repair that lived server-side would produce a
card the visitor's own browser could not reproduce.

### Collections that have no tokenURI at all

CryptoPunks predates ERC-721. Its contract has no `tokenURI` to call, so there
is no metadata document anywhere: the art is drawn by a separate onchain
renderer. `functions/_utils/adapters.ts` holds the whole list of collections
like that, and the rules that keep it from becoming a pile of special cases:

1. An adapter runs **only where the standard has nothing to offer**, and
   **never under `?strict`**. A token with a working `tokenURI` is never
   touched. Asked strictly, CryptoPunks reports what a compliant client finds,
   which is nothing, and says the courtesy exists.
2. Whatever an adapter produces is **disclosed on the page**: that the document
   was assembled here rather than returned by the token, why, and which
   contract and function the art was read from. A viewer should never have to
   work out where a picture came from.

Adding a collection is appending one entry to `ADAPTERS`; removing it is
deleting that entry. Nothing else in the service knows any collection by name,
and a test walks the list to check each entry justifies itself and declares its
source.

The CryptoPunks entry reads `punkImageSvg(uint16)` and `punkAttributes(uint16)`
from `0x16f5a356…`, the collection's own renderer. That renderer answers with
`data:image/svg+xml;utf8,<svg …>`, whose media type parameter is not one
RFC 2397 defines and whose markup is not percent-encoded, so the first `#` in a
fill colour would end the URL: the bytes are right and the envelope is not, so
the adapter rewrites the envelope.

### When reading the token costs more gas than a node will spend

`ETHEREUM_NODE` accepts a **comma-separated list**, tried in order. One node is
enough until a token is expensive to read: nodes cap the gas an `eth_call` may
burn, the caps differ, and a heavy onchain renderer lands on the wrong side of
one. Non-Fungible Moons builds a 1.36MB document in memory, which exhausts a
550,000,000 gas cap and returns fine from a node with a higher one.

When every node refuses, the reason is reported rather than buried: a gas cap
is recognised as such and the page says the token is fine and the *read* is
what was refused, naming the host that refused it.

### When the metadata server blocks the browser

The token page fetches the metadata **client-side**, deliberately, so what you
see is rendered from the token URI rather than from a server-side copy. That
breaks when a metadata host omits `Access-Control-Allow-Origin`, as OpenSea's
does: the browser refuses the read and cannot tell you why, because from
JavaScript a CORS rejection and a dead network look identical.

The backend can tell, because it fetches the same URL where CORS does not
apply, and reads the response headers. The page is therefore told the verdict
up front: when the header is missing it says so plainly, names the URL at
fault, shows the server-rendered preview instead of nothing, and points out
that the unfurled card is unaffected. No hedging in front of the visitor.

## The unpinned survey

`/unpinned` publishes a measurement rather than an opinion: how often does an
NFT's own content address fail to produce anything? Two scripts do the work,
and both are meant to be re-run by anyone.

```bash
pnpm survey          # sample the chain, test the gateways, write the dataset
pnpm survey:render   # turn that dataset into public/unpinned.html
```

| Stage | What it does |
|-------|--------------|
| Sample | Reads ERC-721 `Transfer` logs from blocks spread across the range, so the contracts come from real activity rather than from a curated list |
| Resolve | Calls `tokenURI` and keeps the content-addressed ones, using the **worker's own** `gatewayPath`, so a hardcoded gateway URL counts as the CID it contains |
| Verify | Asks five public gateways concurrently, twice, with a timeout, and counts a collection as unreachable only if every gateway failed every time |
| Enrich | Adds `name`, `symbol`, `totalSupply` and whether the sampled token is currently owned |

The window is arguments, so widening it is two numbers:

```bash
node tools/survey-unpinned.mjs --from 16200000 --to 21000000
node tools/survey-unpinned.mjs --help
```

Three things keep the result honest.

**The page is generated from the dataset** (`tools/render-unpinned.mjs`), so no
number on it can drift from the measurement it describes, and
`test/unpinned.test.ts` renders a fixture and checks the page really does read
its figures out of the data, escapes contract-supplied names, and keeps the
caveats.

**Unreachable is not the same as destroyed.** It means no gateway asked could
find a provider within the timeout. Somebody may hold the bytes offline, and
one node re-providing them revives every CID in the dataset instantly, with the
same hash and nothing changed onchain. The page says so, and says how.

**The sample has known limits**, also stated on the page: Ethereum mainnet
only; a collection with no transfers in the sampled blocks is invisible to it;
and only the *metadata* address is tested, so a collection whose metadata
resolves may still point at an image nobody keeps. It is a lower bound.

The raw dataset ships at `/data/unpinned-survey.json`, including every gateway
answer and the collections that did resolve, so the denominator can be checked
rather than taken on trust.

## Architecture

The project is a **Cloudflare Worker with Static Assets** (the modern replacement for Cloudflare Pages).

```
embed-art/
├── src/index.ts              # Worker entry point — routes all requests
├── functions/                # Handler & utility modules (imported by src/index.ts)
│   ├── _handlers/
│   │   ├── token.ts           # ERC-721 / ERC-1155 logic + screenshot generation
│   │   ├── ens.ts             # ENS avatar resolution and its three outcomes
│   │   ├── resolveApi.ts      # /api/resolve/<name>.eth, for the URL builder
│   │   ├── gateway.ts         # /ipfs/, /ipns/, /ar/ content-addressed proxy
│   │   ├── errorPage.ts       # Failure pages (blockchain/metadata/image/screenshot)
│   │   ├── pageWithRawData.ts # HTML page generator
│   │   └── screenshotWithAllData.ts # Screenshot page HTML generator
│   └── _utils/
│       ├── ens.ts             # namehash + registry/resolver reads, record parsing
│       ├── adapters.ts        # the whole list of collections with no tokenURI
│       ├── clientCourtesy.ts  # repairs for non-standard metadata, injected into both pages
│       ├── rpc.ts             # eth_call across endpoints + gas-cap detection
│       ├── base64.ts, metadata.ts, strings.ts, url.ts, request.ts
├── public/                   # Static assets (served by Workers Static Assets)
│   ├── index.html            # Landing page
│   ├── unpinned.html         # Generated: the survey (do not hand-edit)
│   ├── data/                 # The survey dataset, served for anyone to check
│   └── static/               # Static images + builder.js (the URL builder)
├── tools/
│   ├── survey-unpinned.mjs   # Samples the chain and tests the gateways
│   └── render-unpinned.mjs   # Renders the dataset into the page
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
| `ETHEREUM_NODE` | Default Ethereum JSON-RPC endpoint (used for chainId 1). Accepts a comma-separated list, tried in order, which is how a token too expensive for one node's gas cap still renders |
| `ETHEREUM_NODE_<chainID>` | Per-chain RPC endpoint, e.g. `ETHEREUM_NODE_5` for Goerli. Same list syntax |

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
pnpm test        # offline: record parsing, path parsing, {id} encoding,
                 #          the URL builder's hex/ENS/known-collection rules
pnpm test:live   # also reads mainnet (ENS resolution + an ERC-1155 token)
```

One trap worth knowing, since it cost a production bug: the token page embeds
`gatewayPath`'s **source** so there is a single implementation of "which URIs
this origin serves". Wrangler bundles with esbuild's keep-names on, which wraps
inner functions in a `__name()` helper, and that source shipped to a browser
with no `__name` in scope threw on first call, in production only, while the
test bundle (no keep-names) was perfectly happy. The page now defines the shim,
and `test/run.mjs` bundles with `keepNames: true` so the tests exercise the
shape the browser actually receives.

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
- try the gateways concurrently rather than one after another, so a cold CID is
  found as fast as the quickest gateway rather than as slow as the first one
- test with more assets
- support old contracts (cryptopunks, autoglyphs, etc...)
- ENS: CCIP-read for offchain names, and optional ownership verification
- check the home page's examples at request time instead of describing their
  health in hardcoded copy, since which ones are alive keeps changing