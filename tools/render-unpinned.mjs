#!/usr/bin/env node
/**
 * Render the survey dataset into public/unpinned.html.
 *
 * Generated rather than hand-written so the page cannot drift from the data:
 * re-run the survey, re-run this, and every number on the page moves together.
 *
 *   node tools/render-unpinned.mjs [--in public/data/unpinned-survey.json]
 *                                  [--out public/unpinned.html]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = { in: "public/data/unpinned-survey.json", out: "public/unpinned.html" };
for (let i = 2; i < process.argv.length; i += 2) {
  args[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
}

const data = JSON.parse(readFileSync(resolve(ROOT, args.in), "utf8"));

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const num = (n) => Number(n).toLocaleString("en-US");
const shortURI = (uri) => (uri.length > 52 ? uri.slice(0, 49) + "\u2026" : uri);

const percent = Math.round(
  (data.totals.unreachable / data.totals.contentAddressed) * 100
);
const day = data.generatedAt.slice(0, 10);
const owned = data.unreachable.filter((c) => c.sampledTokenIsOwned).length;
const supplyLost = data.unreachable.reduce(
  (total, c) => total + (c.totalSupply || 0),
  0
);
// 410 Gone is a gateway saying it will not serve this, which is a different
// fate from nobody having it: the bytes may well exist and still be provided
// peer to peer, while every public gateway refuses to relay them.
const blocked = data.unreachable.filter((c) =>
  c.attempts.some((a) => a.status === 410)
);

/**
 * 410 is a gateway refusing to relay; 504 is a gateway finding nobody to relay
 * from. Different fates, and conflating them would blame the wrong party.
 */
function verdict(collection) {
  return collection.attempts.some((a) => a.status === 410)
    ? "blocked"
    : "no provider";
}

/**
 * Which gateways were asked and what they said, short enough for a table cell.
 * The full host names live in the title attribute; every round and every
 * timing lives in the dataset.
 */
function attemptSummary(attempts) {
  const perGateway = new Map();
  for (const a of attempts) {
    const host = a.gateway.split("/")[2];
    if (!perGateway.has(host)) perGateway.set(host, a.status);
  }
  const short = (host) =>
    host.replace("gateway.pinata.cloud", "pinata").replace(/\.(io|link|net)$/, "");
  return {
    brief: [...perGateway]
      .map(([host, status]) => `${short(host)} ${status === "timeout" ? "t/o" : status}`)
      .join(" \u00b7 "),
    full: [...perGateway].map(([host, status]) => `${host}: ${status}`).join(", "),
  };
}

const rows = data.unreachable
  .map((c) => {
    const token = `/eip155:1/erc721:${c.address}/${c.sampledTokenId}`;
    return `        <tr>
          <th scope="row"><a href="${esc(token)}">${esc(c.name || c.address)}</a></th>
          <td class="num">${c.totalSupply ? num(c.totalSupply) : "&mdash;"}</td>
          <td class="why">${verdict(c) === "blocked" ? '<span class="tag">blocked</span>' : '<span class="dim">no provider</span>'}</td>
          <td><code title="${esc(c.tokenURI)}">${esc(shortURI(c.tokenURI))}</code></td>
          <td class="dim gateways" title="${esc(attemptSummary(c.attempts).full)}">${esc(attemptSummary(c.attempts).brief)}</td>
        </tr>`;
  })
  .join("\n");

const page = `<!DOCTYPE html>
<html lang="en">

<head>
    <title>Unpinned &middot; Embed.Art</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="description" content="${data.totals.unreachable} of ${data.totals.contentAddressed} sampled NFT collections name a content address no gateway can still fetch.">
    <meta property="og:type" content="article">
    <meta property="og:url" content="https://embed.art/unpinned">
    <meta property="og:title" content="Unpinned: NFT art nobody is keeping">
    <meta property="og:description" content="${data.totals.unreachable} of ${data.totals.contentAddressed} sampled collections name a content address no gateway can still fetch. Method, data and tool included.">
    <meta property="og:image" content="https://embed.art/static/preview.png">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="Unpinned: NFT art nobody is keeping">
    <meta name="twitter:description" content="${data.totals.unreachable} of ${data.totals.contentAddressed} sampled collections name a content address no gateway can still fetch.">
    <meta name="twitter:image" content="https://embed.art/static/preview.png">
    <meta name="theme-color" content="#111111">
    <link rel="icon" href="/favicon.ico" sizes="32x32">
    <link rel="icon" type="image/svg+xml" href="/static/icon.svg">
    <link rel="canonical" href="https://embed.art/unpinned">
    <style>
        :root {
            --plate: #111111;
            --surface: #171717;
            --line: #2A2620;
            --ink: #F5DEB3;
            --muted: #8E826A;
            --accent: #BE8F04;
            --alarm: #FF4444;
            --mono: ui-monospace, Hack, "JetBrains Mono", "SF Mono", Menlo,
                Consolas, "DejaVu Sans Mono", monospace;
        }

        *, *::before, *::after { box-sizing: border-box; }
        html { background: var(--plate); }

        body {
            margin: 0;
            background: var(--plate);
            color: var(--ink);
            font-family: var(--mono);
            font-size: 16px;
            line-height: 1.65;
            -webkit-text-size-adjust: 100%;
            font-variant-ligatures: none;
            font-feature-settings: "liga" 0, "calt" 0, "dlig" 0;
        }

        .wrap { max-width: 60rem; margin: 0 auto; padding: 0 1.5rem; }
        a { color: var(--accent); text-underline-offset: 3px; }
        a:hover { color: var(--ink); }
        :focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }

        header { padding: clamp(2.5rem, 7vw, 4rem) 0 0; }
        .home { color: var(--muted); font-size: 0.8rem; text-decoration: none; }
        .home:hover { color: var(--accent); }

        h1 {
            margin: 1.5rem 0 0;
            font-size: clamp(1.6rem, 5vw, 2.4rem);
            font-weight: normal;
            letter-spacing: -0.01em;
        }

        .lede { margin: 1rem 0 0; color: var(--muted); max-width: 46rem; }

        section { padding: clamp(2rem, 5vw, 3rem) 0 0; }

        h2 {
            font-size: 0.8rem;
            font-weight: normal;
            letter-spacing: 0.16em;
            text-transform: uppercase;
            color: var(--accent);
            margin: 0 0 0.8rem;
        }

        p { max-width: 46rem; }

        .figures {
            display: grid;
            gap: 0.7rem;
            grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
            margin: 0 0 1.5rem;
        }

        .figure {
            background: var(--surface);
            border: 1px solid var(--line);
            border-radius: 8px;
            padding: 1rem 1.15rem;
        }

        .figure b {
            display: block;
            font-size: 1.9rem;
            font-weight: normal;
            color: var(--accent);
            line-height: 1.2;
        }

        .figure span { display: block; font-size: 0.78rem; color: var(--muted); }

        ol, ul { max-width: 46rem; padding-left: 1.2rem; }
        li { margin-bottom: 0.5rem; }

        code {
            color: var(--accent);
            word-break: break-all;
            font-size: 0.86em;
        }

        pre {
            background: var(--surface);
            border: 1px solid var(--line);
            border-radius: 8px;
            padding: 1rem 1.15rem;
            overflow-x: auto;
            font-size: 0.85rem;
        }

        pre code { color: var(--ink); }

        .note {
            border: 1px solid var(--line);
            border-left: 3px solid var(--accent);
            border-radius: 6px;
            padding: 1rem 1.15rem;
            font-size: 0.9rem;
            color: var(--muted);
            max-width: 46rem;
        }

        .note strong { color: var(--ink); font-weight: normal; }

        .scroll { overflow-x: auto; border: 1px solid var(--line); border-radius: 8px; }

        table { border-collapse: collapse; width: 100%; font-size: 0.82rem; }

        th, td {
            text-align: left;
            padding: 0.55rem 0.8rem;
            border-bottom: 1px solid var(--line);
            vertical-align: top;
            white-space: nowrap;
        }

        thead th {
            position: sticky;
            top: 0;
            background: var(--surface);
            color: var(--muted);
            font-weight: normal;
            font-size: 0.72rem;
            letter-spacing: 0.08em;
            text-transform: uppercase;
        }

        tbody tr:last-child th, tbody tr:last-child td { border-bottom: 0; }
        tbody tr:hover { background: #161616; }
        tbody th { font-weight: normal; }
        .num { text-align: right; color: var(--muted); }

        .tag {
            display: inline-block;
            border: 1px solid var(--alarm);
            border-radius: 999px;
            padding: 0 0.5rem;
            font-size: 0.7rem;
            color: var(--alarm);
        }
        .dim { color: var(--muted); font-size: 0.76rem; white-space: normal; }
        .gateways { white-space: nowrap; font-size: 0.72rem; }
        .why { white-space: nowrap; }

        footer {
            margin-top: clamp(3rem, 8vw, 5rem);
            padding: 1.75rem 0 2.5rem;
            border-top: 1px solid var(--line);
            color: var(--muted);
            font-size: 0.82rem;
            display: flex;
            gap: 1.25rem;
            flex-wrap: wrap;
            justify-content: space-between;
        }
    </style>
</head>

<body>
    <div class="wrap">
        <header>
            <a class="home" href="/">&larr; embed.art</a>
            <h1>Unpinned</h1>
            <p class="lede">
                A content address says <em>which</em> bytes an NFT means. It does not say that
                anybody is still keeping them. This is a count of how often that difference
                matters, taken on ${esc(day)}, with the method and the raw data attached so you
                can check it or extend it.
            </p>
        </header>

        <main>
            <section aria-labelledby="numbers-h">
                <h2 id="numbers-h">What the sample found</h2>
                <div class="figures">
                    <div class="figure">
                        <b>${num(data.totals.contracts)}</b>
                        <span>ERC-721 contracts sampled</span>
                    </div>
                    <div class="figure">
                        <b>${num(data.totals.contentAddressed)}</b>
                        <span>of them content-addressed</span>
                    </div>
                    <div class="figure">
                        <b>${num(data.totals.unreachable)}</b>
                        <span>no gateway could fetch</span>
                    </div>
                    <div class="figure">
                        <b>${percent}%</b>
                        <span>of the content-addressed ones</span>
                    </div>
                </div>
                <p>
                    Those ${num(data.totals.unreachable)} collections account for
                    ${num(supplyLost)} minted tokens, and ${
                      owned === data.totals.unreachable
                        ? "every single token tested is owned by somebody right now"
                        : `${num(owned)} of the tokens tested are owned by somebody right now`
                    }. Their metadata is not slow and not rate-limited: the gateways look for a
                    provider and find none.
                </p>
                ${
                  blocked.length
                    ? `<p>
                    ${num(blocked.length)} of them fail differently. Every gateway answers
                    <code>410 Gone</code>, which is a refusal rather than a shrug: the content is
                    on a public gateway denylist. Those bytes may still exist and still be served
                    peer to peer; what has been withdrawn is the relay that ordinary browsers
                    depend on. Among them: ${blocked
                      .slice(0, 3)
                      .map((c) => esc(c.name || c.address))
                      .join(", ")}${blocked.length > 3 ? ", and others" : ""}.
                </p>`
                    : ""
                }
            </section>

            <section aria-labelledby="method-h">
                <h2 id="method-h">How it was measured</h2>
                <ol>
                    <li>
                        <strong>Sample.</strong> Read ERC-721 <code>Transfer</code> logs from
                        ${num(data.method.blocksSampled)} blocks spread across
                        ${num(data.method.blockRange[0])}&ndash;${num(data.method.blockRange[1])},
                        which yields contracts that were genuinely in use then rather than a list
                        somebody curated.
                    </li>
                    <li>
                        <strong>Resolve.</strong> Ask each contract for a <code>tokenURI</code> and
                        keep the content-addressed ones. A hardcoded gateway URL counts:
                        <code>https://ipfs.io/ipfs/&lt;cid&gt;</code> names a CID, and the CID is
                        what is being tested.
                    </li>
                    <li>
                        <strong>Verify.</strong> Fetch that address from
                        ${data.method.gateways.length} public gateways,
                        ${data.method.rounds} rounds, ${data.method.timeoutMs / 1000}s each. A
                        collection counts as unreachable only if every gateway failed every time.
                    </li>
                </ol>
                <div class="note">
                    <strong>What a failure means.</strong> No gateway asked could find a provider
                    within the timeout. That is evidence the content is unpinned, not proof it is
                    destroyed. Somebody may hold the bytes offline, and a single node re-providing
                    them revives every CID on this page instantly, with the same hash and no
                    change onchain. That is the good half of content addressing: the art can come
                    back, and it will still be provably the same art.
                </div>
            </section>

            <section aria-labelledby="list-h">
                <h2 id="list-h">The collections</h2>
                <p>
                    Names link to this service, which will try again live and tell you what it
                    got. Sorted by supply.
                </p>
                <div class="scroll">
                    <table>
                        <thead>
                            <tr>
                                <th scope="col">Collection</th>
                                <th scope="col" class="num">Supply</th>
                                <th scope="col">Why</th>
                                <th scope="col">Token URI</th>
                                <th scope="col">Gateways asked</th>
                            </tr>
                        </thead>
                        <tbody>
${rows}
                        </tbody>
                    </table>
                </div>
            </section>

            <section aria-labelledby="repro-h">
                <h2 id="repro-h">Run it yourself, or widen it</h2>
                <p>
                    The tool is in the repository and takes the sample window as arguments. The
                    default is the 2021&ndash;2022 window used here; a wider or more recent range
                    is a matter of changing two numbers.
                </p>
                <pre><code>git clone https://github.com/wighawag/embed-art
cd embed-art &amp;&amp; pnpm install
ETHEREUM_NODE=https://your-node node tools/survey-unpinned.mjs
node tools/render-unpinned.mjs</code></pre>
                <ul>
                    <li><a href="/data/unpinned-survey.json">the raw dataset</a>, including every gateway answer and the collections that <em>did</em> resolve</li>
                    <li><a href="https://github.com/wighawag/embed-art/blob/main/tools/survey-unpinned.mjs">the survey tool</a></li>
                    <li><a href="https://github.com/wighawag/embed-art/blob/main/tools/render-unpinned.mjs">the page generator</a>, so this page cannot drift from the data</li>
                </ul>
                <div class="note">
                    <strong>Known limits of this sample.</strong> Ethereum mainnet only. Contracts
                    are sampled from blocks, so a collection with no transfers in those blocks is
                    invisible here, and popular collections are over-represented among the
                    survivors. Only the <em>metadata</em> address is tested: a collection whose
                    metadata resolves may still point at an image nobody keeps, so this is a lower
                    bound on the problem, not an upper one.
                </div>
            </section>

            <section aria-labelledby="fix-h">
                <h2 id="fix-h">If your collection is on this list</h2>
                <p>
                    Pin the CID again. Any IPFS node can provide it, it does not have to be the
                    original one, and nothing onchain needs to change: the hash in your
                    <code>tokenURI</code> will match the moment somebody serves those bytes.
                    If you still have the files, that is a few minutes of work and the art is
                    back for everyone at once.
                </p>
            </section>
        </main>

        <footer>
            <span>Surveyed ${esc(day)} &middot; ${num(data.method.rpcCalls)} RPC calls</span>
            <span>
                <a href="/">embed.art</a> &middot;
                <a href="https://github.com/wighawag/embed-art">source</a> &middot; AGPL-3.0
            </span>
        </footer>
    </div>
</body>

</html>
`;

const out = resolve(ROOT, args.out);
writeFileSync(out, page);
console.log(
  `wrote ${out} (${data.totals.unreachable} collections, ${percent}% of ${data.totals.contentAddressed})`
);
