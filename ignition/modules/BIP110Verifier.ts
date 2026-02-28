import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const LIGHT_CLIENT_ADDR = "0x3100000000000000000000000000000000000001";
const PARSER_ADDR = "0x5BB078C8aC361be88A27195307138A678562D281";

const BIP110VerifierModule = buildModule("BIP110VerifierModule", (m) => {
  const hashlockHash = m.getParameter("hashlockHash");
  const preimage = m.getParameter("preimage");

  const verifier = m.contract("BIP110Verifier", [
    LIGHT_CLIENT_ADDR,
    PARSER_ADDR,
    hashlockHash,
    preimage,
  ]);

  return { verifier };
});

export default BIP110VerifierModule;
