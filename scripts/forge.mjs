import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
export const forge =
  process.env.FORGE ||
  (existsSync(`${homedir()}/.foundry/bin/forge`)
    ? `${homedir()}/.foundry/bin/forge`
    : "forge");
export function runForge(args) {
  if (process.env.SOLC) args.push("--use", process.env.SOLC);
  const r = spawnSync(forge, args, { stdio: "inherit" });
  if (r.error) throw r.error;
  if (r.status) process.exit(r.status);
}
if (process.argv[1]?.endsWith("/forge.mjs")) runForge(process.argv.slice(2));
