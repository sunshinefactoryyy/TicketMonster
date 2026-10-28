# Presentation runbook

Run `docker compose up --build`, or use the native setup: `npm ci`, `npm run check`, and `npm run demo`. Open http://127.0.0.1:4173. Restart the demo for a fresh chain. All ETH is local test currency. Account switching is for the demonstration; a real attendee uses their own wallet.

## 1. Discovery and public ownership (about one minute)

Show the two events, fixed prices, separate refundable deposits and seat maps. Explain the snake row layout, the ten-seat transaction bound and the difference between available primary seats and waiting resale orders. Wallet addresses and attendance are public. No attendee identity database is used.

## 2. Primary sales, both queues and partial matching (about two minutes)

1. Select Alice. In **Neon Garden / General admission**, buy four tickets. Inspect **My tickets & orders**: seats 0–3.
2. Select Bob and buy the remaining two: seats 4–5. Primary stock is now zero.
3. Select Charlie and buy three. Charlie has a prepaid buyer order and no seats yet.
4. Select Alice and resell the four-seat group. Charlie receives seats 0–2 immediately; seat 3 waits in the seller queue. Alice has 0.03 ETH withdrawable credit for the three filled tickets.
5. Select Dana and buy one. Dana receives seat 3; Alice's credit becomes 0.04 ETH. The organiser receives no extra primary proceeds from these resales.
6. Select Alice and withdraw. This transfers credit back to her local wallet.
7. Select Alice and buy one again. This creates an unfilled buyer order to reclaim later.

Purchasing or listing is final while sales are open. Any unfilled part of a purchase is prepaid escrow, not a guaranteed seat. The app shows this before submission. Fixed prices prevent an in-contract markup, but side payments and wallet resale remain limitations.

## 3. Cancellation before any time advance (about one minute)

1. Select Alice and buy two **Night at the Esplanade / Stalls** tickets.
2. Select Organiser, open **Organiser studio**, and cancel **Night at the Esplanade**.
3. Select Alice, open **My tickets & orders**, and claim the cancellation refund. Both price and deposit return. Refunded seats are marked complete; no second refund is possible.

Do this before advancing the clock: cancellation is forbidden once the event's sales end, because the organiser could already have withdrawn proceeds.

## 4. Attendance proof and escrow recovery (about two minutes)

1. Select Organiser and **Demo: open doors** for **Neon Garden**. This advances the local chain time to sales end. All trading stops.
2. Select Alice and reclaim her unfilled buyer order, then withdraw the returned credit.
3. Select Charlie and note his full wallet address from `/deployment.json` in the browser (account index 3; also `web/deployment.json` on a native install).
4. Select Organiser, open **At the gate**, select Neon Garden's category, enter Charlie's address, first seat `0`, group size `3`, and issue a challenge. Copy its JSON.
5. Select Charlie, paste the challenge in step 2 and sign. The app displays a proof JSON and QR code. Copy the proof JSON.
6. Select Organiser, paste that proof into step 3 (or save the QR image and choose it under **Scan a proof QR image**) and **Verify & check in**. Charlie's seats are marked used and his 0.006 ETH deposit is credited.
7. Try the same proof again: the gate rejects replay. If the challenge expired after five real minutes, issue a fresh one.
8. Repeat for Bob, first seat `4`, group size `2` (account index 2). Bob receives 0.004 ETH deposit credit. Leave Dana absent.

The signature binds all admission details. The organiser still attests to physical attendance; blockchain cannot independently observe the venue door. On-chain state prevents repeated consumption.

## 5. Settlement and trust discussion (about one minute)

1. Organiser withdraws Neon Garden's primary proceeds: six tickets × 0.008 ETH = **0.048 ETH**.
2. Organiser clicks **Demo: close check-in** for Neon Garden.
3. Settle the category's no-shows. Dana's unused seat contributes **0.002 ETH** to the organiser. Larger categories settle in repeated batches.
4. Charlie and Bob can withdraw their attendance credits even after check-in ends.

Close by explaining the Lecture 5 tradeoffs: deterministic matching and escrow reduce exchange trust; organiser honesty, transaction ordering, identity/Sybil problems, gas costs and public attendance history remain. A database is cheaper; blockchain is useful where shared, independently verifiable settlement is worth those costs.

## Additional controls

The organiser can create events with local date/time fields and add categories before sales end. The UI uses the selected wallet's organiser rights. Unfilled seller orders can be reclaimed at sales end, then checked in if attendance is still open. `npm run check` exercises that path, bitmap boundaries and cancellation of both queue types without relying on a live demo.

If RPC_PORT or PORT is busy, select unused ports. If the page reports a missing deployment, run the demo from the repository directory. If Anvil was restarted independently, rerun the demo to regenerate its address/configuration. A non-demo deployment requires a matching wallet network.
