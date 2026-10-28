import { readFileSync, writeFileSync } from "node:fs";
import { runForge } from "./forge.mjs";
runForge(["build"]);
const artifact = JSON.parse(
  readFileSync("out/TicketMonster.sol/TicketMonster.json")
);
writeFileSync(
  "web/contract.json",
  JSON.stringify({ abi: artifact.abi, bytecode: artifact.bytecode.object })
);
console.log("Contract compiled; browser ABI generated.");
