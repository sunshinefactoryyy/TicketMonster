import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { createConnection } from "node:net";
import { JsonRpcProvider, ContractFactory, parseEther } from "ethers";
import { serve } from "./serve.mjs";
import "./build.mjs";

const port = Number(process.env.RPC_PORT || 8545);
const rpcUrl = `http://127.0.0.1:${port}`;
// Refuse to attach to an existing chain or overwrite a different demo's config.
async function requireFreePort(value) {
  if (!Number.isInteger(value) || value < 1024 || value > 65535)
    throw new Error("Choose a port between 1024 and 65535.");
  await new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port: value });
    socket.once("connect", () => {
      socket.destroy();
      reject(
        new Error(
          `Port ${value} is already in use. Choose another PORT/RPC_PORT.`
        )
      );
    });
    socket.once("error", (error) =>
      error.code === "ECONNREFUSED" ? resolve() : reject(error)
    );
    socket.setTimeout(1500, () => {
      socket.destroy();
      reject(new Error(`Timed out checking port ${value}.`));
    });
  });
}
await requireFreePort(port);
await requireFreePort(Number(process.env.PORT || 4173));
const anvil =
  process.env.ANVIL ||
  (existsSync(`${homedir()}/.foundry/bin/anvil`)
    ? `${homedir()}/.foundry/bin/anvil`
    : "anvil");
const chain = spawn(
  anvil,
  [
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--chain-id",
    "31337",
    "--silent",
  ],
  { stdio: ["ignore", "pipe", "pipe"] }
);
chain.stderr.on("data", (x) => process.stderr.write(x));
let stopped = false;
let server;
function stop() {
  stopped = true;
  server?.close();
  chain.kill();
}
process.on("SIGINT", () => {
  stop();
  process.exit(0);
});
process.on("SIGTERM", () => {
  stop();
  process.exit(0);
});
chain.on("error", (e) => {
  console.error(e.message);
  process.exit(1);
});
chain.on("exit", (code) => {
  if (!stopped) {
    console.error(
      "Anvil stopped. Choose an unused RPC_PORT if port 8545 is busy."
    );
    server?.close();
    process.exit(code || 1);
  }
});
const provider = new JsonRpcProvider(rpcUrl, 31337, { cacheTimeout: -1 });
try {
  for (let i = 0; ; i++) {
    try {
      await provider.send("eth_chainId", []);
      break;
    } catch (e) {
      if (i === 40) throw e;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const organiser = await provider.getSigner(0);
  const artifact = JSON.parse(readFileSync("web/contract.json"));
  const contract = await new ContractFactory(
    artifact.abi,
    artifact.bytecode,
    organiser
  ).deploy();
  await contract.waitForDeployment();
  const now = (await provider.getBlock("latest")).timestamp;
  await (
    await contract.createEvent("Night at the Esplanade", now + 3600, now + 7200)
  ).wait();
  await (
    await contract.createTickets(
      1,
      "Stalls",
      24,
      parseEther("0.01"),
      parseEther("0.002")
    )
  ).wait();
  await (
    await contract.createTickets(
      1,
      "Circle",
      12,
      parseEther("0.006"),
      parseEther("0.001")
    )
  ).wait();
  await (
    await contract.createEvent("Neon Garden", now + 5400, now + 9000)
  ).wait();
  await (
    await contract.createTickets(
      2,
      "General admission",
      6,
      parseEther("0.008"),
      parseEther("0.002")
    )
  ).wait();
  const accounts = await provider.send("eth_accounts", []);
  writeFileSync(
    "web/deployment.json",
    JSON.stringify(
      {
        address: await contract.getAddress(),
        chainId: 31337,
        // The browser reaches Anvil through the app's same-origin proxy. This
        // works with any Docker host port while Anvil stays on loopback.
        rpcUrl: "/rpc",
        deploymentBlock: 0,
        demo: true,
        accounts: accounts.slice(0, 5),
      },
      null,
      2
    )
  );
  server = serve(undefined, { rpcUrl });
  server.on("error", (error) => {
    console.error(error);
    stop();
    process.exit(1);
  });
  console.log(
    "Local demo only: funded Anvil accounts, real contract transactions, no real ETH. Ctrl+C stops both servers."
  );
} catch (e) {
  console.error(e);
  stop();
  process.exit(1);
}
