# Requirement and verification map

Sources: supplied `TicketMonster.sol` and `TicketMonster.t.sol`, 10 October revised diagram, chat export through 27 October, and Lecture 5 pages 38–41. Older off-chain/credit-score ideas are resolved explicitly in DESIGN.md.

| Requirement                                           | Implementation                                                      | Verification                                                                   |
| ----------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Create events/categories, organiser permissions       | `createEvent`, `createTickets`, studio forms                        | original full-flow setup; permission/time/invalid-supply tests; browser studio |
| Primary stock before resale                           | `buyTicket`                                                         | `test_primaryStockHasPriorityOverSellers`                                      |
| FIFO buyers/sellers, partial fills, exact escrow      | `buyTicket`, `sellTicket`, queue views                              | supplied full flow; FIFO rollback, primary priority and fuzz split tests       |
| Assigned seats, compact storage, bounded reads        | `_owners`, periodic anchors, `ownerOf`                              | supplied flow; overlapping-resale bounded-read regression                      |
| Snake rows and group UI                               | `web/domain.js`, seat map and ticket groups                         | domain tests and browser rendering                                             |
| No direct transfers                                   | no transfer or approval entrypoint                                  | contract ABI/source review                                                     |
| No cancellation of live orders                        | `reclaimOrder` lifecycle guard                                      | supplied full flow and seller reclaim tests                                    |
| Reclaim unfilled buyer/seller orders                  | `reclaimOrder`                                                      | supplied flow; cancellation queue tests                                        |
| Deposit check-in, no duplicate consumption            | `consumeTicket`, bitmap                                             | supplied full flow; escrow regression; exact-time checks                       |
| Wallet ownership proof at gate                        | nonce, EIP-191 signature, QR, gate validation                       | signature-domain tests; browser gate walkthrough                               |
| Proceeds only after sales end                         | `withdrawProceeds`                                                  | supplied full flow; permission/time test                                       |
| Cancellation refunds fully funded                     | `cancelEvent`, `claimRefund`, proceeds accounting                   | original refund test; queue cancellation and seller reclamation tests          |
| No-show payouts once after check-in                   | bitmap popcount + bounded cursor                                    | supplied no-show tests; batch-boundary regression                              |
| Safe ETH delivery                                     | effects before interaction                                          | rejected receiver and reentrant withdrawal test                                |
| Reproducible demonstration                            | pinned dependencies/compiler, vendored test library, `npm run demo` | build/tests; browser against local Anvil                                       |
| Incentives, information, trust and oracle assumptions | DESIGN.md stakeholder/oracle sections                               | mapped to Lecture 5 pages 38–40                                                |
| Token need/tokenomics and segregation                 | DESIGN.md token/privacy sections                                    | mapped to Lecture 5 page 41                                                    |
| Limitations and pragmatic scope                       | DESIGN.md; DEMO.md                                                  | explicit implemented/future distinction                                        |

`npm run check` compiles the current source and runs both Solidity and Node tests. Generated ABI and deployment configuration are ignored and rebuilt. Browser integration must use the freshly deployed artifact. Public network deployment, camera capture, verifiable randomness and a credit-score system are not claimed as deliverables of the agreed v2 design.
