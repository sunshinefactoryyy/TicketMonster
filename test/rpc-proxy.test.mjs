import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { requestHandler } from "../scripts/serve.mjs";

async function request({
  method = "POST",
  contentType = "application/json",
  body = "{}",
  fetchRpc,
}) {
  const req = Readable.from([Buffer.from(body)]);
  Object.assign(req, {
    method,
    url: "/rpc",
    headers: { "content-type": contentType },
  });
  const response = {
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(value) {
      this.body = String(value);
    },
  };
  await requestHandler({ rpcUrl: "http://127.0.0.1:8545", fetchRpc })(
    req,
    response
  );
  return response;
}

test("same-origin RPC proxy preserves batched Ethereum requests and responses", async () => {
  const batch = [
    { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] },
    { jsonrpc: "2.0", id: 2, method: "eth_blockNumber", params: [] },
  ];
  const result = [
    { jsonrpc: "2.0", id: 1, result: "0x7a69" },
    { jsonrpc: "2.0", id: 2, result: "0x6" },
  ];
  const response = await request({
    body: JSON.stringify(batch),
    fetchRpc: async (url, options) => {
      assert.equal(url, "http://127.0.0.1:8545");
      assert.equal(options.method, "POST");
      assert.deepEqual(JSON.parse(String(options.body)), batch);
      return Response.json(result);
    },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), result);
  assert.equal(response.headers["Content-Type"], "application/json");
});

test("proxy refuses GET, simple-form submissions and oversized requests before forwarding", async () => {
  const fetchRpc = async () => {
    assert.fail("Request must not reach Anvil");
  };
  assert.equal((await request({ method: "GET", fetchRpc })).status, 405);
  assert.equal(
    (await request({ contentType: "text/plain", fetchRpc })).status,
    415
  );
  assert.equal(
    (await request({ body: "x".repeat(1024 * 1024 + 1), fetchRpc })).status,
    413
  );
});

test("proxy reports a stopped chain as 502 without serving stale success", async () => {
  const response = await request({
    fetchRpc: async () => {
      throw new Error("connection refused");
    },
  });
  assert.equal(response.status, 502);
  assert.deepEqual(JSON.parse(response.body), {
    error: "Local blockchain unavailable",
  });
});

test("proxy preserves JSON-RPC errors rather than converting them to success", async () => {
  const rpcError = {
    jsonrpc: "2.0",
    id: 1,
    error: { code: -32601, message: "Method not found" },
  };
  const response = await request({
    fetchRpc: async () => Response.json(rpcError),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), rpcError);
});
