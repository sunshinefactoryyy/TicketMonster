export function seatPosition(seat, width = 8) {
  const row = Math.floor(seat / width);
  return {
    row: row + 1,
    column: row % 2 ? width - (seat % width) : (seat % width) + 1,
  };
}
export function groupSeats(seats, limit = 10) {
  const groups = [];
  for (const seat of [...seats].sort((a, b) => a - b)) {
    const last = groups.at(-1);
    if (last && last.firstSeat + last.qty === seat && last.qty < limit)
      last.qty++;
    else groups.push({ firstSeat: seat, qty: 1 });
  }
  return groups;
}
export function phase(event, now) {
  return event.cancelled
    ? "Cancelled"
    : now < Number(event.salesEnd)
    ? "On sale"
    : now < Number(event.checkInEnd)
    ? "Doors open"
    : "Ended";
}
export const PASS_LIFETIME = 300;
// The holder's device sets the expiry, so the gate allows for its clock
// running up to a minute ahead.
const CLOCK_SKEW = 60;
export function admissionMessage(p) {
  return [
    "TicketMonster gate pass v2",
    `Chain: ${p.chainId}`,
    `Contract: ${p.contract.toLowerCase()}`,
    `Holder: ${p.holder.toLowerCase()}`,
    `Category: ${p.categoryId}`,
    `First seat: ${p.firstSeat}`,
    `Quantity: ${p.qty}`,
    `Expires: ${p.expires}`,
    `Nonce: ${p.nonce}`,
  ].join("\n");
}
export function readProof(text) {
  let proof;
  try {
    proof = JSON.parse(text);
  } catch {}
  if (
    !proof?.pass ||
    typeof proof.pass !== "object" ||
    typeof proof.signature !== "string"
  )
    throw new Error(
      "Not a TicketMonster gate pass. Paste the full pass text or scan its QR code."
    );
  return proof;
}
export function validatePass(p, deployment, now) {
  if (
    String(p.chainId) !== String(deployment.chainId) ||
    p.contract?.toLowerCase() !== deployment.address.toLowerCase()
  )
    throw new Error("This pass is for a different chain or contract.");
  if (!/^0x[0-9a-f]{40}$/i.test(p.holder))
    throw new Error("Invalid wallet address.");
  for (const key of ["categoryId", "firstSeat", "qty", "expires"])
    if (!Number.isSafeInteger(p[key])) throw new Error("Invalid pass numbers.");
  if (p.categoryId < 1 || p.firstSeat < 0 || p.qty < 1 || p.qty > 10)
    throw new Error("Invalid seat range.");
  if (p.expires <= now || p.expires > now + PASS_LIFETIME + CLOCK_SKEW)
    throw new Error(
      "Gate pass expired or exceeds five minutes. Ask the holder to show a fresh pass."
    );
  if (!/^[0-9a-f]{64}$/.test(p.nonce)) throw new Error("Invalid pass nonce.");
}
