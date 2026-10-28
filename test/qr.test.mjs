import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

test("vendored QR encoder and scanner round-trip an admission-size proof", () => {
  const encoder = { module: { exports: {} }, exports: {} };
  const decoder = { module: { exports: {} }, exports: {}, Uint8ClampedArray };
  runInNewContext(readFileSync("web/vendor/qrcode.js", "utf8"), encoder);
  runInNewContext(
    readFileSync("web/vendor/jsqr/dist/jsQR.js", "utf8"),
    decoder
  );
  const payload = JSON.stringify({
    challenge: {
      chainId: 31337,
      contract: process.env.TEST_QR_ADDRESS || "0x" + "11".repeat(20),
      gate: "0x" + "22".repeat(20),
      holder: "0x" + "33".repeat(20),
      categoryId: 1,
      firstSeat: 0,
      qty: 3,
      expires: Math.floor(Date.now() / 1000) + 300,
      nonce: "ab".repeat(32),
    },
    signature: "0x" + "cd".repeat(65),
  });
  const qr = encoder.module.exports(0, "L");
  qr.addData(payload);
  qr.make();
  if (process.env.TEST_QR_PATH)
    writeFileSync(
      process.env.TEST_QR_PATH,
      Buffer.from(qr.createDataURL(4, 16).split(",")[1], "base64")
    );
  const scale = 4,
    border = 4,
    size = (qr.getModuleCount() + border * 2) * scale;
  const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let y = 0; y < qr.getModuleCount(); y++)
    for (let x = 0; x < qr.getModuleCount(); x++)
      if (qr.isDark(y, x))
        for (let dy = 0; dy < scale; dy++)
          for (let dx = 0; dx < scale; dx++) {
            const i =
              (((y + border) * scale + dy) * size + (x + border) * scale + dx) *
              4;
            pixels[i] = pixels[i + 1] = pixels[i + 2] = 0;
          }
  assert.equal(decoder.module.exports(pixels, size, size).data, payload);
});
