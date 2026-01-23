import mongoose, { ClientSession } from 'mongoose';
import Auction, { AuctionStatus, IAuction, IParticipant } from '../models/Auction';
import Bid from '../models/Bid';
import User from '../models/User';
import Transaction, { TransactionType } from '../models/Transaction';




export class AuctionService {
    /**
     * Place a bid on an auction (Battle Royale Style).
     */
    async placeBid(auctionId: string, userId: string, amount: number): Promise<{ success: boolean; message: string; bidId?: string; auction?: IAuction }> {
        const session: ClientSession = await mongoose.startSession();
        session.startTransaction();

        try {
            // 1. Fetch User & Auction
            const user = await User.findById(userId).session(session);
            const auction = await Auction.findById(auctionId).session(session);

            if (!user || !auction) throw new Error('User or Auction not found');
            if (auction.status !== AuctionStatus.ACTIVE) throw new Error('Auction is not active');
            if (new Date() > auction.endsAt) throw new Error('Auction has ended');

            // 2. Validate Bid
            // If full, must beat the last person
            const isFull = auction.participants.length >= auction.maxParticipants;
            const step = auction.minBidStep || 0;
            const minToBeatTop = (auction.currentPrice || auction.startPrice) + step;

            if (amount < minToBeatTop) {
                throw new Error(`Invalid bid. Every bid must beat the current leader. Minimum required: $${minToBeatTop}.`);
            }
            // Basic balance check
            if (user.wallet.available < amount) {
                throw new Error('Insufficient funds');
            }

            // 3. User Financials (Lock Funds)
            user.wallet.available -= amount;
            user.wallet.locked += amount;
            await user.save({ session });

            // 4. Update Auction State (In-Memory Sort & Evict)
            const newParticipant: IParticipant = {
                userId: user._id as any,
                username: user.username,
                amount: amount,
                bidTime: new Date()
            };

            // Check if user is already participating? 
            // The prompt implies "New Bid" is a distinct entry, but typically in these games 
            // you might update your EXISTING bid. 
            // "Telegram: one account can participate... restrictions? No."
            // "Your bid (15 of 1000)". 
            // Let's assume for this version: ONE ACTIVE BID PER USER per round.
            // If user exists, we remove old entry and add new (Upgrade).
            // Logic: Refund old bid amount, Lock new amount.

            const existingIndex = auction.participants.findIndex(p => p.userId.toString() === userId);
            if (existingIndex !== -1) {
                // Upgrade Logic: Unlock old amount
                const oldAmount = auction.participants[existingIndex].amount;
                user.wallet.locked -= oldAmount;
                user.wallet.available += oldAmount; // Refund old lock
                // We already locked the NEW amount above.
                // Remove old entry
                auction.participants.splice(existingIndex, 1);
                // Need to save user again? Yes.
                await user.save({ session });
            }

            // Insert new
            auction.participants.push(newParticipant);

            // Sort DESC
            auction.participants.sort((a, b) => b.amount - a.amount);

            // Eviction (Push-out)
            let evictedUser = null;
            if (auction.participants.length > auction.maxParticipants) {
                const evicted = auction.participants.pop(); // Remove last
                if (evicted) {
                    // Logic: Refund this user immediately
                    // Since this might NOT be the current user, we load specific user doc
                    if (evicted.userId.toString() === userId) {
                        // User evicted themselves? (Shouldn't happen if sorted properly and bid > minEntry)
                        // But strictly safely:
                        user.wallet.locked -= evicted.amount;
                        user.wallet.available += evicted.amount;
                        await user.save({ session });
                    } else {
                        const loser = await User.findById(evicted.userId).session(session);
                        if (loser) {
                            loser.wallet.locked -= evicted.amount;
                            loser.wallet.available += evicted.amount;
                            await loser.save({ session });
                            evictedUser = loser.username;
                        }
                    }
                }
            }

            // 5. Update Computed Fields
            auction.currentPrice = auction.participants.length > 0 ? auction.participants[0].amount : 0;

            const winIndex = Math.min(auction.participants.length, auction.winnersCount) - 1;
            auction.minWinPrice = winIndex >= 0 ? auction.participants[winIndex].amount : 0;

            const entryIndex = Math.min(auction.participants.length, auction.maxParticipants) - 1;
            auction.minEntryPrice = entryIndex >= 0 ? auction.participants[entryIndex].amount : 0;

            // 6. Anti-Sniping Logic
            const now = new Date();
            const timeRemainingMs = auction.endsAt.getTime() - now.getTime();
            const windowMs = (auction.antiSnipingWindowSec || 0) * 1000;

            if (timeRemainingMs > 0 && timeRemainingMs < windowMs) {
                const extensionMs = (auction.antiSnipingExtensionSec || 0) * 1000;
                auction.endsAt = new Date(auction.endsAt.getTime() + extensionMs);
                console.log(`⏳ Anti-sniping: Auction ${auction._id} extended by ${auction.antiSnipingExtensionSec}s`);
            }

            await auction.save({ session });

            // 7. Commit
            await session.commitTransaction();

            // 8. Event
            const { io } = require('../app');
            if (io) {
                const rank = auction.participants.findIndex(p => p.userId.toString() === userId) + 1;
                io.emit('bid_placed', {
                    auctionId: auction._id,
                    newPrice: auction.currentPrice,
                    leader: auction.participants[0].username,
                    bidder: user.username,
                    amount: amount,
                    rank: rank,
                    participantsCount: auction.participants.length,
                    endsAt: auction.endsAt,
                    minEntry: auction.minEntryPrice,
                    minWin: auction.minWinPrice
                });

                // Socket.io Notification for Outbid users
                if (evictedUser) {
                    // In a real app, we would emit to a specific ROOM based on userId
                    io.emit('notification', {
                        type: 'outbid',
                        message: `You were outbid in "${auction.title}"!`,
                        auctionId: auction._id
                    });
                }
            }

            return { success: true, message: 'Bid placed', bidId: 'ok', auction };

        } catch (error: any) {
            await session.abortTransaction();
            console.error('Bid Failed:', error.message);
            // If it's a version error, simplified refetch suggestion
            return { success: false, message: error.message };
        } finally {
            session.endSession();
        }
    }

    async createAuction(title: string, startPrice: number, durationMinutes: number, config: Partial<IAuction> = {}) {
        const endsAt = new Date(Date.now() + durationMinutes * 60 * 1000);
        return await Auction.create({
            title,
            startPrice,
            currentPrice: startPrice,
            minEntryPrice: startPrice,
            minWinPrice: startPrice,
            endsAt,
            status: AuctionStatus.ACTIVE,
            roundIndex: 1,
            totalRounds: 50,
            participants: [],
            durationMinutes,
            // Inherit config
            maxParticipants: config.maxParticipants || 1000,
            winnersCount: config.winnersCount || 20,
            minBidStep: config.minBidStep || 0.01,
            reservePrice: config.reservePrice || 0,
            antiSnipingWindowSec: config.antiSnipingWindowSec || 60,
            antiSnipingExtensionSec: config.antiSnipingExtensionSec || 60,
            commissionRate: config.commissionRate || 0.05,
            sellerId: config.sellerId
        });
    }
}
