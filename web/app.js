import {
  BrowserProvider,
  JsonRpcProvider,
  Contract,
  formatEther,
  parseEther,
  verifyMessage,
  getAddress,
  ZeroAddress,
} from "/ethers.js";
import {
  seatPosition,
  groupSeats,
  phase,
  admissionMessage,
  readProof,
  validatePass,
  PASS_LIFETIME,
} from "./domain.js";

const $ = (s) => document.querySelector(s);
const esc = (v) =>
  String(v).replace(
    /[&<>"']/g,
    (x) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
        x
      ])
  );
const eth = (x) => formatEther(x);
const balanceText = (x) =>
  `${Number(formatEther(x)).toLocaleString([], {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  })} ETH`;
const same = (a, b) => a?.toLowerCase() === b?.toLowerCase();
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const date = (t) =>
  new Date(Number(t) * 1000).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
let deployment,
  provider,
  contract,
  signer,
  account,
  data,
  busy = false,
  generation = 0;
let abi;
function status(message, error = false) {
  $("#status").textContent = message;
  $("#status").className = error ? "error" : "";
}
function errorMessage(e) {
  if (e.code === "ACTION_REJECTED" || e.code === 4001)
    return "Wallet request declined. Nothing was changed.";
  const raw = e.data || e.info?.error?.data;
  try {
    const parsed = contract.interface.parseError(
      typeof raw === "object" ? raw.data : raw
    );
    if (parsed)
      return `Transaction rejected: ${parsed.name}. Refresh to check the event’s latest state.`;
  } catch {}
  return e.shortMessage || e.message || String(e);
}
async function action(fn) {
  if (busy) return;
  busy = true;
  const states = [
    ...document.querySelectorAll("button, input, select, textarea"),
  ].map((b) => [b, b.disabled]);
  states.forEach(([b]) => (b.disabled = true));
  try {
    await fn();
  } catch (e) {
    status(errorMessage(e), true);
  } finally {
    busy = false;
    states.forEach(([b, disabled]) => (b.disabled = disabled));
    if (data) render();
  }
}
async function transact(method, args = []) {
  if (!signer) throw new Error("Connect your wallet first.");
  const writer = contract.connect(signer);
  status("Confirm the transaction in your wallet…");
  const tx = await writer[method](...args);
  status(`Transaction submitted: ${tx.hash}. Waiting for confirmation…`);
  await tx.wait();
  await refresh();
  status(`Confirmed: ${method} · ${tx.hash}`);
}
async function logQuery(filter, last) {
  const logs = [];
  for (let from = deployment.deploymentBlock || 0; from <= last; from += 2000)
    logs.push(
      ...(await contract.queryFilter(filter, from, Math.min(from + 1999, last)))
    );
  return logs;
}
async function refresh() {
  if (!contract) return;
  const seq = ++generation;
  const block = await provider.getBlock("latest");
  const at = { blockTag: block.number };
  const [eventLogs, categoryLogs, seatLogs, queuedLogs] = await Promise.all([
    logQuery(contract.filters.EventCreated(), block.number),
    logQuery(contract.filters.CategoryCreated(), block.number),
    account ? logQuery(contract.filters.Seats(), block.number) : [],
    account
      ? logQuery(contract.filters.Queued(null, account), block.number)
      : [],
  ]);
  const events = await Promise.all(
    eventLogs.map(async (l) => {
      const id = Number(l.args.eventId);
      const v = await contract.events(id, at);
      return {
        id,
        name: l.args.name,
        organiser: v.organiser,
        salesEnd: v.salesEnd,
        checkInEnd: v.checkInEnd,
        cancelled: v.cancelled,
      };
    })
  );
  const categories = await Promise.all(
    categoryLogs.map(async (l) => {
      const id = Number(l.args.categoryId),
        c = await contract.categories(id, at);
      const [buy, sell] = await Promise.all([
        contract.queueBounds(id, false, at),
        contract.queueBounds(id, true, at),
      ]);
      const preview = await Promise.all(
        Array.from(
          { length: Math.min(Number(c.supply), 128) },
          async (_, seat) => ({
            seat,
            owner: await contract.ownerOf(id, seat, at),
            used: await contract.isCheckedIn(id, seat, at),
          })
        )
      );
      return {
        id,
        label: l.args.label,
        price: c.price,
        deposit: c.deposit,
        stock: Number(c.stock),
        supply: Number(c.supply),
        eventId: Number(c.eventId),
        buy,
        sell,
        preview,
      };
    })
  );
  const mine = new Map();
  for (const l of seatLogs) {
    const { categoryId, from, to, firstSeat, qty } = l.args;
    const id = Number(categoryId);
    if (!mine.has(id)) mine.set(id, new Set());
    for (let s = Number(firstSeat); s < Number(firstSeat + qty); s++) {
      if (same(from, account)) mine.get(id).delete(s);
      if (same(to, account)) mine.get(id).add(s);
    }
  }
  const seats = [];
  for (const [id, owned] of mine)
    for (const s of owned)
      if (same(await contract.ownerOf(id, s, at), account))
        seats.push({
          categoryId: id,
          seat: s,
          used: await contract.isCheckedIn(id, s, at),
        });
  const orders = (
    await Promise.all(
      queuedLogs.map(async (l) => {
        const o = await contract.orderAt(
          l.args.categoryId,
          l.args.isSell,
          l.args.index,
          at
        );
        return {
          categoryId: Number(l.args.categoryId),
          isSell: l.args.isSell,
          index: l.args.index,
          qty: Number(o.qty),
          firstSeat: Number(o.firstSeat),
        };
      })
    )
  ).filter((o) => o.qty > 0);
  const [credit, balance] = account
    ? await Promise.all([
        contract.credit(account, at),
        provider.getBalance(account, block.number),
      ])
    : [0n, null];
  if (seq !== generation) return;
  data = {
    events,
    categories,
    seats,
    orders,
    credit,
    balance,
    now: block.timestamp,
  };
  render();
}
function options(selector, rows) {
  const el = $(selector),
    v = el.value;
  el.innerHTML = rows;
  if ([...el.options].some((o) => o.value === v)) el.value = v;
}
function render() {
  const { events, categories, seats, orders, credit, balance, now } = data;
  $("#balance").textContent = balance === null ? "" : balanceText(balance);
  const quantities = new Map(
    [...document.querySelectorAll('[id^="qty-"]')].map((el) => [
      el.id,
      el.value,
    ])
  );
  const expanded = new Set(
    [...document.querySelectorAll("details[data-map][open]")].map(
      (el) => el.dataset.map
    )
  );
  $("#events").innerHTML =
    events
      .map(
        (e) =>
          `<article class="event-card"><div class="event-art"><span class="tag">${phase(
            e,
            now
          )}</span></div><div class="card-body"><h3>${esc(
            e.name
          )}</h3><div class="meta">Doors ${date(
            e.salesEnd
          )} · Check-in until ${date(e.checkInEnd)}<br>Organised by ${esc(
            short(e.organiser)
          )}</div>${
            categories
              .filter((c) => c.eventId === e.id)
              .map((c) => {
                const display = [...c.preview].sort((a, b) => {
                  const x = seatPosition(a.seat),
                    y = seatPosition(b.seat);
                  return x.row - y.row || x.column - y.column;
                });
                return `<div class="category"><div class="category-head"><strong>${esc(
                  c.label
                )}</strong><span>${eth(c.price)} ETH</span></div><small>+ ${eth(
                  c.deposit
                )} ETH refundable deposit · ${c.stock}/${
                  c.supply
                } primary seats left</small><small>${
                  c.buy[1] - c.buy[0]
                } buyer orders · ${c.sell[1] - c.sell[0]} seller orders${
                  phase(e, now) !== "On sale"
                    ? " (historical bounds; see your reclaimable orders)"
                    : ""
                }</small><div class="buy-row"><input aria-label="Quantity for ${esc(
                  c.label
                )}" type="number" min="1" max="10" value="1" id="qty-${
                  c.id
                }"><button data-buy="${c.id}" ${
                  !account || phase(e, now) !== "On sale" ? "disabled" : ""
                }>${
                  c.stock ? "Get tickets" : "Buy / join waiting queue"
                } ↗</button></div><small>Pay price + deposit per seat. Any unfilled quantity joins the prepaid queue; resale seats may be separated.</small><details class="seat-details" data-map="${
                  c.id
                }"><summary>View seat map${
                  c.supply > 128 ? " (first 128 seats)" : ""
                }</summary><div class="seat-grid">${display
                  .map((s) => {
                    const p = seatPosition(s.seat);
                    return `<span class="seat ${
                      s.used
                        ? "used"
                        : same(s.owner, account)
                        ? "mine"
                        : same(s.owner, deployment.address)
                        ? "escrow"
                        : s.owner !== ZeroAddress
                        ? "taken"
                        : ""
                    }" title="Seat ${s.seat} · Row ${p.row}, place ${
                      p.column
                    }">${s.seat}</span>`;
                  })
                  .join(
                    ""
                  )}</div><div class="seat-legend">Green: yours · Grey: held · Amber: seller queue · Struck: used/refunded. Seat IDs start at 0.</div></details></div>`;
              })
              .join("") || '<p class="muted">Tickets coming soon.</p>'
          }</div></article>`
      )
      .join("") ||
    '<div class="empty">No events yet. Create the first in Organiser studio.</div>';
  for (const [id, value] of quantities) {
    const el = document.getElementById(id);
    if (el) el.value = value;
  }
  for (const id of expanded) {
    const el = document.querySelector(`details[data-map="${id}"]`);
    if (el) el.open = true;
  }
  $("#credit").textContent = `${eth(credit)} ETH available`;
  $("#withdraw").disabled = !account || credit === 0n;
  $("#my-tickets").innerHTML =
    categories
      .flatMap((c) => {
        const e = events.find((e) => e.id === c.eventId),
          owned = seats.filter((s) => s.categoryId === c.id),
          open = owned.filter((s) => !s.used);
        return groupSeats(open.map((s) => s.seat))
          .map(
            (g) =>
              `<div class="ticket-row"><div><strong>${esc(e.name)} · ${esc(
                c.label
              )}</strong><p class="muted">Seat IDs ${g.firstSeat}–${
                g.firstSeat + g.qty - 1
              } · ${g.qty} ticket(s) · ${phase(e, now)}</p></div>${
                e.cancelled
                  ? `<button data-refund="${c.id},${g.firstSeat},${
                      g.qty
                    }">Claim ${eth(
                      BigInt(g.qty) * (c.price + c.deposit)
                    )} ETH refund</button>`
                  : phase(e, now) === "On sale"
                  ? `<button data-sell="${c.id},${g.firstSeat},${g.qty}">Resell group at face value</button>`
                  : '<span class="tag">' +
                    (phase(e, now) === "Ended"
                      ? "No-show / event ended"
                      : "Ready for check-in") +
                    "</span>"
              }</div>`
          )
          .concat(
            owned.some((s) => s.used)
              ? [
                  `<div class="ticket-row"><span>${esc(e.name)} · ${
                    owned.filter((s) => s.used).length
                  } seat(s) ${
                    e.cancelled ? "refunded" : "checked in"
                  }</span><span class="tag">Complete</span></div>`,
                ]
              : []
          );
      })
      .join("") ||
    '<div class="empty">Your owned tickets will appear here after purchase. Unfilled purchases appear under waiting orders.</div>';
  $("#orders").innerHTML =
    orders
      .map((o) => {
        const c = categories.find((c) => c.id === o.categoryId),
          e = events.find((e) => e.id === c.eventId);
        return `<div class="order-row"><div><strong>${
          o.isSell ? "Resale" : "Buyer"
        } order #${o.index} · ${esc(e.name)}</strong><p class="muted">${esc(
          c.label
        )} · ${o.qty} remaining${
          o.isSell
            ? ` · seat IDs ${o.firstSeat}–${o.firstSeat + o.qty - 1}`
            : ` · ${eth(BigInt(o.qty) * (c.price + c.deposit))} ETH escrow`
        }</p></div><button data-reclaim="${o.categoryId},${o.isSell},${
          o.index
        }" ${phase(e, now) === "On sale" ? "disabled" : ""}>${
          o.isSell ? "Reclaim seats" : "Reclaim payment"
        }</button></div>`;
      })
      .join("") ||
    '<div class="empty">No unfilled orders for this wallet.</div>';
  const own = events.filter((e) => same(e.organiser, account));
  options(
    "#organiser-events",
    own
      .filter((e) => phase(e, now) === "On sale")
      .map((e) => `<option value="${e.id}">${esc(e.name)}</option>`)
      .join("")
  );
  options(
    "#gate-seats",
    categories
      .flatMap((c) => {
        const e = events.find((e) => e.id === c.eventId);
        if (phase(e, now) !== "Doors open") return [];
        return groupSeats(
          seats
            .filter((s) => s.categoryId === c.id && !s.used)
            .map((s) => s.seat)
        ).map(
          (g) =>
            `<option value="${c.id},${g.firstSeat},${g.qty}">${esc(
              e.name
            )} / ${esc(c.label)} · seat IDs ${g.firstSeat}–${
              g.firstSeat + g.qty - 1
            }</option>`
        );
      })
      .join("") || '<option value="">No seats ready for check-in</option>'
  );
  $("#manage-events").innerHTML = own
    .map(
      (e) =>
        `<div class="manage"><h3>${esc(e.name)}</h3><span class="tag">${phase(
          e,
          now
        )}</span><div class="actions"><button data-cancel="${e.id}" ${
          phase(e, now) !== "On sale" ? "disabled" : ""
        }>Cancel & enable refunds</button><button data-proceeds="${e.id}" ${
          e.cancelled || now < Number(e.salesEnd) ? "disabled" : ""
        }>Withdraw primary proceeds</button>${categories
          .filter((c) => c.eventId === e.id)
          .map(
            (c) =>
              `<button data-noshow="${c.id}" ${
                e.cancelled || now < Number(e.checkInEnd) ? "disabled" : ""
              }>Settle no-shows: ${esc(c.label)}</button>`
          )
          .join("")}${
          deployment.demo
            ? `<button class="quiet" data-time="${e.salesEnd}" ${
                now >= Number(e.salesEnd) ? "disabled" : ""
              }>Demo: open doors</button><button class="quiet" data-time="${
                e.checkInEnd
              }" ${
                now >= Number(e.checkInEnd) ? "disabled" : ""
              }>Demo: close check-in</button>`
            : ""
        }</div></div>`
    )
    .join("");
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.tab) {
    document
      .querySelectorAll(".panel")
      .forEach((p) => (p.hidden = p.id !== b.dataset.tab));
    document
      .querySelectorAll("[data-tab]")
      .forEach((x) => x.classList.toggle("active", x === b));
    return;
  }
  const d = b.dataset;
  if (d.buy)
    action(async () => {
      const c = data.categories.find((c) => c.id === Number(d.buy));
      const q = Number($(`#qty-${c.id}`).value);
      if (!Number.isInteger(q) || q < 1 || q > 10)
        throw Error("Choose between 1 and 10 tickets.");
      await transact("buyTicket", [
        c.id,
        q,
        { value: BigInt(q) * (c.price + c.deposit) },
      ]);
    });
  if (d.sell)
    action(() => transact("sellTicket", d.sell.split(",").map(Number)));
  if (d.refund)
    action(() => transact("claimRefund", d.refund.split(",").map(Number)));
  if (d.reclaim)
    action(() => {
      const [c, s, i] = d.reclaim.split(",");
      return transact("reclaimOrder", [c, s === "true", i]);
    });
  if (d.cancel) action(() => transact("cancelEvent", [d.cancel]));
  if (d.proceeds) action(() => transact("withdrawProceeds", [d.proceeds]));
  if (d.noshow)
    action(async () => {
      if (await contract.noShowsClaimed(d.noshow))
        throw Error("This category is already settled.");
      await transact("claimNoShowDeposits", [d.noshow]);
      if (!(await contract.noShowsClaimed(d.noshow)))
        status("Batch settled. Click again to settle the remaining no-shows.");
    });
  if (d.time)
    action(async () => {
      if (!deployment.demo) throw Error("Demo only.");
      await provider.send("evm_setNextBlockTimestamp", [Number(d.time)]);
      await provider.send("evm_mine", []);
      await refresh();
      status("Local demo clock advanced.");
    });
});
$("#refresh").onclick = () => action(refresh);
$("#withdraw").onclick = () => action(() => transact("withdraw"));
function form(id, fn) {
  $(id).addEventListener("submit", (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    action(() => fn(f));
  });
}
form("#create-event", (f) =>
  transact("createEvent", [
    f.name.trim(),
    Math.floor(new Date(f.salesEnd).getTime() / 1000),
    Math.floor(new Date(f.checkInEnd).getTime() / 1000),
  ])
);
form("#create-category", (f) =>
  transact("createTickets", [
    f.eventId,
    f.label.trim(),
    f.supply,
    parseEther(f.price),
    parseEther(f.deposit),
  ])
);
form("#gate-sign", async (f) => {
  if (!signer) throw Error("Connect the ticket holder wallet.");
  const [categoryId, firstSeat, qty] = f.group.split(",").map(Number);
  const pass = {
    chainId: deployment.chainId,
    contract: deployment.address,
    holder: getAddress(account),
    categoryId,
    firstSeat,
    qty,
    expires: Math.floor(Date.now() / 1000) + PASS_LIFETIME,
    nonce: Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
      b.toString(16).padStart(2, "0")
    ).join(""),
  };
  validatePass(pass, deployment, Math.floor(Date.now() / 1000));
  const signature = await signer.signMessage(admissionMessage(pass));
  const proof = JSON.stringify({ pass, signature });
  $("#proof-output").value = proof;
  if (window.qrcode) {
    const qr = window.qrcode(0, "L");
    qr.addData(proof);
    qr.make();
    $("#proof-qr").innerHTML = qr.createImgTag(3, 12);
    $("#proof-qr img").alt = "Signed gate pass QR code";
  }
  status(
    `Gate pass signed for seat IDs ${firstSeat}–${
      firstSeat + qty - 1
    }. Show it at the gate before ${new Date(
      pass.expires * 1000
    ).toLocaleTimeString()}.`
  );
});
$("#proof-image").addEventListener("change", (e) =>
  action(async () => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024)
      throw Error("Choose a QR image smaller than 10 MB.");
    const bitmap = await createImageBitmap(file);
    try {
      const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const decoded = window.jsQR(pixels.data, pixels.width, pixels.height);
      if (!decoded)
        throw Error(
          "No readable QR code found. Try a sharper image or paste the proof text."
        );
      const proof = readProof(decoded.data);
      validatePass(proof.pass, deployment, Math.floor(Date.now() / 1000));
      $("#gate-consume textarea").value = decoded.data;
      status(
        "QR decoded locally. Verify & check in to validate the signature and admit the holder."
      );
    } finally {
      bitmap.close();
    }
  })
);

form("#gate-consume", async (f) => {
  if (!signer) throw Error("Connect the organiser wallet.");
  const { pass: p, signature } = readProof(f.proof);
  validatePass(p, deployment, Math.floor(Date.now() / 1000));
  // The signature is what proves the pass came from the holder's wallet rather
  // than being typed up or edited: any changed field recovers another address.
  let signedBy;
  try {
    signedBy = verifyMessage(admissionMessage(p), signature);
  } catch {}
  if (!same(signedBy, p.holder))
    throw Error("Signature does not match the ticket holder.");
  const category = await contract.categories(p.categoryId),
    event = await contract.events(category.eventId);
  if (!same(event.organiser, account))
    throw Error("Only this event’s organiser can check in its tickets.");
  for (let s = p.firstSeat; s < p.firstSeat + p.qty; s++) {
    if (!same(await contract.ownerOf(p.categoryId, s), p.holder))
      throw Error(`Holder no longer owns seat ${s}.`);
    if (await contract.isCheckedIn(p.categoryId, s))
      throw Error(`Seat ${s} is already used.`);
  }
  await transact("consumeTicket", [p.categoryId, p.firstSeat, p.qty, p.holder]);
  status(
    `Checked in seat IDs ${p.firstSeat}–${p.firstSeat + p.qty - 1} for ${short(
      p.holder
    )}; their deposit is now withdrawable credit.`
  );
});
async function wallet() {
  if (!window.ethereum)
    throw Error(
      "Install an Ethereum wallet such as MetaMask, or use the demo account selector."
    );
  const p = new BrowserProvider(window.ethereum);
  await p.send("eth_requestAccounts", []);
  const network = await p.getNetwork();
  if (network.chainId !== BigInt(deployment.chainId))
    throw Error(`Switch your wallet to chain ${deployment.chainId}.`);
  provider = p;
  signer = await p.getSigner();
  account = await signer.getAddress();
  contract = new Contract(deployment.address, abi, p);
  $("#network").textContent = `Chain ${deployment.chainId}`;
  $("#connect").textContent = short(account);
  await refresh();
}
$("#connect").onclick = () => action(wallet);
window.ethereum?.on("accountsChanged", () => action(wallet));
window.ethereum?.on("chainChanged", () => location.reload());
$("#account").onchange = () =>
  action(async () => {
    provider = new JsonRpcProvider(deployment.rpcUrl, deployment.chainId, {
      cacheTimeout: -1,
    });
    signer = await provider.getSigner(Number($("#account").value));
    account = await signer.getAddress();
    contract = new Contract(deployment.address, abi, provider);
    $("#connect").textContent = "Connect external wallet";
    await refresh();
  });
async function init() {
  const response = await fetch("/deployment.json");
  if (!response.ok)
    throw Error(
      "No deployment found. Run npm run demo to start the local blockchain and seed events."
    );
  deployment = await response.json();
  deployment.rpcUrl = new URL(deployment.rpcUrl, window.location.href).href;
  abi = (await (await fetch("/contract.json")).json()).abi;
  provider = new JsonRpcProvider(deployment.rpcUrl, undefined, {
    cacheTimeout: -1,
  });
  if ((await provider.getNetwork()).chainId !== BigInt(deployment.chainId))
    throw Error("RPC chain does not match deployment.");
  if ((await provider.getCode(deployment.address)) === "0x")
    throw Error("Contract not found. Restart npm run demo and refresh.");
  contract = new Contract(deployment.address, abi, provider);
  $("#network").textContent = `Chain ${deployment.chainId}`;
  if (deployment.demo) {
    if (
      deployment.chainId !== 31337 ||
      !["127.0.0.1", "localhost"].includes(new URL(deployment.rpcUrl).hostname)
    )
      throw Error("Demo accounts require a local Anvil chain.");
    $("#demo-note").hidden = false;
    $("#account").hidden = false;
    $("#account").innerHTML = deployment.accounts
      .map(
        (a, i) =>
          `<option value="${i}">${
            ["Organiser", "Alice", "Bob", "Charlie", "Dana"][i]
          } · ${short(a)}</option>`
      )
      .join("");
    signer = await provider.getSigner(0);
    account = await signer.getAddress();
  }
  await refresh();
  setInterval(() => {
    if (!busy && document.visibilityState === "visible")
      refresh().catch((e) => status(errorMessage(e), true));
  }, 15000);
}
init().catch((e) => status(errorMessage(e), true));
