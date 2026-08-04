type ErrorType = "blockchain" | "metadata" | "image" | "screenshot";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const ERROR_INFO: Record<
  ErrorType,
  { title: string; message: string; icon: string }
> = {
  blockchain: {
    title: "Blockchain Data Unavailable",
    message:
      "Could not fetch data from the blockchain. The Ethereum node may be down or not configured for this chain.",
    icon: `<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.72-1.71"/>
      <line x1="2" y1="2" x2="22" y2="22" stroke="#FF4444" stroke-width="2"/>
    </svg>`,
  },
  metadata: {
    title: "Metadata Unavailable",
    message:
      "This NFT's metadata could not be loaded. The metadata server may be down or the content may have been removed.",
    icon: `<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="9" y1="13" x2="15" y2="13" stroke="#FF4444"/>
      <line x1="2" y1="2" x2="22" y2="22" stroke="#FF4444" stroke-width="2"/>
    </svg>`,
  },
  image: {
    title: "Image Unavailable",
    message:
      "The NFT's image could not be loaded. The image server may be down or the image may have been removed.",
    icon: `<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <circle cx="9" cy="9" r="2"/>
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
      <line x1="2" y1="2" x2="22" y2="22" stroke="#FF4444" stroke-width="2"/>
    </svg>`,
  },
  screenshot: {
    title: "Preview Generation Failed",
    message:
      "The preview image could not be generated. This is usually a temporary issue — please try again later.",
    icon: `<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/>
      <circle cx="12" cy="13" r="3"/>
      <line x1="2" y1="2" x2="22" y2="22" stroke="#FF4444" stroke-width="2"/>
    </svg>`,
  },
};

export function errorPage(
  type: ErrorType,
  error: Error,
  context: {
    chainId?: string;
    contract?: string;
    tokenID?: string;
    tokenURI?: string;
  }
): Response {
  const info = ERROR_INFO[type];
  const escTitle = escapeHtml(info.title);
  const escMessage = escapeHtml(info.message);

  const details: string[] = [];
  if (context.chainId)
    details.push(`Chain: eip155:${escapeHtml(context.chainId)}`);
  if (context.contract)
    details.push(`Contract: ${escapeHtml(context.contract)}`);
  if (context.tokenID) details.push(`Token ID: ${escapeHtml(context.tokenID)}`);
  if (context.tokenURI)
    details.push(`Token URI: ${escapeHtml(context.tokenURI)}`);
  details.push(
    `Error: ${escapeHtml(error.message.split("\n")[0])}`
  );

  const page = `<!DOCTYPE html>
<html lang="en">
    <head>
        <title>${escTitle} - Embed.Art</title>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta name="title" content="${escTitle}">
        <meta name="description" content="${escMessage}">
        <meta property="og:type" content="website">
        <meta property="og:title" content="${escTitle}">
        <meta property="og:description" content="${escMessage}">
        <meta name="twitter:card" content="summary">
        <meta name="twitter:title" content="${escTitle}">
        <meta name="twitter:description" content="${escMessage}">
        <style>
          html {
            background-color: #111111;
            color: wheat;
          }
          * {
            margin: 0;
            padding: 0;
            font-family: Hack, monospace;
          }
          body {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            text-align: center;
          }
          .icon {
            width: 100px;
            height: 100px;
            margin-bottom: 1.5em;
            opacity: 0.4;
            color: wheat;
          }
          h1 {
            margin: 0.5em;
            font-size: 1.4em;
          }
          p {
            margin: 0.3em;
            opacity: 0.6;
            max-width: 500px;
            line-height: 1.6;
          }
          .details {
            margin-top: 2em;
            font-size: 0.8em;
            opacity: 0.4;
            word-break: break-all;
            text-align: left;
            max-width: 600px;
          }
          .details div {
            margin: 0.2em 0;
          }
        </style>
    </head>
    <body>
        ${info.icon}
        <h1>${escTitle}</h1>
        <p>${escMessage}</p>
        <div class="details">
            ${details.map((d) => `<div>${d}</div>`).join("\n            ")}
        </div>
    </body>
</html>`;

  return new Response(page, {
    headers: { "content-type": "text/html" },
  });
}