import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const OpReturnParserModule = buildModule("OpReturnParserModule", (m) => {
  const parser = m.contract("OpReturnParser");
  return { parser };
});

export default OpReturnParserModule;
