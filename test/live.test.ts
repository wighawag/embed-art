/**
 * Checks that hit a real Ethereum node. Opt-in, because they need network and
 * they assert on state that other people control:
 *
 *     TEST_LIVE=1 pnpm test
 *     TEST_LIVE=1 TEST_RPC=https://your-node pnpm test
 *
 * These exist because the uppercase-namespace bug in parseAvatarRecord was
 * invisible to offline tests: only a real record revealed it.
 */
import { parseAvatarRecord, resolveEns, resolveEnsAddress } from "../functions/_utils/ens";
import { erc1155IdHex, fetchBlockchainData, parseMetadata } from "../functions/_utils/metadata";
import { eq, report, section } from "./assert";

const env = {
  ETHEREUM_NODE: process.env.TEST_RPC || "https://ethereum-rpc.publicnode.com",
};

async function main() {
  section("ENS resolution against mainnet");

  const sassal = await resolveEns(env as any, "sassal.eth");
  const sassalRef = parseAvatarRecord(sassal.record);
  eq("sassal.eth has a resolver", !!sassal.resolver, true);
  eq("sassal.eth avatar is an NFT", sassalRef.kind, "nft");
  eq("sassal.eth is erc1155", (sassalRef as any).standard, "erc1155");

  const vitalik = await resolveEns(env as any, "vitalik.eth");
  eq("vitalik.eth has a resolver", !!vitalik.resolver, true);
  eq(
    "vitalik.eth avatar is a plain image, not an NFT",
    parseAvatarRecord(vitalik.record).kind,
    "image"
  );

  const missing = await resolveEns(
    env as any,
    "thisnamealmostcertainlydoesnotexist12345.eth"
  );
  eq("unregistered name has no resolver", missing.resolver, null);
  eq("unregistered name has no registry owner", missing.owner, null);
  eq("a registered name does have an owner", !!vitalik.owner, true);
  eq("unregistered name has no record", parseAvatarRecord(missing.record).kind, "none");

  section("resolveEnsAddress (the builder's contract field)");

  // The case the feature exists for: a collection named rather than spelled.
  // bleeps.eth points at the Bleeps ERC-721, which the front page also links.
  const bleeps = await resolveEnsAddress(env as any, "bleeps.eth");
  eq(
    "bleeps.eth is its NFT contract",
    (bleeps.address || "").toLowerCase(),
    "0x9d27527ada2cf29fbdab2973cfa243845a08bd3f"
  );

  const noSuchName = await resolveEnsAddress(
    env as any,
    "thisnamealmostcertainlydoesnotexist12345.eth"
  );
  eq("unregistered name resolves to nothing", noSuchName.address, null);
  eq("and is reported as unregistered, not unconfigured", noSuchName.owner, null);

  section("ERC-1155 token read (OpenSea shared storefront)");

  const contract = "0x495f947276749ce646f68ac8c248420045cb7b5e";
  const tokenID =
    "109791375735522898048150917964456965919994596086232976516654423066184641413121";
  const data = await fetchBlockchainData(env as any, "1", contract, tokenID, "erc1155");

  eq("contract name read", data.contractMetadata.name, "OpenSea Shared Storefront");
  eq("{id} was substituted", data.tokenURI.includes("{id}"), false);
  eq("uri contains the padded hex id", data.tokenURI.includes(erc1155IdHex(tokenID)), true);

  const metadata = await parseMetadata(data.tokenURI, erc1155IdHex(tokenID));
  eq("metadata has a name", typeof metadata.name === "string" && metadata.name.length > 0, true);
  eq("metadata has an image", typeof metadata.image === "string" && metadata.image.length > 0, true);

  report();
}

main().catch((err) => {
  console.error(`\n  live tests could not run: ${err.message.split("\n")[0]}\n`);
  process.exit(1);
});
