// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/TicketMonster.sol";

contract Receiver {
    TicketMonster public tm;
    bool public reject;
    bool public reenter;
    bool private entered;

    constructor(TicketMonster contract_) {
        tm = contract_;
    }

    function buy() external payable {
        tm.buyTicket{value: msg.value}(1, 1);
    }

    function sell() external {
        tm.sellTicket(1, 0, 1);
    }

    function withdraw(bool reject_, bool reenter_) external {
        reject = reject_;
        reenter = reenter_;
        tm.withdraw();
    }

    receive() external payable {
        require(!reject, "reject ETH");
        if (reenter && !entered) {
            entered = true;
            tm.withdraw();
        }
    }
}

contract PaymentTest is Test {
    function test_failedWithdrawalRestoresCreditAndReentrancyCannotDoublePay() public {
        TicketMonster tm = new TicketMonster();
        Receiver holder = new Receiver(tm);
        tm.createEvent("Payment test", uint40(block.timestamp + 1 days), uint40(block.timestamp + 2 days));
        tm.createTickets(1, "One", 1, 1 ether, 0.1 ether);
        vm.deal(address(this), 10 ether);
        holder.buy{value: 1.1 ether}();
        holder.sell();
        tm.buyTicket{value: 1.1 ether}(1, 1);
        vm.expectRevert(TicketMonster.TransferFailed.selector);
        holder.withdraw(true, false);
        assertEq(tm.credit(address(holder)), 1.1 ether);
        holder.withdraw(false, true);
        assertEq(address(holder).balance, 1.1 ether);
        assertEq(tm.credit(address(holder)), 0);
        assertEq(address(tm).balance, 1.1 ether);
    }
}
