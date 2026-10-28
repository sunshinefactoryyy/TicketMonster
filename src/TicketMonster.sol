// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * TicketMonster — school project implementation, based on the supplied v2 sketch.
 *
 * Changes from v1:
 *  - Assigned seats. Seats in a category are numbered 0..supply-1 and sold in order from the
 *    stock counter, so a group buying in one transaction gets consecutive seats. Seat numbers
 *    map to rows off-chain in a snake pattern, so a group that spills over the end of a row
 *    lands directly behind each other.
 *  - Seat ownership is stored once per block of seats (the ERC-721A trick): only the first
 *    seat of a block has an entry, and a seat with no entry belongs to the nearest earlier one.
 *    Periodic anchors bound lookups after overlapping resales.
 *  - Check-ins are a bitmap: one bit per seat, 256 seats per storage slot.
 *  - Resellers get price + deposit back; whoever holds the seat gets the deposit at check-in.
 *  - Queue orders cannot be cancelled while sales are open, so the queues never have gaps.
 *    Once sales close (or the event is cancelled), unfilled orders are unwound: queued buyers
 *    reclaim their escrow and queued sellers reclaim their seats.
 *  - Tickets cannot be transferred outside this contract. A group's seats stay with the
 *    buyer, who checks the group in together.
 *  - Deposits of no-shows go to the organiser after check-in closes. The contract counts
 *    check-ins from the bitmap in bounded batches, so check-ins pay nothing extra for it.
 *
 * Timeline per event (set salesEnd to when doors open, checkInEnd to after the event):
 *  - before salesEnd:          buy, sell; the organiser may cancel the event
 *  - salesEnd .. checkInEnd:   check-in; organiser can withdraw proceeds
 *  - from salesEnd:            unfilled queue orders can be reclaimed
 *  - from checkInEnd:          organiser claims no-show deposits
 */
contract TicketMonster {
    // ------------------------------------------------------------------
    // Types
    // ------------------------------------------------------------------

    struct EventInfo {
        // 1 slot: 160 + 40 + 40 + 8 bits
        address organiser;
        uint40 salesEnd; // doors open: trading stops, check-in starts
        uint40 checkInEnd; // check-in closes; unclaimed deposits go to the organiser
        bool cancelled;
    }

    struct Category {
        // 1 slot: 80 + 80 + 32 + 32 + 32 bits
        uint80 price; // wei
        uint80 deposit; // wei, refunded at check-in
        uint32 stock; // unsold seats; the next seat sold is (supply - stock)
        uint32 supply;
        uint32 eventId;
    }

    struct Order {
        // 1 slot: 160 + 32 + 32 bits
        address account;
        uint32 firstSeat; // sell orders: start of a block of consecutive seats held by the contract
        uint32 qty; // seats still unfilled
    }

    struct Queue {
        uint128 head; // next order to fill  ┐ same slot
        uint128 tail; // next free index     ┘
        mapping(uint256 => Order) orders;
    }

    // ------------------------------------------------------------------
    // Storage
    // ------------------------------------------------------------------

    uint256 public constant MAX_QTY = 10; // per call; also the longest block of seats
    uint256 public constant CLAIM_WORDS = 16; // bounded work per no-show settlement call

    uint256 public eventCount;
    uint256 public categoryCount;

    mapping(uint256 eventId => EventInfo) public events;
    mapping(uint256 categoryId => Category) public categories;
    mapping(uint256 eventId => uint256) public proceeds; // locked until salesEnd
    mapping(address => uint256) public credit; // withdrawable balances
    mapping(uint256 categoryId => bool) public noShowsClaimed;
    mapping(uint256 categoryId => uint256) public noShowNextWord;

    /// Seat owners, stored only at the first seat of each block (see ownerOf).
    mapping(uint256 categoryId => mapping(uint256 seat => address)) internal _owners;
    /// Check-in bitmap: seat s is bit (s % 256) of word (s / 256).
    mapping(uint256 categoryId => mapping(uint256 word => uint256)) internal _used;

    mapping(uint256 categoryId => Queue) internal _sellQueue;
    mapping(uint256 categoryId => Queue) internal _buyQueue;

    // ------------------------------------------------------------------
    // Logs and errors
    // ------------------------------------------------------------------

    event EventCreated(
        uint256 indexed eventId, address indexed organiser, string name, uint40 salesEnd, uint40 checkInEnd
    );
    event CategoryCreated(
        uint256 indexed eventId, uint256 indexed categoryId, string label, uint32 supply, uint80 price, uint80 deposit
    );
    /// Every change of seat ownership. from = address(0): primary sale; address(this): held in the seller queue.
    /// The front end rebuilds "my seats" from these logs.
    event Seats(uint256 indexed categoryId, address indexed from, address indexed to, uint256 firstSeat, uint256 qty);
    event Queued(uint256 indexed categoryId, address indexed account, bool isSell, uint256 index, uint256 qty);
    event CheckedIn(uint256 indexed categoryId, address indexed holder, uint256 firstSeat, uint256 qty);
    event EventCancelled(uint256 indexed eventId);
    event NoShowDepositsClaimed(uint256 indexed categoryId, uint256 noShows, uint256 amount);

    error NotOrganiser();
    error SalesClosed();
    error SalesStillOpen();
    error EventIsCancelled();
    error BadQuantity();
    error WrongPayment();
    error NotYourSeats();
    error AlreadyUsed();
    error NotYourOrder();
    error NotCancelled();
    error TransferFailed();
    error BadTimes();
    error CheckInClosed();
    error CheckInStillOpen();
    error AlreadyClaimed();
    error BadSupply();
    error EscrowedSeats();

    // ------------------------------------------------------------------
    // Organiser
    // ------------------------------------------------------------------

    function createEvent(string calldata name, uint40 salesEnd, uint40 checkInEnd) external returns (uint256 eventId) {
        if (salesEnd <= block.timestamp || checkInEnd <= salesEnd) revert BadTimes();
        if (eventCount == type(uint32).max) revert BadSupply();
        eventId = ++eventCount;
        events[eventId] = EventInfo(msg.sender, salesEnd, checkInEnd, false);
        emit EventCreated(eventId, msg.sender, name, salesEnd, checkInEnd);
    }

    function createTickets(uint256 eventId, string calldata label, uint32 supply, uint80 price, uint80 deposit)
        external
        returns (uint256 categoryId)
    {
        _onlyOrganiser(eventId);
        _requireSalesOpen(eventId);
        if (supply == 0) revert BadSupply();
        categoryId = ++categoryCount;
        categories[categoryId] = Category(price, deposit, supply, supply, uint32(eventId));
        emit CategoryCreated(eventId, categoryId, label, supply, price, deposit);
    }

    /// Check in a block of consecutive seats held by `holder`, e.g. a group arriving together.
    /// The holder proves wallet ownership off-chain (e.g. signs a QR challenge at the gate).
    function consumeTicket(uint256 categoryId, uint256 firstSeat, uint256 qty, address holder) external {
        if (holder == address(this) || holder == address(0)) revert EscrowedSeats();
        Category memory c = categories[categoryId];
        EventInfo memory e = events[c.eventId];
        if (e.organiser != msg.sender) revert NotOrganiser();
        if (e.cancelled) revert EventIsCancelled();
        if (block.timestamp < e.salesEnd) revert SalesStillOpen();
        // Closed after checkInEnd: a late check-in after the organiser has claimed the
        // no-show deposits would pay the same deposit twice.
        if (block.timestamp >= e.checkInEnd) revert CheckInClosed();
        _checkOwner(categoryId, c, firstSeat, qty, holder);
        _markUsed(categoryId, firstSeat, qty);
        credit[holder] += qty * c.deposit; // deposit refund
        emit CheckedIn(categoryId, holder, firstSeat, qty);
    }

    /// Replaces deleteEvent. Only before salesEnd, i.e. before proceeds can be withdrawn,
    /// so every refund is funded.
    function cancelEvent(uint256 eventId) external {
        _onlyOrganiser(eventId);
        _requireSalesOpen(eventId);
        events[eventId].cancelled = true;
        emit EventCancelled(eventId);
    }

    function withdrawProceeds(uint256 eventId) external {
        EventInfo memory e = events[eventId];
        if (e.organiser != msg.sender) revert NotOrganiser();
        if (e.cancelled) revert EventIsCancelled();
        if (block.timestamp < e.salesEnd) revert SalesStillOpen();
        uint256 amount = proceeds[eventId];
        proceeds[eventId] = 0;
        _send(msg.sender, amount);
    }

    /// After check-in closes, the organiser takes the deposits of every sold seat that was
    /// never checked in (including seats still sitting unsold in the seller queue).
    /// Each call settles at most CLAIM_WORDS bitmap words and advances a cursor. Repeat
    /// until noShowsClaimed is true. This bounds gas even for very large categories.
    function claimNoShowDeposits(uint256 categoryId) external {
        Category memory c = categories[categoryId];
        EventInfo memory e = events[c.eventId];
        if (e.organiser != msg.sender) revert NotOrganiser();
        if (e.cancelled) revert EventIsCancelled();
        if (block.timestamp < e.checkInEnd) revert CheckInStillOpen();
        if (noShowsClaimed[categoryId]) revert AlreadyClaimed();
        uint256 sold = uint256(c.supply) - c.stock;
        uint256 firstWord = noShowNextWord[categoryId];
        uint256 words = (sold + 255) / 256;
        uint256 endWord = firstWord + CLAIM_WORDS;
        if (endWord > words) endWord = words;
        uint256 checkedIn;
        mapping(uint256 => uint256) storage used = _used[categoryId];
        for (uint256 w = firstWord; w < endWord; ++w) {
            checkedIn += _countBits(used[w]);
        }
        noShowNextWord[categoryId] = endWord;
        noShowsClaimed[categoryId] = endWord == words;
        uint256 endSeat = endWord * 256;
        if (endSeat > sold) endSeat = sold;
        uint256 noShows = endSeat - firstWord * 256 - checkedIn;
        uint256 amount = noShows * c.deposit;
        emit NoShowDepositsClaimed(categoryId, noShows, amount);
        _send(msg.sender, amount);
    }

    // ------------------------------------------------------------------
    // Buyers and sellers
    // ------------------------------------------------------------------

    /// Pay qty * (price + deposit). Takes the next seats from stock (consecutive), then seats
    /// from the seller queue (oldest first, possibly not consecutive); anything unfilled joins
    /// the buyer queue with its payment held in escrow.
    function buyTicket(uint256 categoryId, uint256 qty) external payable {
        if (qty == 0 || qty > MAX_QTY) revert BadQuantity();
        Category memory c = categories[categoryId]; // one SLOAD
        _requireSalesOpen(c.eventId);
        uint256 unit = uint256(c.price) + c.deposit;
        if (msg.value != qty * unit) revert WrongPayment();

        // 1. Primary stock: the next n seats, with a starting entry and periodic anchor
        uint256 n = qty < c.stock ? qty : c.stock;
        if (n != 0) {
            uint256 first = c.supply - c.stock;
            _owners[categoryId][first] = msg.sender;
            // Keep an anchor every MAX_QTY seats even after overlapping resales.
            uint256 anchor = (first / MAX_QTY + 1) * MAX_QTY;
            if (anchor < first + n) _owners[categoryId][anchor] = msg.sender;
            c.stock -= uint32(n);
            categories[categoryId].stock = c.stock;
            proceeds[c.eventId] += n * c.price;
            emit Seats(categoryId, address(0), msg.sender, first, n);
        }

        // 2. Seller queue: each seller gets price + deposit back
        uint256 left = qty - n;
        if (left != 0) left -= _fillFromSellers(categoryId, c, left, unit);

        // 3. The rest waits in the buyer queue (stock and seller queue are both empty here)
        if (left != 0) _enqueue(_buyQueue[categoryId], categoryId, false, 0, left);
    }

    /// Sell a block of consecutive seats you hold, at price + deposit. Queued buyers are served
    /// first (they prepaid); the rest of the block is held by the contract in the seller queue.
    /// Seats that aren't consecutive are sold in separate calls. Orders are final until salesEnd.
    function sellTicket(uint256 categoryId, uint256 firstSeat, uint256 qty) external {
        if (qty == 0 || qty > MAX_QTY) revert BadQuantity();
        Category memory c = categories[categoryId];
        _requireSalesOpen(c.eventId);

        Queue storage q = _buyQueue[categoryId];
        uint256 head = q.head;
        uint256 tail = q.tail;
        uint256 seat = firstSeat;
        uint256 end = firstSeat + qty;
        while (seat < end && head < tail) {
            Order memory o = q.orders[head];
            uint256 take = end - seat;
            if (take >= o.qty) {
                take = o.qty;
                delete q.orders[head];
                unchecked {
                    ++head;
                }
            } else {
                q.orders[head].qty = o.qty - uint32(take); // partial fill, stays at the front
            }
            _moveSeats(categoryId, c, seat, take, msg.sender, o.account);
            seat += take;
        }
        q.head = uint128(head);

        uint256 sold = seat - firstSeat;
        if (sold != 0) credit[msg.sender] += sold * (uint256(c.price) + c.deposit);

        if (seat < end) {
            _moveSeats(categoryId, c, seat, end - seat, msg.sender, address(this));
            _enqueue(_sellQueue[categoryId], categoryId, true, seat, end - seat);
        }
    }

    /// After salesEnd (or cancellation), take back an unfilled order:
    /// queued buyers get their escrow back, queued sellers get their seats back.
    function reclaimOrder(uint256 categoryId, bool isSell, uint256 index) external {
        Category memory c = categories[categoryId];
        EventInfo memory e = events[c.eventId];
        if (!e.cancelled && block.timestamp < e.salesEnd) revert SalesStillOpen();
        Queue storage q = isSell ? _sellQueue[categoryId] : _buyQueue[categoryId];
        Order memory o = q.orders[index];
        if (o.account != msg.sender) revert NotYourOrder(); // filled orders are deleted
        delete q.orders[index];
        if (isSell) _moveSeats(categoryId, c, o.firstSeat, o.qty, address(this), msg.sender);
        else credit[msg.sender] += o.qty * (uint256(c.price) + c.deposit);
    }

    /// If the event is cancelled, each holder pulls price + deposit back for a block of seats.
    /// Sellers still in the queue call reclaimOrder first.
    function claimRefund(uint256 categoryId, uint256 firstSeat, uint256 qty) external {
        Category memory c = categories[categoryId];
        if (!events[c.eventId].cancelled) revert NotCancelled();
        _checkOwner(categoryId, c, firstSeat, qty, msg.sender);
        _markUsed(categoryId, firstSeat, qty); // each seat can be refunded once
        proceeds[c.eventId] -= qty * c.price;
        _send(msg.sender, qty * (uint256(c.price) + c.deposit));
    }

    function withdraw() external {
        uint256 amount = credit[msg.sender];
        credit[msg.sender] = 0; // state change before the external call
        _send(msg.sender, amount);
    }

    // ------------------------------------------------------------------
    // Views (free to call off-chain)
    // ------------------------------------------------------------------

    /// Owner of a sold seat: walk back to the nearest seat that has an entry.
    /// Blocks are at most MAX_QTY seats long, so this reads at most MAX_QTY slots.
    function ownerOf(uint256 categoryId, uint256 seat) external view returns (address) {
        Category memory c = categories[categoryId];
        if (seat >= uint256(c.supply) - c.stock) return address(0); // not sold yet
        return _walkBack(_owners[categoryId], seat);
    }

    function isCheckedIn(uint256 categoryId, uint256 seat) external view returns (bool) {
        return _used[categoryId][seat >> 8] & (1 << (seat & 255)) != 0;
    }

    function queueBounds(uint256 categoryId, bool isSell) external view returns (uint256 head, uint256 tail) {
        Queue storage q = isSell ? _sellQueue[categoryId] : _buyQueue[categoryId];
        return (q.head, q.tail);
    }

    function orderAt(uint256 categoryId, bool isSell, uint256 index) external view returns (Order memory) {
        return (isSell ? _sellQueue[categoryId] : _buyQueue[categoryId]).orders[index];
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    function _fillFromSellers(uint256 categoryId, Category memory c, uint256 want, uint256 unit)
        internal
        returns (uint256 filled)
    {
        Queue storage q = _sellQueue[categoryId];
        uint256 head = q.head;
        uint256 tail = q.tail; // same slot as head
        while (filled < want && head < tail) {
            Order memory o = q.orders[head];
            uint256 take = want - filled;
            if (take >= o.qty) {
                take = o.qty;
                delete q.orders[head];
                unchecked {
                    ++head;
                }
            } else {
                // partial fill: the buyer takes the front of the block, the rest stays queued
                q.orders[head] = Order(o.account, o.firstSeat + uint32(take), o.qty - uint32(take));
            }
            _moveSeats(categoryId, c, o.firstSeat, take, address(this), msg.sender);
            credit[o.account] += take * unit;
            filled += take;
        }
        q.head = uint128(head);
    }

    function _enqueue(Queue storage q, uint256 categoryId, bool isSell, uint256 firstSeat, uint256 qty) internal {
        uint256 index = q.tail;
        q.orders[index] = Order(msg.sender, uint32(firstSeat), uint32(qty));
        q.tail = uint128(index + 1);
        emit Queued(categoryId, msg.sender, isSell, index, qty);
    }

    /// Move seats [first, first + qty) from `from` to `to`, writing as few slots as possible.
    function _moveSeats(uint256 categoryId, Category memory c, uint256 first, uint256 qty, address from, address to)
        internal
    {
        _checkOwner(categoryId, c, first, qty, from);
        mapping(uint256 => address) storage owners = _owners[categoryId];
        uint256 end = first + qty;
        // The seat after the block may have relied on our entry; pin it to its current owner.
        if (end < uint256(c.supply) - c.stock && owners[end] == address(0)) owners[end] = from;
        owners[first] = to;
        for (uint256 s = first + 1; s < end; ++s) {
            if (s % MAX_QTY == 0) owners[s] = to;
            else if (owners[s] != address(0)) delete owners[s];
        }
        emit Seats(categoryId, from, to, first, qty);
    }

    /// Reverts unless every seat in [first, first + qty) is sold and owned by `holder`.
    function _checkOwner(uint256 categoryId, Category memory c, uint256 first, uint256 qty, address holder)
        internal
        view
    {
        if (qty == 0 || qty > MAX_QTY) revert BadQuantity();
        uint256 end = first + qty;
        if (qty == 0 || end > uint256(c.supply) - c.stock) revert NotYourSeats();
        mapping(uint256 => address) storage owners = _owners[categoryId];
        if (_walkBack(owners, first) != holder) revert NotYourSeats();
        for (uint256 s = first + 1; s < end; ++s) {
            address o = owners[s];
            if (o != address(0) && o != holder) revert NotYourSeats();
        }
    }

    /// Seat 0 always has an entry once sold, and every block starts with one, so this terminates.
    function _walkBack(mapping(uint256 => address) storage owners, uint256 seat) internal view returns (address o) {
        while ((o = owners[seat]) == address(0)) --seat;
    }

    /// Set the check-in bit for each seat. Seats in the same 256-seat word share one slot,
    /// so after the first bit in a word, each extra seat is a cheap update.
    function _markUsed(uint256 categoryId, uint256 first, uint256 qty) internal {
        mapping(uint256 => uint256) storage used = _used[categoryId];
        for (uint256 s = first; s < first + qty; ++s) {
            uint256 bit = 1 << (s & 255);
            uint256 word = used[s >> 8];
            if (word & bit != 0) revert AlreadyUsed();
            used[s >> 8] = word | bit;
        }
    }

    /// Number of 1-bits in x. Each pass clears the lowest set bit (Kernighan's trick),
    /// so a word with k check-ins takes k passes.
    function _countBits(uint256 x) internal pure returns (uint256 n) {
        unchecked {
            while (x != 0) {
                x &= x - 1;
                ++n;
            }
        }
    }

    function _onlyOrganiser(uint256 eventId) internal view {
        if (events[eventId].organiser != msg.sender) revert NotOrganiser();
    }

    function _requireSalesOpen(uint256 eventId) internal view {
        EventInfo memory e = events[eventId];
        if (e.organiser == address(0) || block.timestamp >= e.salesEnd) revert SalesClosed();
        if (e.cancelled) revert EventIsCancelled();
    }

    function _send(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
