import { test } from "node:test";
import assert from "node:assert/strict";
import { Wallet, verifyMessage } from "ethers";
import {
  seatPosition,
  groupSeats,
  phase,
  admissionMessage,
  validateChallenge,
} from "../web/domain.js";

test("snake seating keeps row-boundary seats directly behind one another", () => {
  assert.deepEqual(seatPosition(7), { row: 1, column: 8 });
  assert.deepEqual(seatPosition(8), { row: 2, column: 8 });
  assert.deepEqual(seatPosition(15), { row: 2, column: 1 });
  assert.deepEqual(seatPosition(16), { row: 3, column: 1 });
});
test("ownership groups preserve gaps and cap each transaction at ten seats", () => {
  assert.deepEqual(groupSeats([4, 1, 0, 3, 12]), [
    { firstSeat: 0, qty: 2 },
    { firstSeat: 3, qty: 2 },
    { firstSeat: 12, qty: 1 },
  ]);
  assert.deepEqual(groupSeats(Array.from({ length: 23 }, (_, i) => i)), [
    { firstSeat: 0, qty: 10 },
    { firstSeat: 10, qty: 10 },
    { firstSeat: 20, qty: 3 },
  ]);
});
test("sales and check-in boundary rules match the contract", () => {
  const e = { salesEnd: 100n, checkInEnd: 200n, cancelled: false };
  assert.equal(phase(e, 99), "On sale");
  assert.equal(phase(e, 100), "Doors open");
  assert.equal(phase(e, 200), "Ended");
  assert.equal(phase({ ...e, cancelled: true }, 99), "Cancelled");
});
test("admission signature binds holder, gate, chain, contract, seat range and expiry", async () => {
  const holder = Wallet.createRandom(),
    gate = Wallet.createRandom();
  const d = { chainId: 31337, address: Wallet.createRandom().address };
  const c = {
    chainId: d.chainId,
    contract: d.address,
    gate: gate.address,
    holder: holder.address,
    categoryId: 1,
    firstSeat: 0,
    qty: 2,
    expires: 1200,
    nonce: "ab".repeat(32),
  };
  validateChallenge(c, d, 1000);
  const signature = await holder.signMessage(admissionMessage(c));
  assert.equal(verifyMessage(admissionMessage(c), signature), holder.address);
  for (const change of [
    { qty: 3 },
    { firstSeat: 1 },
    { chainId: 1 },
    { contract: gate.address },
    { gate: holder.address },
    { expires: 1199 },
    { nonce: "cd".repeat(32) },
  ])
    assert.notEqual(
      verifyMessage(admissionMessage({ ...c, ...change }), signature),
      holder.address
    );
  assert.throws(() => validateChallenge(c, d, 1200), /expired/);
  assert.throws(
    () => validateChallenge({ ...c, chainId: 1 }, d, 1000),
    /different chain/
  );
  assert.throws(
    () => validateChallenge({ ...c, qty: 0 }, d, 1000),
    /seat range/
  );
  assert.throws(
    () => validateChallenge({ ...c, expires: 1400 }, d, 1000),
    /five minutes/
  );
});
