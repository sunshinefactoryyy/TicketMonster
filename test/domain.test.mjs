import { test } from "node:test";
import assert from "node:assert/strict";
import { Wallet, verifyMessage } from "ethers";
import {
  seatPosition,
  groupSeats,
  phase,
  admissionMessage,
  readProof,
  validatePass,
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
test("gate pass signature binds holder, chain, contract, seat range, expiry and nonce", async () => {
  const holder = Wallet.createRandom(),
    other = Wallet.createRandom();
  const d = { chainId: 31337, address: Wallet.createRandom().address };
  const p = {
    chainId: d.chainId,
    contract: d.address,
    holder: holder.address,
    categoryId: 1,
    firstSeat: 0,
    qty: 2,
    expires: 1300,
    nonce: "ab".repeat(32),
  };
  validatePass(p, d, 1000);
  const signature = await holder.signMessage(admissionMessage(p));
  assert.equal(verifyMessage(admissionMessage(p), signature), holder.address);
  // Editing any field, including re-targeting the pass at another wallet's
  // seats, no longer recovers the holder the pass names.
  for (const change of [
    { qty: 3 },
    { firstSeat: 1 },
    { categoryId: 2 },
    { chainId: 1 },
    { contract: other.address },
    { holder: other.address },
    { expires: 1299 },
    { nonce: "cd".repeat(32) },
  ]) {
    const edited = { ...p, ...change };
    assert.notEqual(
      verifyMessage(admissionMessage(edited), signature),
      edited.holder
    );
  }
  // A pass written up for someone else's seats but signed by another wallet.
  const forged = await other.signMessage(admissionMessage(p));
  assert.notEqual(verifyMessage(admissionMessage(p), forged), p.holder);
  assert.throws(() => validatePass(p, d, 1300), /expired/);
  assert.throws(
    () => validatePass({ ...p, chainId: 1 }, d, 1000),
    /different chain/
  );
  assert.throws(() => validatePass({ ...p, qty: 0 }, d, 1000), /seat range/);
  assert.throws(() => validatePass({ ...p, qty: 11 }, d, 1000), /seat range/);
  assert.throws(
    () => validatePass({ ...p, holder: "0x1234" }, d, 1000),
    /wallet address/
  );
});
test("gate pass lifetime allows one minute of holder clock skew", () => {
  const d = { chainId: 31337, address: "0x" + "11".repeat(20) };
  const p = {
    chainId: 31337,
    contract: d.address,
    holder: "0x" + "22".repeat(20),
    categoryId: 1,
    firstSeat: 0,
    qty: 1,
    nonce: "ab".repeat(32),
  };
  validatePass({ ...p, expires: 1360 }, d, 1000);
  assert.throws(
    () => validatePass({ ...p, expires: 1361 }, d, 1000),
    /five minutes/
  );
});
test("pass text must contain a pass and a signature", () => {
  const proof = { pass: { qty: 1 }, signature: "0x12" };
  assert.deepEqual(readProof(JSON.stringify(proof)), proof);
  for (const text of [
    "not json",
    "{}",
    '{"pass":null,"signature":"0x12"}',
    '{"pass":{"qty":1}}',
    '{"challenge":{},"signature":"0x12"}',
  ])
    assert.throws(() => readProof(text), /Not a TicketMonster gate pass/);
});
