# Design and Lecture 5 discussion

## Source decisions

The implementation follows the 10 October v2 Solidity sketch, its six supplied Foundry tests, the revised project diagram and the chat export through 27 October. The 9 October diagram proposed off-chain Redis/RabbitMQ queues and Postgres inventory; the 10 October revision explicitly moved those on-chain. The implementation therefore needs no trusted matching server or inventory database.

The early credit-score/scalper-priority idea was replaced by fixed-price resale, controlled transfers and attendance deposits. In the final sketch a reseller gets **both price and deposit back** when matched. The earlier annotation saying resellers forfeit deposits is superseded by the revised flow and Solidity. A no-show holder loses the deposit; an ordinary reseller does not.

The 12 October random pre-order proposal was exploratory and explicitly allowed full FCFS with randomness discussed as future work. There is no invented oracle or pseudo-random lottery here. FCFS means canonical transaction order, not wall-clock arrival order or equal fairness. Priority fees, validators and transaction ordering can affect allocation.

Lecture 5 pages 38–41 ask for practical, specific and comprehensive execution; stakeholder incentives and information; reduced security/logic glitches; explicit assumptions and limitations; oracle trust; tokenomics; and data segregation. The sections below address these questions. Those pages do not require public-chain deployment or a speculative token.

## Architecture and state

The browser reads the deployed contract and indexed event logs through an Ethereum RPC. The wallet sends signed transactions directly. The chain holds event times, organiser identity, immutable ticket categories, inventory, seat ownership, queues, escrow, credits and attendance/refund bits. Names and category labels are immutable event-log data. The browser rebuilds its view from those logs and verifies owned seats against contract storage.

`EventInfo`, `Category` and `Order` are each packed into one storage slot. Owner entries mark allocation boundaries, with additional anchors every ten seats to guarantee bounded lookups even after overlapping resales. Attendance uses one bit per seat. No ERC-20 or ERC-721 is introduced: a freely transferable NFT would bypass the fixed-price market. ETH is the payment asset, not a project-issued investment token.

For each event, sales are open at `timestamp < salesEnd`; check-in is available at `salesEnd <= timestamp < checkInEnd`; no-show settlement starts at `checkInEnd`. Cancellation is possible only while sales are open, before any proceeds can leave. Creating more categories does not modify an existing category's supply or price.

| Operation       | Order and effects                                                                                           |
| --------------- | ----------------------------------------------------------------------------------------------------------- |
| Buy             | Exact `qty * (price + deposit)` payment; primary stock, then oldest seller orders, then prepaid buyer queue |
| Sell            | Validate ownership; serve oldest prepaid buyers, credit seller, escrow remaining consecutive seats          |
| Check in        | Organiser checks holder and unused seat range; bitmap marks seats; holder receives deposit credit           |
| Reclaim         | After sales close or cancellation, unfilled buyer escrow becomes credit or seller seats return              |
| Cancel/refund   | Each current holder receives price plus deposit once; escrowed sellers reclaim seats first                  |
| Withdraw        | Credit is cleared before sending ETH; failed delivery reverts the whole transaction                         |
| Settle no-shows | Organiser receives deposits for unused sold seats, at most 16 bitmap words per call                         |

Stock always precedes seller orders. Buyers can be waiting only when both primary stock and available seller orders are exhausted. Orders cannot be cancelled during sales, so live queues have no holes. After closing, reclamations can leave holes; the queues never reopen. Queue head/tail differences displayed after closure are historical bounds, not an active-order count.

Each call buys/sells/checks in/refunds at most ten seats. Primary purchases are consecutive. With eight seats per displayed row, alternating row direction puts a row-boundary group directly behind itself. This is an off-chain seating convention; real venues need a published, immutable seating plan. Resale fills may come from unrelated seats, and the interface explains this before purchase.

## Money and invariants

For a non-cancelled event the contract retains primary price proceeds until doors open, one deposit per sold but unconsumed/unsettled seat, unfilled buyer payments and all outstanding credits. A secondary buyer funds the seller's full price-plus-deposit credit; the original deposit remains reserved for the new holder. Resale never adds primary proceeds.

Example: a 0.01 ETH ticket with a 0.002 ETH deposit costs 0.012 ETH. A matched reseller gets 0.012 ETH credit. The new holder gets 0.002 ETH credit at check-in. The organiser gets 0.01 ETH once sales end. An unfilled buyer reclaims the full 0.012 ETH, separately from gas fees.

On cancellation, primary proceeds remain in the contract and decrease with each successful holder refund. Refund bits prevent repeat claims. A seller who already matched can withdraw their resale credit while the current holder refunds the ticket; both are funded because the secondary buyer supplied an additional payment. Zero price and zero deposit are supported. Zero supply is rejected.

State changes precede every external payment. Failed sends roll back credits, settlement cursors and refund markers. Matching itself makes no external calls. Regression tests cover failed recipients and reentry into withdrawals. No-show claims advance a cursor before payment; each word is settled exactly once. Large events remain settleable through repeated bounded calls.

## Stakeholders and incentives

| Stakeholder            | Benefit and intended behavior                                                         | Remaining incentive problem                                                           |
| ---------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Attendee               | Verifiable ownership, no seller counterparty risk, deposit refund for attendance      | Can still buy many seats through many wallets; crypto and gas UX remain burdens       |
| Reseller               | Recover original payment when plans change without finding/trusting a buyer           | Payment is unavailable until matched; seller may wait behind primary stock            |
| Organiser              | Public stock, automated settlement, fewer invalid/duplicate tickets, no-show deposits | Receives no-show deposits and may be tempted to deny honest check-ins                 |
| Gate operator          | Verifies wallet proof and seat validity before admission                              | Must honestly attest to physical attendance; organiser key security matters           |
| Validator/RPC operator | Ordinary blockchain fees and infrastructure use                                       | Ordering advantages, censorship, outages and misleading RPC responses remain possible |

Fixed-price resale and missing direct transfers reduce conventional markups. They do not make scalping impossible: side payments, selling private keys, delegated wallet control, multiple wallets and off-chain coordination remain possible. MAX_QTY is a transaction bound, not identity verification or a per-person cap. There is no claim that wallet transaction history reliably identifies scalpers.

## Oracle problem and gate protocol

The contract cannot observe physical presence. The organiser wallet is the attendance oracle. At the gate, the holder's wallet signs a human-readable EIP-191 gate pass binding chain ID, contract, holder, category, first seat, quantity, a five-minute expiry and a random 256-bit nonce, and shows it as a QR code or text. The gate needs no prior contact with the holder. It recovers the signer, requires it to equal the holder named in the pass, checks the expiry, current ownership and unused seats, then submits `consumeTicket`. Editing any field changes the recovered signer, so a pass cannot be typed up for, or re-targeted at, another wallet's seats. The on-chain bitmap prevents double admission across gates: once a pass's seats are used, every copy of it is rejected.

The remaining gap is a copied pass that is still unexpired and unused: whoever presents it first is admitted for those seats. The expiry bounds that window but cannot close it, because a signature proves control of a wallet, not who holds the phone. An earlier version had the gate issue a nonce for the holder to sign. That proves freshness to the gate, but needs a second exchange per attendee and the holder's address in advance, and leaves the same gap within its own window; the single holder-generated pass was chosen instead. Expiry uses the holder's device clock, and the gate tolerates one minute of clock skew. The gate accepts a QR image (decoded locally with jsQR, without uploading it to a server) or pasted pass text. EOA signatures are supported; EIP-1271 smart-contract-wallet proofs are future work.

This proof establishes control of a wallet, **not physical attendance or organiser honesty**. The contract deliberately preserves the supplied organiser-only check-in interface: an organiser can call it directly without presenting the off-chain signature. Preventing fraudulent attendance claims/denials would require independently authorised gate staff, a dispute mechanism or an attendance oracle with additional incentives. Even on-chain signature verification cannot prove someone entered a venue. Independent venue staff, signed receipts and an appeal process are operational mitigations; they are not implemented guarantees.

## Information and data segregation

Public: organiser/holder wallet addresses, prices, inventory, transfers through queues, transaction timing, attendance/refund markers and payment amounts. Everyone can independently inspect the matching rules and ownership history. Public activity can reveal attendance patterns and link wallets; pseudonyms are not privacy.

Not collected: names, email addresses, identity documents, biometrics or payment-card data. Gate passes and their signatures remain in the browsers/QR payload and are not written to chain. A production deployment should keep any required personal data in a separate access-controlled system, minimise retention and avoid placing personal data in event labels. Private-key management stays in the wallet; no application private-key database exists.

## Why blockchain, and limits

A conventional database can implement the same queue algorithm more cheaply and privately. The difference here is that matching, inventory, payments and ownership share a public ledger with rules enforced by a contract. Buyers and sellers do not need to trust a ticket exchange to maintain the order book or release escrow. A third-party frontend can read and use the same contract. That benefit depends on correct code and a sufficiently reliable chain/RPC, and does not remove trust in event delivery or gate staff.

Known limitations: transaction-order FCFS/MEV; no Sybil resistance; locked queues until closure; ETH volatility and gas; public attendance data; organiser discretion at the gate; no refunds for an event secretly abandoned after the cancellation window; no legal enforcement of event delivery; groups share a wallet and need its holder at check-in; no guarantee of adjacent resale seating; no recovery for lost keys; no independent security audit.

The educational frontend rescans logs in bounded RPC ranges and previews at most 128 seats per category. This is adequate for the demo, but a stadium deployment needs a reorg-aware indexer/cache, pagination and incremental subscriptions. No-show settlement is bounded on-chain, whereas the whole browser history still grows. Local demo time controls and unlocked signers are enabled only for localhost chain 31337. Public deployment must use `demo: false` and normal wallet approval.

Potential extensions: verifiable-random pre-order allocation with fully specified oracle failure behavior; independently staffed gate oracle and disputes; EIP-1271 proofs; accessible camera scanning; venue seating metadata commitments; event-delivery escrow; and privacy-preserving attendance credentials. None is represented as already implemented.
