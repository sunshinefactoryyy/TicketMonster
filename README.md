# TicketMonster

IS4302 Group Project — event tickets, transparent FIFO resale, assigned group seating and refundable attendance deposits.

## Run with Docker (recommended for teammates)

Install and start **Docker Desktop** (Windows/macOS), or Docker Engine with the Compose plugin (Linux). You do not need to install Node.js, Foundry, Solidity or a wallet extension on your machine.

From this repository's directory:

```sh
docker compose up --build
```

Once the logs show `TicketMonster: http://127.0.0.1:4173`, open **http://127.0.0.1:4173**. The container runs the app, a fresh Anvil blockchain, contract deployment and sample events together. Use the account selector for the funded demo wallets. The image supports native `linux/amd64` and `linux/arm64` (including Apple Silicon). The first build needs internet access to download the pinned toolchain and npm dependencies, and runs the full test suite; subsequent starts reuse the built image.

```sh
# Run in the background and wait until both app and chain are ready:
docker compose up --build -d --wait

# View logs, rerun the tests, or stop:
docker compose logs -f
docker compose exec ticketmonster npm run check
docker compose down
```

**Every restart resets the demo blockchain and redeploys the sample events.** There is no persistent volume or database to configure. Ctrl+C stops an attached run; `docker compose down` removes its container. Each teammate runs their own independent chain.

If port 4173 is busy, copy `.env.example` to `.env`, set `TICKETMONSTER_PORT=4174`, and rerun the command. Then open http://127.0.0.1:4174. The browser automatically uses the correct port for blockchain requests. Docker publishes only the app port on localhost; its `/rpc` endpoint forwards to Anvil inside the container. For an external wallet, use RPC **http://127.0.0.1:4173/rpc**, chain ID **31337** (adjust the port if changed). This is a local demo using public test accounts, not a public hosting configuration.

Without Compose:

```sh
docker build -t ticketmonster .
docker run --rm --init -p 127.0.0.1:4173:4173 ticketmonster
```

## Run without Docker

Requires Node.js 22+ and [Foundry](https://getfoundry.sh/) (`forge`, `anvil`). The Solidity compiler is pinned to 0.8.34; Foundry downloads it on first build. `forge-std` sources are vendored so the Solidity tests do not require a separate install.

```sh
npm ci
npm run check
npm run demo
```

Open **http://127.0.0.1:4173**. The demo starts a fresh local blockchain, deploys the contract, seeds two events and three ticket categories, and serves the app. Use the account selector to switch between the organiser, Alice, Bob, Charlie and Dana. These are funded local Anvil accounts; no wallet extension is needed for the demo. Transactions execute on the EVM, not in an in-memory mock. Ctrl+C stops both servers. Restarting creates fresh demo state.

Optional settings: `PORT=4174 RPC_PORT=8546 npm run demo`. `FORGE`, `ANVIL` and `SOLC` can point to installed executables. If the compiler is already installed outside Foundry, run `SOLC=/absolute/path/to/solc npm run check` and use the same variable for the demo.

For MetaMask, add the local RPC `http://127.0.0.1:8545`, chain ID `31337`, and use a local test account. **Connect wallet** switches to the injected wallet and rejects a mismatched chain. The demo selector switches back to local accounts. Never use these public development accounts on a funded network.

## What is implemented

- Organiser event/category creation with immutable prices, supplies and timelines.
- Primary stock first, then FIFO sellers, then a prepaid buyer queue. Partial fills preserve order.
- Fixed-price resale returns price plus deposit to sellers. There is no transfer/approval interface that bypasses the market.
- Consecutive primary seating, compact ownership, bounded lookup anchors and bitmap check-in. Resale seating can be separated.
- Cancellation before doors open, holder refunds, and recovery of unfilled escrow/seats after cancellation or sales close.
- Organiser proceeds after doors open; attendance deposit credits; bounded no-show settlement after check-in closes.
- Wallet-connected UI with the selected wallet's ETH balance, event discovery, snake seat maps, ownership reconstructed from logs and verified against current storage, queue recovery, organiser controls, and gate admission.
- Holder-signed, five-minute gate passes shown as QR codes. The gate scans an uploaded QR image entirely in the browser or accepts pasted pass text, then checks the signature against current on-chain ownership. Camera capture is not required.
- Solidity regression/fuzz tests, browser-domain tests and a local demo runner.

Read [the demo runbook](docs/DEMO.md), [design and Lecture 5 discussion](docs/DESIGN.md), [requirements map](docs/REQUIREMENTS.md), and [verification results](docs/VERIFICATION.md).

## Repository layout

| Path                       | Purpose                                            |
| -------------------------- | -------------------------------------------------- |
| `src/TicketMonster.sol`    | Authoritative implementation                       |
| `test/TicketMonster.t.sol` | Supplied scenarios plus regressions and fuzz tests |
| `test/Payments.t.sol`      | Failed ETH delivery and withdrawal reentrancy      |
| `test/domain.test.mjs`     | Seating, lifecycle and signature-domain tests      |
| `web/`                     | Static browser application and gate workflow       |
| `scripts/`                 | Compiler, local deployment/demo and static server  |
| `docs/`                    | Design, limitations, demo and verification         |
| `lib/forge-std/`           | Vendored Foundry test dependency and licenses      |

The original supplied `.sol` files and private chat export remain outside this repository. Only the implementation and relevant design decisions belong in the project.

## Use an existing deployment

Run `npm run build`, deploy `src/TicketMonster.sol` using your chosen wallet/tooling, and create `web/deployment.json`:

```json
{
  "address": "0xYOUR_DEPLOYED_CONTRACT",
  "chainId": 11155111,
  "rpcUrl": "https://YOUR_RPC",
  "deploymentBlock": 123456,
  "demo": false
}
```

Then `npm start` serves the app. The RPC must support browser CORS and historical event reads. Do not put private RPC credentials in this browser-visible file. Public-chain deployment is optional and has not been performed. The project is an educational prototype, not an audited production ticketing service.

## Dependencies

`ethers` 6.17.0 is pinned by `package-lock.json`. QR generation uses vendored `qrcode-generator` 1.4.4 by Kazuhiko Arase (MIT), and QR scanning uses `jsQR` 1.4.0 (Apache-2.0). Licenses are included under `web/vendor/`. `forge-std` is vendored with its MIT and Apache licenses. The app can operate without an external CDN; system fonts are used if web fonts are unavailable.
