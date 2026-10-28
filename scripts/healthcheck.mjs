// Checks readiness through the same published HTTP endpoint used by browsers.
const base =
  process.env.DEMO_URL || `http://127.0.0.1:${process.env.PORT || 4173}`;
async function json(path, options = {}) {
  const response = await fetch(new URL(path, base), {
    ...options,
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${path}`);
  return response.json();
}
try {
  const deployment = await json("/deployment.json");
  const result = await json(deployment.rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getCode",
      params: [deployment.address, "latest"],
    }),
  });
  if (!result.result || result.result === "0x")
    throw new Error("Contract not deployed");
  console.log("TicketMonster app and blockchain are ready.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
