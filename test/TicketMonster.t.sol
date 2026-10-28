// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/TicketMonster.sol";

contract Harness is TicketMonster {
    function ownerReads(uint256 categoryId, uint256 seat) external view returns (uint256 reads) {
        reads = 1;
        while (_owners[categoryId][seat] == address(0)) {
            --seat;
            ++reads;
        }
    }

    function countBits(uint256 x) external pure returns (uint256) {
        return _countBits(x);
    }
}

contract TicketMonsterTest is Test {
    TicketMonster tm;
    address org = makeAddr("organiser"); // (0x0A is a precompile, which rejects ETH)
    address A = address(0xA1);
    address B = address(0xB1);
    address C = address(0xC1);
    address D = address(0xD1);
    address E = address(0xE1);
    uint80 P = 0.1 ether;
    uint80 DEP = 0.02 ether;
    uint256 U = 0.12 ether;
    uint256 cat;
    uint40 salesEnd;
    uint40 checkInEnd;

    function setUp() public {
        tm = new TicketMonster();
        salesEnd = uint40(block.timestamp + 1 days);
        checkInEnd = salesEnd + 1 days;
        vm.prank(org);
        uint256 ev = tm.createEvent("Concert", salesEnd, checkInEnd);
        vm.prank(org);
        cat = tm.createTickets(ev, "Cat A", 6, P, DEP);
        for (uint160 i = 0xA1; i <= 0xE1; i += 0x10) {
            vm.deal(address(i), 10 ether);
        }
    }

    function buy(address who, uint256 qty) internal {
        vm.prank(who);
        tm.buyTicket{value: qty * U}(cat, qty);
    }

    function test_fullFlow() public {
        buy(A, 4); // seats 0-3
        buy(B, 2); // seats 4-5, sold out
        for (uint256 s; s < 4; ++s) {
            assertEq(tm.ownerOf(cat, s), A);
        }
        assertEq(tm.ownerOf(cat, 5), B);

        // A sells seats 1-2: no queued buyers, so they go to the seller queue
        vm.prank(A);
        tm.sellTicket(cat, 1, 2);
        assertEq(tm.ownerOf(cat, 0), A);
        assertEq(tm.ownerOf(cat, 1), address(tm));
        assertEq(tm.ownerOf(cat, 2), address(tm));
        assertEq(tm.ownerOf(cat, 3), A);

        // C buys 1: gets seat 1 (partial fill of A's order)
        buy(C, 1);
        assertEq(tm.ownerOf(cat, 1), C);
        assertEq(tm.ownerOf(cat, 2), address(tm));
        assertEq(tm.credit(A), U); // price + deposit back

        // D buys 3: gets seat 2 from the queue, 2 seats wait in the buyer queue
        buy(D, 3);
        assertEq(tm.ownerOf(cat, 2), D);
        (uint256 h, uint256 t) = tm.queueBounds(cat, false);
        assertEq(t - h, 1);

        // A can't sell a seat that isn't theirs; B sells 4-5 to D
        vm.prank(A);
        vm.expectRevert(TicketMonster.NotYourSeats.selector);
        tm.sellTicket(cat, 4, 1);
        vm.prank(B);
        tm.sellTicket(cat, 4, 2);
        assertEq(tm.ownerOf(cat, 4), D);
        assertEq(tm.ownerOf(cat, 5), D);
        assertEq(tm.credit(B), 2 * U);

        // E buys 1: everything is gone, so E waits in the buyer queue; can't reclaim yet
        buy(E, 1);
        vm.prank(E);
        vm.expectRevert(TicketMonster.SalesStillOpen.selector);
        tm.reclaimOrder(cat, false, 1);

        // Sales close: E reclaims escrow, check-in starts
        vm.warp(salesEnd);
        vm.prank(E);
        tm.reclaimOrder(cat, false, 1);
        assertEq(tm.credit(E), U);

        vm.prank(org);
        tm.consumeTicket(cat, 4, 2, D); // D's group of two
        assertTrue(tm.isCheckedIn(cat, 4) && tm.isCheckedIn(cat, 5));
        assertEq(tm.credit(D), 2 * DEP);
        vm.prank(org);
        vm.expectRevert(TicketMonster.AlreadyUsed.selector);
        tm.consumeTicket(cat, 5, 1, D);
        vm.prank(org);
        vm.expectRevert(TicketMonster.NotYourSeats.selector);
        tm.consumeTicket(cat, 0, 2, A); // seat 1 belongs to C now

        // Organiser gets primary sales only: 6 seats * price
        uint256 before = org.balance;
        vm.prank(org);
        tm.withdrawProceeds(1);
        assertEq(org.balance - before, 6 * uint256(P));
    }

    function test_unfilledSellerGetsSeatsBackAtSalesEnd() public {
        buy(A, 3);
        vm.prank(A);
        tm.sellTicket(cat, 0, 3); // stock still > 0, so the order just waits
        assertEq(tm.ownerOf(cat, 0), address(tm));
        vm.warp(salesEnd);
        vm.prank(A);
        tm.reclaimOrder(cat, true, 0);
        for (uint256 s; s < 3; ++s) {
            assertEq(tm.ownerOf(cat, s), A);
        }
        vm.prank(org);
        tm.consumeTicket(cat, 0, 3, A);
    }

    function test_cancelAndRefund() public {
        buy(A, 2);
        buy(B, 4); // sold out
        buy(C, 1); // queued buyer
        vm.prank(B);
        tm.sellTicket(cat, 2, 1); // goes straight to C
        vm.prank(org);
        tm.cancelEvent(1);

        uint256 a0 = A.balance;
        vm.prank(A);
        tm.claimRefund(cat, 0, 2);
        assertEq(A.balance - a0, 2 * U);
        vm.prank(A);
        vm.expectRevert(TicketMonster.AlreadyUsed.selector);
        tm.claimRefund(cat, 0, 2);

        vm.prank(C);
        tm.claimRefund(cat, 2, 1);
        vm.prank(B);
        tm.claimRefund(cat, 3, 3);
        vm.prank(B);
        tm.withdraw(); // B's resale income
        // Every refund and payout was funded, and nothing is left over
        assertEq(address(tm).balance, 0);
    }

    function test_noShowDepositsGoToOrganiser() public {
        buy(A, 4); // seats 0-3
        buy(B, 2); // seats 4-5, B never shows up
        vm.warp(salesEnd);
        vm.prank(org);
        tm.consumeTicket(cat, 0, 4, A);

        vm.prank(org);
        vm.expectRevert(TicketMonster.CheckInStillOpen.selector);
        tm.claimNoShowDeposits(cat);

        vm.warp(checkInEnd);
        vm.prank(org);
        vm.expectRevert(TicketMonster.CheckInClosed.selector);
        tm.consumeTicket(cat, 4, 2, B); // too late

        uint256 before = org.balance;
        vm.prank(org);
        tm.claimNoShowDeposits(cat);
        assertEq(org.balance - before, 2 * uint256(DEP)); // B's two deposits

        vm.prank(org);
        vm.expectRevert(TicketMonster.AlreadyClaimed.selector);
        tm.claimNoShowDeposits(cat);

        // What's left is exactly A's deposit refunds plus the organiser's proceeds
        assertEq(address(tm).balance, tm.credit(A) + tm.proceeds(1));
    }

    function test_noShowCountSpansBitmapWords() public {
        vm.prank(org);
        uint256 big = tm.createTickets(1, "Floor", 300, P, DEP);
        for (uint256 i; i < 30; ++i) {
            // 30 buyers x 10 seats = seats 0-299
            address who = address(uint160(0x1000 + i));
            vm.deal(who, 2 ether);
            vm.prank(who);
            tm.buyTicket{value: 10 * U}(big, 10);
        }
        vm.warp(salesEnd);
        for (uint256 i; i < 27; ++i) {
            // seats 0-269 check in: word 0 completely full
            vm.prank(org);
            tm.consumeTicket(big, i * 10, 10, address(uint160(0x1000 + i)));
        }
        vm.warp(checkInEnd);
        uint256 before = org.balance;
        vm.prank(org);
        tm.claimNoShowDeposits(big);
        assertEq(org.balance - before, 30 * uint256(DEP)); // 3 groups of 10 never came
    }

    function testFuzz_countBits(uint256 x) public {
        Harness h = new Harness();
        uint256 naive;
        for (uint256 i; i < 256; ++i) {
            if ((x >> i) & 1 == 1) ++naive;
        }
        assertEq(h.countBits(x), naive);
    }

    function test_overlappingResalesKeepOwnershipWalkBounded() public {
        Harness h = new Harness();
        vm.prank(org);
        h.createEvent("Anchors", salesEnd, checkInEnd);
        vm.prank(org);
        uint256 id = h.createTickets(1, "Floor", 30, 0, 0);
        for (uint256 i; i < 3; ++i) {
            vm.prank(A);
            h.buyTicket(id, 10);
        }
        // Moving overlapping ranges used to erase earlier allocation boundaries.
        for (uint256 i; i < 21; ++i) {
            vm.prank(A);
            h.sellTicket(id, i, 10);
            vm.prank(A);
            h.buyTicket(id, 10);
        }
        for (uint256 s; s < 30; ++s) {
            assertEq(h.ownerOf(id, s), A);
            assertLe(h.ownerReads(id, s), 10);
        }
    }

    function test_escrowCannotCheckInAndTrapDeposit() public {
        buy(A, 3);
        vm.prank(A);
        tm.sellTicket(cat, 0, 3);
        vm.warp(salesEnd);
        vm.prank(org);
        vm.expectRevert(TicketMonster.EscrowedSeats.selector);
        tm.consumeTicket(cat, 0, 3, address(tm));
        vm.prank(A);
        tm.reclaimOrder(cat, true, 0);
        vm.prank(org);
        tm.consumeTicket(cat, 0, 3, A);
        assertEq(tm.credit(A), 3 * uint256(DEP));
    }

    function test_rejectZeroSupplyAndBadQuantities() public {
        vm.prank(org);
        vm.expectRevert(TicketMonster.BadSupply.selector);
        tm.createTickets(1, "Empty", 0, P, DEP);
        vm.expectRevert(TicketMonster.BadQuantity.selector);
        tm.buyTicket(cat, 0);
        vm.expectRevert(TicketMonster.BadQuantity.selector);
        tm.buyTicket(cat, 11);
        vm.expectRevert(TicketMonster.SalesClosed.selector);
        tm.buyTicket(999, 1);
        vm.prank(A);
        vm.expectRevert(TicketMonster.WrongPayment.selector);
        tm.buyTicket{value: U - 1}(cat, 1);
    }

    function test_onlyOrganiserAndExactTimeBoundaries() public {
        buy(A, 2);
        vm.prank(A);
        vm.expectRevert(TicketMonster.NotOrganiser.selector);
        tm.cancelEvent(1);
        vm.prank(org);
        vm.expectRevert(TicketMonster.SalesStillOpen.selector);
        tm.withdrawProceeds(1);
        vm.prank(org);
        vm.expectRevert(TicketMonster.SalesStillOpen.selector);
        tm.consumeTicket(cat, 0, 1, A);
        vm.warp(salesEnd);
        vm.prank(org);
        vm.expectRevert(TicketMonster.SalesClosed.selector);
        tm.cancelEvent(1);
        vm.prank(A);
        vm.expectRevert(TicketMonster.SalesClosed.selector);
        tm.sellTicket(cat, 0, 1);
        vm.prank(B);
        vm.expectRevert(TicketMonster.SalesClosed.selector);
        tm.buyTicket{value: U}(cat, 1);
        vm.prank(B);
        vm.expectRevert(TicketMonster.NotOrganiser.selector);
        tm.consumeTicket(cat, 0, 1, A);
        vm.prank(org);
        tm.consumeTicket(cat, 0, 1, A);
        vm.warp(checkInEnd);
        vm.prank(org);
        vm.expectRevert(TicketMonster.CheckInClosed.selector);
        tm.consumeTicket(cat, 1, 1, A);
    }

    function test_fifoBuyerPartialFillAndAtomicRollback() public {
        buy(A, 6);
        buy(B, 3);
        buy(C, 2);
        vm.prank(A);
        tm.sellTicket(cat, 0, 2);
        assertEq(tm.ownerOf(cat, 0), B);
        assertEq(tm.orderAt(cat, false, 0).qty, 1);
        vm.prank(D);
        vm.expectRevert(TicketMonster.NotYourSeats.selector);
        tm.sellTicket(cat, 2, 4);
        assertEq(tm.orderAt(cat, false, 0).qty, 1);
        assertEq(tm.orderAt(cat, false, 1).qty, 2);
        vm.prank(A);
        tm.sellTicket(cat, 2, 4);
        assertEq(tm.ownerOf(cat, 2), B);
        assertEq(tm.ownerOf(cat, 3), C);
        assertEq(tm.ownerOf(cat, 4), C);
        assertEq(tm.ownerOf(cat, 5), address(tm));
        assertEq(tm.credit(A), 5 * U);
    }

    function test_primaryStockHasPriorityOverSellers() public {
        buy(A, 2);
        vm.prank(A);
        tm.sellTicket(cat, 0, 2);
        buy(B, 5);
        assertEq(tm.ownerOf(cat, 2), B);
        assertEq(tm.ownerOf(cat, 5), B);
        assertEq(tm.ownerOf(cat, 0), B);
        assertEq(tm.ownerOf(cat, 1), address(tm));
        assertEq(tm.credit(A), U);
        assertEq(tm.orderAt(cat, true, 0).firstSeat, 1);
    }

    function test_cancelledQueuesReclaimAndAllLiabilitiesSettle() public {
        buy(A, 6);
        buy(B, 4);
        vm.prank(A);
        tm.sellTicket(cat, 0, 2);
        vm.prank(org);
        tm.cancelEvent(1);
        vm.prank(B);
        tm.reclaimOrder(cat, false, 0);
        vm.prank(B);
        vm.expectRevert(TicketMonster.NotYourOrder.selector);
        tm.reclaimOrder(cat, false, 0);
        vm.prank(A);
        tm.claimRefund(cat, 2, 4);
        vm.prank(B);
        tm.claimRefund(cat, 0, 2);
        assertEq(tm.proceeds(1), 0);
        vm.prank(A);
        tm.withdraw();
        vm.prank(B);
        tm.withdraw();
        assertEq(address(tm).balance, 0);
    }

    function test_cancelledSellerReclaimsThenRefunds() public {
        buy(A, 3);
        vm.prank(A);
        tm.sellTicket(cat, 1, 2);
        vm.prank(org);
        tm.cancelEvent(1);
        vm.prank(A);
        tm.reclaimOrder(cat, true, 0);
        vm.prank(A);
        tm.claimRefund(cat, 0, 3);
        assertEq(address(tm).balance, 0);
        assertEq(tm.proceeds(1), 0);
    }

    function test_batchedNoShowClaimPaysEachSeatExactlyOnce() public {
        vm.prank(org);
        uint256 large = tm.createTickets(1, "Stadium", 4100, 0, 1);
        for (uint256 i; i < 410; ++i) {
            vm.prank(A);
            tm.buyTicket{value: 10}(large, 10);
        }
        vm.warp(salesEnd);
        vm.prank(org);
        tm.consumeTicket(large, 4094, 6, A); // spans batch boundary
        vm.warp(checkInEnd);
        uint256 before = org.balance;
        vm.prank(org);
        tm.claimNoShowDeposits(large);
        assertFalse(tm.noShowsClaimed(large));
        assertEq(tm.noShowNextWord(large), 16);
        assertEq(org.balance - before, 4094);
        vm.prank(org);
        tm.claimNoShowDeposits(large);
        assertTrue(tm.noShowsClaimed(large));
        assertEq(org.balance - before, 4094);
        assertEq(address(tm).balance, 6);
        vm.prank(A);
        tm.withdraw();
        assertEq(address(tm).balance, 0);
    }

    function testFuzz_splitResalePreservesAllNeighbours(uint8 start, uint8 count) public {
        uint256 first = bound(start, 0, 5);
        uint256 qty = bound(count, 1, 6 - first);
        buy(A, 6);
        vm.prank(A);
        tm.sellTicket(cat, first, qty);
        buy(B, qty);
        for (uint256 s; s < 6; ++s) {
            assertEq(tm.ownerOf(cat, s), s >= first && s < first + qty ? B : A);
        }
        assertEq(tm.credit(A), qty * U);
        assertEq(address(tm).balance, tm.proceeds(1) + 6 * uint256(DEP) + tm.credit(A));
    }
}
