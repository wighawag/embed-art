/**
 * The URL builder on the front page.
 *
 * Lives in its own file rather than inline so the parts that are pure string
 * work (token id normalisation, path assembly, the known-collection list) can
 * be exercised by `pnpm test` instead of only by looking at the page.
 * Everything below `wire()` touches the DOM; everything above it does not.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.EmbedArtBuilder = api;
  if (typeof document !== "undefined") api.wire(document);
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /**
   * Collections offered in the "known collection" list.
   *
   * Two rules decide what belongs here. The token id has to be a small
   * counting number, because the point is that you can type one and get a
   * token: that is why Mandalas is absent despite being onchain art, its ids
   * are 40-digit numbers derived from an address and only exist once minted.
   * And every entry was checked THROUGH THIS SERVICE, not from a laptop: the
   * sample id below renders a page rather than an error. That distinction is
   * not pedantic. Checked from a laptop, CrypToadz passed; checked through the
   * worker it returned 403, because arweave.net refuses an unidentified
   * request and the worker was not sending a User-Agent. The list was right
   * and the fetch was wrong, which only a check from here could tell apart.
   *
   * `token` is a sample, not a range. Where a collection starts at 0 rather
   * than 1 the sample says so.
   */
  var KNOWN = [
    {
      group: "metadata onchain",
      name: "Bleeps",
      note: "sound synthesised onchain",
      chain: "1",
      standard: "erc721",
      contract: "0x9d27527Ada2CF29fBDAB2973cfa243845a08Bd3F",
      token: "1",
    },
    {
      group: "metadata onchain",
      name: "Nouns",
      note: "one SVG noun per day",
      chain: "1",
      standard: "erc721",
      contract: "0x9C8fF314C9Bc7F6e59A9d9225Fb22946427eDC03",
      token: "1",
    },
    {
      group: "metadata onchain",
      name: "Loot",
      note: "bags of adventurer gear, as text",
      chain: "1",
      standard: "erc721",
      contract: "0xFF9C1b15B16263C61d017ee9F65C50e4AE0113D7",
      token: "1",
    },
    {
      group: "metadata onchain",
      name: "Checks",
      note: "VV checks, with an html animation",
      chain: "1",
      standard: "erc721",
      contract: "0x036721e5A769Cc48B3189EFbb9ccE4471E8A48B1",
      token: "1",
    },
    {
      group: "metadata onchain",
      name: "Terraforms",
      note: "Mathcastles, SVG plus html",
      chain: "1",
      standard: "erc721",
      contract: "0x4E1f41613c9084FdB9E34E11fAE9412427480e56",
      token: "1",
    },
    {
      group: "metadata onchain",
      name: "Zorbs",
      note: "gradient SVG, free to mint",
      chain: "1",
      standard: "erc721",
      contract: "0xCa21d4228cDCc68D4e23807E5e370C07577Dd152",
      token: "1",
    },
    {
      group: "metadata onchain",
      name: "Anonymice",
      note: "pixel mice, drawn onchain",
      chain: "1",
      standard: "erc721",
      contract: "0xbad6186E92002E312078b5a1dAfd5ddf63d3f731",
      token: "1",
    },
    {
      group: "metadata elsewhere",
      name: "Bored Ape Yacht Club",
      note: "metadata and art on IPFS",
      chain: "1",
      standard: "erc721",
      contract: "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D",
      token: "0",
    },
    {
      group: "metadata elsewhere",
      name: "CrypToadz",
      note: "metadata on Arweave",
      chain: "1",
      standard: "erc721",
      contract: "0x1CB1A5e65610AEFF2551A50f76a87a7d3fB649C6",
      token: "1",
    },
    {
      group: "metadata elsewhere",
      name: "Chain Runners",
      note: "metadata from chainrunners.xyz",
      chain: "1",
      standard: "erc721",
      contract: "0x97597002980134beA46250Aa0510C9B90d87A587",
      token: "1",
    },
  ];

  var ADDRESS = /^0x[0-9a-fA-F]{40}$/;
  var ENS_NAME = /^[^\s/?#]+\.eth$/i;
  var HEX_ID = /^0[xX][0-9a-fA-F]+$/;
  var DEC_ID = /^[0-9]+$/;

  function isAddress(value) {
    return ADDRESS.test(String(value || "").trim());
  }

  /** The lowercased name if this is something we can ask the resolver about. */
  function ensNameOf(value) {
    var trimmed = String(value || "").trim();
    return ENS_NAME.test(trimmed) ? trimmed.toLowerCase() : null;
  }

  /**
   * Hex to decimal by hand, digit by digit.
   *
   * Not parseInt and not BigInt: token ids run past 2^53 (an ENS name token id
   * is 78 digits), so Number would silently round, and BigInt would exclude
   * older browsers for a page whose whole job is producing a string.
   */
  function hexToDecimal(hex) {
    var digits = hex.replace(/^0x/i, "");
    var out = [0];
    for (var i = 0; i < digits.length; i++) {
      var carry = parseInt(digits[i], 16);
      for (var j = 0; j < out.length; j++) {
        var value = out[j] * 16 + carry;
        out[j] = value % 10;
        carry = Math.floor(value / 10);
      }
      while (carry > 0) {
        out.push(carry % 10);
        carry = Math.floor(carry / 10);
      }
    }
    return out.reverse().join("");
  }

  function stripLeadingZeros(decimal) {
    var trimmed = decimal.replace(/^0+/, "");
    return trimmed === "" ? "0" : trimmed;
  }

  /**
   * What the URL should carry for what was typed in the token id field.
   *
   * The path is decimal, always: `erc1155` ids are hashed into their URI as
   * padded hex, but the path itself is the ENSIP-12 shape, which is `(\d+)`.
   * Hex is accepted as input because that is how ids are usually quoted in a
   * block explorer, and pasting one should not mean converting it by hand.
   *
   * Returns { id, hex } on success, or { error } on anything else.
   */
  function normalizeTokenId(raw) {
    var value = String(raw == null ? "" : raw).trim();
    if (value === "") return { error: "empty" };
    if (HEX_ID.test(value)) {
      return { id: stripLeadingZeros(hexToDecimal(value)), hex: true };
    }
    if (DEC_ID.test(value)) {
      return { id: stripLeadingZeros(value), hex: false };
    }
    return { error: "not a number" };
  }

  /**
   * The path, with `<placeholders>` where a field is still missing. The caller
   * treats a path containing "<" as not ready to open, so an unresolved ENS
   * name must produce one rather than being pasted into the URL: the service
   * only ever routes on an address, and a name is a mutable pointer that would
   * make the link mean something else later.
   */
  function tokenPath(parts) {
    var chain = String(parts.chain || "").trim() || "1";
    var standard = parts.standard === "erc1155" ? "erc1155" : "erc721";
    var contract = isAddress(parts.contract)
      ? String(parts.contract).trim()
      : "<contract>";
    var token = normalizeTokenId(parts.token);
    return (
      "eip155:" +
      chain +
      "/" +
      standard +
      ":" +
      contract +
      "/" +
      (token.id || "<tokenId>")
    );
  }

  function ensPath(name) {
    var normalized = ensNameOf(name);
    return normalized || "<name>.eth";
  }

  function shorten(address) {
    return address.slice(0, 6) + "\u2026" + address.slice(-4);
  }

  /** The known entry matching a contract address, if there is one. */
  function findKnown(contract) {
    var wanted = String(contract || "").trim().toLowerCase();
    for (var i = 0; i < KNOWN.length; i++) {
      if (KNOWN[i].contract.toLowerCase() === wanted) return KNOWN[i];
    }
    return null;
  }

  // ------------------------------------------------------------------ DOM

  function wire(doc) {
    var origin =
      typeof location !== "undefined" &&
      location.origin &&
      location.origin.indexOf("http") === 0
        ? location.origin
        : "https://embed.art";

    var out = doc.getElementById("out");
    var open = doc.getElementById("open");
    var copy = doc.getElementById("copy");
    var fieldsToken = doc.getElementById("fields-token");
    var fieldsEns = doc.getElementById("fields-ens");
    var known = doc.getElementById("known");
    var contract = doc.getElementById("contract");
    var contractHint = doc.getElementById("contract-hint");
    var token = doc.getElementById("token");
    var tokenHint = doc.getElementById("token-hint");
    var note = doc.getElementById("builder-note");
    var modes = doc.querySelectorAll('input[name="mode"]');
    if (!out || !known || !contract) return;

    // name -> address | null (null meaning "asked, and it points nowhere").
    // Kept for the session only: a name is mutable, so a reload asks again.
    var resolved = {};
    var why = {};
    var pending = null;
    var timer = null;
    var sequence = 0;

    function fillKnownList() {
      var groups = {};
      for (var i = 0; i < KNOWN.length; i++) {
        var entry = KNOWN[i];
        var group = groups[entry.group];
        if (!group) {
          group = doc.createElement("optgroup");
          group.label = entry.group;
          groups[entry.group] = group;
          known.appendChild(group);
        }
        var option = doc.createElement("option");
        option.value = entry.contract;
        option.textContent = entry.name + " \u00B7 " + entry.note;
        group.appendChild(option);
      }
    }

    function mode() {
      for (var i = 0; i < modes.length; i++) {
        if (modes[i].checked) return modes[i].value;
      }
      return "token";
    }

    function value(id) {
      var element = doc.getElementById(id);
      return element ? element.value : "";
    }

    function hint(element, text, bad) {
      if (!element) return;
      element.textContent = text || "";
      element.className = bad ? "hint bad" : "hint";
    }

    /** The address to build with: what was typed, or what the name resolved to. */
    function contractAddress() {
      var typed = contract.value.trim();
      if (isAddress(typed)) return typed;
      var name = ensNameOf(typed);
      if (name && resolved[name]) return resolved[name];
      return "";
    }

    function describeContract() {
      var typed = contract.value.trim();
      if (typed === "") return hint(contractHint, "");
      if (isAddress(typed)) {
        var entry = findKnown(typed);
        return hint(contractHint, entry ? entry.name : "");
      }
      var name = ensNameOf(typed);
      if (!name) {
        return hint(contractHint, "expected 0x\u2026 or a name ending in .eth", true);
      }
      if (pending === name) return hint(contractHint, "resolving " + name + "\u2026");
      if (resolved[name]) {
        return hint(contractHint, name + " \u2192 " + shorten(resolved[name]));
      }
      if (name in resolved) {
        return hint(contractHint, why[name] || "no address for " + name, true);
      }
      return hint(contractHint, "");
    }

    function describeToken() {
      var typed = token ? token.value.trim() : "";
      if (typed === "") return hint(tokenHint, "");
      var normalized = normalizeTokenId(typed);
      if (normalized.error) {
        return hint(tokenHint, "expected a number, decimal or 0x hex", true);
      }
      // Show the conversion, because the URL is about to differ from what was
      // typed and a silent rewrite looks like a bug.
      return hint(tokenHint, normalized.hex ? typed + " \u2192 " + normalized.id : "");
    }

    function resolveName(name) {
      pending = name;
      var mine = ++sequence;
      describeContract();
      fetch("/api/resolve/" + encodeURIComponent(name))
        .then(function (response) {
          return response.json().then(function (body) {
            return { status: response.status, body: body };
          });
        })
        .then(function (result) {
          if (mine !== sequence) return; // a later keystroke won
          pending = null;
          var body = result.body || {};
          if (body.address) {
            resolved[name] = body.address;
          } else {
            resolved[name] = null;
            why[name] =
              body.error ||
              (body.reason === "not-registered"
                ? name + " is not registered"
                : body.reason === "no-resolver"
                ? name + " has no resolver"
                : name + " has no address record");
          }
          build();
        })
        .catch(function () {
          if (mine !== sequence) return;
          pending = null;
          resolved[name] = null;
          why[name] = "could not reach the resolver";
          build();
        });
    }

    function maybeResolve() {
      var name = ensNameOf(contract.value);
      if (!name || name in resolved || pending === name) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        resolveName(name);
      }, 350);
    }

    function build() {
      var path;
      if (mode() === "ens") {
        path = ensPath(value("ens") || "vitalik.eth");
      } else {
        path = tokenPath({
          chain: value("chain"),
          standard: value("standard"),
          contract: contractAddress(),
          token: value("token"),
        });
      }
      var url = origin + "/" + path;
      out.textContent = url;
      // Only offer to open a URL that is actually complete.
      var ready = url.indexOf("<") === -1;
      if (open) {
        open.href = ready ? url : "#";
        open.setAttribute("aria-disabled", ready ? "false" : "true");
        open.style.opacity = ready ? "1" : "0.4";
      }
      describeContract();
      describeToken();
      return url;
    }

    function selectKnown() {
      var entry = findKnown(known.value);
      if (!entry) return;
      doc.getElementById("chain").value = entry.chain;
      doc.getElementById("standard").value = entry.standard;
      contract.value = entry.contract;
      if (token) token.value = entry.token;
      build();
    }

    function syncKnownWithContract() {
      var entry = findKnown(contractAddress());
      known.value = entry ? entry.contract : "";
    }

    function switchMode() {
      var ens = mode() === "ens";
      fieldsEns.hidden = !ens;
      fieldsToken.hidden = ens;
      // The note describes the contract and token id fields, which are not on
      // screen in ENS mode. Left visible it reads as advice about the field
      // you are actually looking at, and its example makes a claim about
      // bleeps.eth that is only true of the contract field: the name resolves
      // to a contract, it has no avatar record at all.
      if (note) note.hidden = ens;
      build();
    }

    fillKnownList();

    doc.querySelector(".builder").addEventListener("input", function (event) {
      // A <select> fires `input` before `change`, and this handler would put
      // the list back to "custom" (the contract field still holds the old
      // value) before selectKnown ever reads what was picked. The list has its
      // own handler; leave it alone here.
      if (event.target === known) return;
      maybeResolve();
      build();
      syncKnownWithContract();
    });
    known.addEventListener("change", selectKnown);
    for (var i = 0; i < modes.length; i++) {
      modes[i].addEventListener("change", switchMode);
    }

    if (copy) {
      copy.addEventListener("click", function () {
        var url = build();
        var done = function () {
          copy.textContent = "copied";
          setTimeout(function () {
            copy.textContent = "copy";
          }, 1400);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(done, function () {});
        } else {
          var area = doc.createElement("textarea");
          area.value = url;
          doc.body.appendChild(area);
          area.select();
          try {
            doc.execCommand("copy");
            done();
          } catch (err) {
            /* nothing sensible to do: the URL is on screen to select */
          }
          doc.body.removeChild(area);
        }
      });
    }

    build();
  }

  return {
    KNOWN: KNOWN,
    ensNameOf: ensNameOf,
    ensPath: ensPath,
    findKnown: findKnown,
    hexToDecimal: hexToDecimal,
    isAddress: isAddress,
    normalizeTokenId: normalizeTokenId,
    tokenPath: tokenPath,
    wire: wire,
  };
});
