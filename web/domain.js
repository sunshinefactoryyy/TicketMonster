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
export function admissionMessage(c) {
  return [
    "TicketMonster admission v1",
    `Chain: ${c.chainId}`,
    `Contract: ${c.contract.toLowerCase()}`,
    `Gate: ${c.gate.toLowerCase()}`,
    `Holder: ${c.holder.toLowerCase()}`,
    `Category: ${c.categoryId}`,
    `First seat: ${c.firstSeat}`,
    `Quantity: ${c.qty}`,
    `Expires: ${c.expires}`,
    `Nonce: ${c.nonce}`,
  ].join("\n");
}
export function validateChallenge(c, deployment, now) {
  if (
    String(c.chainId) !== String(deployment.chainId) ||
    c.contract?.toLowerCase() !== deployment.address.toLowerCase()
  )
    throw new Error("This proof is for a different chain or contract.");
  for (const key of ["gate", "holder"])
    if (!/^0x[0-9a-f]{40}$/i.test(c[key]))
      throw new Error("Invalid wallet address.");
  for (const key of ["categoryId", "firstSeat", "qty", "expires"])
    if (!Number.isSafeInteger(c[key]))
      throw new Error("Invalid challenge numbers.");
  if (c.categoryId < 1 || c.firstSeat < 0 || c.qty < 1 || c.qty > 10)
    throw new Error("Invalid seat range.");
  if (c.expires <= now || c.expires > now + 300)
    throw new Error(
      "Challenge expired or exceeds five minutes. Request a fresh challenge."
    );
  if (!/^[0-9a-f]{64}$/.test(c.nonce))
    throw new Error("Invalid challenge nonce.");
}
