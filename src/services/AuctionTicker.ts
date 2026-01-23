import mongoose from 'mongoose';
import { connectDB } from '../infra/db';
import Auction, { AuctionStatus } from '../models/Auction';
import { AuctionService } from './AuctionService';
import { io } from '../app';

export class AuctionTicker {
    private service: AuctionService;
    private io: any;

    constructor(ioInstance: any) {
        this.service = new AuctionService();
        this.io = ioInstance;
    }

    start() {
        console.log('⏱️ Auction Ticker Started');
        setInterval(() => this.tick(), 5000); // Check every 5 sec
    }

    async tick() {
        try {
            const now = new Date();

            // 1. PREVIEW -> ACTIVE
            const previews = await Auction.find({
                status: AuctionStatus.PREVIEW,
                createdAt: { $lt: new Date(now.getTime() - 1000 * 5) }
            });

            for (const auction of previews) {
                auction.status = AuctionStatus.ACTIVE;
                await auction.save();
                this.io.emit('auction_update', { auctionId: auction._id, status: 'active' });
                console.log(`▶️ Auction ${auction._id} started!`);
            }

            // 2. ACTIVE -> FINISHED
            const expired = await Auction.find({
                status: AuctionStatus.ACTIVE,
                endsAt: { $lt: now }
            });

            for (const auction of expired) {
                console.log(`🏁 Processing Round End: ${auction.title}`);
                auction.status = AuctionStatus.FINISHED;
                await auction.save();

                // Process Results with Transaction
                const session = await mongoose.startSession();
                session.startTransaction();

                try {
                    // Winners: Top N
                    const winningCount = Math.min(auction.participants.length, auction.winnersCount);
                    const winners = auction.participants.slice(0, winningCount);
                    const losers = auction.participants.slice(winningCount);

                    // Check Reserve Price (of the TOP bid)
                    const topBid = winners.length > 0 ? winners[0].amount : 0;
                    const isSold = topBid >= (auction.reservePrice || 0);

                    if (!isSold && winners.length > 0) {
                        console.log(`⚠️ Auction ${auction._id} cancelled: Reserve price not met (${topBid} < ${auction.reservePrice})`);
                        // Refund EVERYONE (including "winners")
                        for (const p of auction.participants) {
                            const user = await mongoose.model('User').findById(p.userId).session(session);
                            if (user) {
                                user.wallet.locked -= p.amount;
                                user.wallet.available += p.amount;
                                await user.save({ session });
                            }
                        }
                    } else {
                        // Process Winners (Burn Funds + Give Item + Pay Seller)
                        for (const w of winners) {
                            const user = await mongoose.model('User').findById(w.userId).session(session);
                            if (user) {
                                user.wallet.locked -= w.amount;

                                // Financial Routing
                                const commission = w.amount * (auction.commissionRate || 0.05);
                                const proceeds = w.amount - commission;

                                // Record Payment Transaction
                                await mongoose.model('Transaction').create([{
                                    userId: user._id,
                                    type: 'payment',
                                    amount: w.amount,
                                    refId: auction._id
                                }], { session });

                                // Pay Seller if exists
                                if (auction.sellerId) {
                                    const seller = await mongoose.model('User').findById(auction.sellerId).session(session);
                                    if (seller) {
                                        seller.wallet.available += proceeds;
                                        await seller.save({ session });
                                    }
                                }
                                // Add Item
                                user.inventory.push({
                                    name: auction.title,
                                    description: `Won in Round ${auction.roundIndex}`,
                                    wonAt: new Date(),
                                    price: w.amount,
                                    roundIndex: auction.roundIndex
                                });
                                await user.save({ session });
                            }
                        }

                        // Process Losers (Refund)
                        for (const l of losers) {
                            const user = await mongoose.model('User').findById(l.userId).session(session);
                            if (user) {
                                user.wallet.locked -= l.amount;
                                user.wallet.available += l.amount;
                            }
                        }
                    }

                    await session.commitTransaction();

                    this.io.emit('auction_ended', {
                        auctionId: auction._id,
                        winners: winners.map(w => w.username),
                        round: auction.roundIndex
                    });

                    // 3. NEXT ROUND
                    if (auction.roundIndex < auction.totalRounds) {
                        // Inherit duration from previous round (or default to 5)
                        const duration = (auction as any).durationMinutes || 5;

                        const nextRound = await this.service.createAuction(
                            auction.title,
                            auction.startPrice,
                            duration
                        );

                        nextRound.roundIndex = auction.roundIndex + 1;
                        nextRound.totalRounds = auction.totalRounds; // Copy totalRounds config
                        nextRound.status = AuctionStatus.PREVIEW;
                        await nextRound.save();

                        // Notify Bots
                        const { botService } = require('../app');
                        if (botService) {
                            botService.updateActiveAuction(nextRound._id.toString());
                        }

                        this.io.emit('new_round', { auction: nextRound });
                        console.log(`🔄 Created Round ${nextRound.roundIndex} (Duration: ${duration}m)`);
                    }

                } catch (err: any) {
                    await session.abortTransaction();
                    console.error(`Failed to process round end: ${err.message}`);
                } finally {
                    session.endSession();
                }
            }

        } catch (e: any) {
            console.error('Ticker Error:', e.message);
        }
    }
}
