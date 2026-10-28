# Verification record

Verified locally on 28 October 2026 using Node 22.16.0, Foundry 1.0.0 and solc 0.8.34 (Cancun, optimizer 200 runs).

## Automated checks

`npm run check`: 17 Solidity tests and 9 Node tests. The Solidity suite includes the six original scenarios and two fuzz tests with 256 cases each. Additional cases exercise exact time boundaries, permissions, partial FIFO fills, failed-fill rollback, primary-stock priority, cancellations of both queue types, escrow check-in rejection, bounded ownership walks, a 4,100-seat batched settlement, failed ETH delivery and withdrawal reentry. Node checks cover snake rows, bounded seat groups, lifecycle phases, signature domain/tampering, QR encode/decode round trips and the HTTP RPC proxy.

`forge fmt --check src test`, JavaScript syntax checks and `git diff --check` also pass. GitHub CI is configured but has not run remotely; these changes have not been pushed.

## Browser walkthrough on local Anvil

The local demo was started with `npm run demo`. The following scenarios completed in Chrome against chain 31337 using disposable test ETH:

- Alice bought Neon seats 0–3; Bob bought 4–5.
- Charlie's prepaid three-ticket order waited with 0.03 ETH escrow.
- Alice resold four seats: Charlie received 0–2 and seat 3 remained in seller escrow. Dana purchased the remaining seat. Alice withdrew 0.04 ETH resale credit.
- Alice bought two Stalls tickets; the organiser cancelled that event; Alice received the 0.024 ETH cancellation refund.
- Alice queued another Neon purchase, then reclaimed and withdrew its 0.01 ETH after doors opened.
- Charlie and Bob signed gate-issued challenges. QR proofs were generated. The organiser verified signatures and checked in each group; deposit credits were 0.006 and 0.004 ETH respectively. Replaying Charlie's proof was rejected. Both attendees withdrew their credits.
- The organiser withdrew primary proceeds, advanced past check-in and settled the one absent seat's deposit. A second settlement attempt was rejected as already settled.
- The organiser created a new event and its Main floor category through the forms, leaving an available event in the running demo.
- Desktop layout was visually inspected; no browser console errors were reported during the main walkthrough.

The QR image encoder/decoder round trip passes automatically. Browser admission was verified using pasted signed proof; the optional QR image-upload path has not been verified end to end. Camera capture, mobile-device testing, external-wallet signing, public-network deployment and an independent security audit have not been performed.

The running demo now contains exercised/cancelled/settled events and the additional fresh event. Restart `npm run demo` to reset to the presentation runbook's initial state.

## Docker setup

The container includes Node 22, Foundry 1.0.0 and checksum-verified solc 0.8.34, with native amd64/arm64 downloads. Its build runs the full suite, now 17 Solidity and 9 Node tests (four added RPC-proxy tests). These 26 tests pass locally, and `docker compose config` validates both default port 4173 and overridden port 4174. The application resolves the relative `/rpc` URL against its browser origin, so host port overrides also apply to blockchain requests. Anvil remains bound to container loopback; only the HTTP server listens on the container network.

Successful build and healthy startup were reported on Apple Silicon after running `TICKETMONSTER_PORT=4174 docker compose -p ticketmonster-docker-check up --build -d --wait`. Live behavior was verified directly through the published port:

- `/deployment.json` returned chain ID 31337 and the relative `/rpc` endpoint.
- A batched JSON-RPC request returned the correct chain ID and nonempty deployed contract code.
- Chrome loaded the seeded events, switched to Alice and confirmed a purchase of one Neon Garden ticket. The owned ticket appeared under My tickets & orders (seat ID 0), proving read and write requests work through the overridden HTTP port.
- No browser warnings or errors were recorded during this Docker smoke check.

The amd64 download path is configured and its release assets were verified, but an amd64 container has not been tested. The isolated Docker demo remains on port 4174 with one purchased ticket; restarting it resets the chain.
