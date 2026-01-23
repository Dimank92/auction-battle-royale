import { connectDB } from './infra/db';
import Auction, { AuctionStatus } from './models/Auction';
import Transaction, { TransactionType } from './models/Transaction';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const CHECK_INTERVAL_MS = 10000; // Check every 10 seconds

async function runWorker() {
    await connectDB();
    console.log('Worker started: watching for expired auctions...');

    setInterval(async () => {
        try {
            const now = new Date();
            // Find active auctions that have ended
            const expiredAuctions = await Auction.find({
                status: AuctionStatus.ACTIVE,
                endsAt: { $lt: now }
            });

            for (const auction of expiredAuctions) {
                const session = await mongoose.startSession();
                session.startTransaction();
                try {
                    console.log(`Closing Auction ${auction._id}...`);
                    auction.status = AuctionStatus.FINISHED;
                    await auction.save({ session });

                    // If there is a winner, we might want to log a 'PURCHASE' transaction for clarity, 
                    // essentially converting the 'BID_LOCK' into 'PAYMENT' logic-wise.
                    // In our model, funds are already locked, but let's make it explicit for accounting.
                    if (auction.currentLeaderId && auction.currentPrice > 0) {
                        // Optional: Create a final 'PAYMENT' record to signify transfer of ownership context
                        // Note: User balance is already deducted (locked), so we don't move funds, 
                        // but we might want to move 'locked' -> 'spent' state if we tracked that distinction rigidly.
                        // For simplicity here, we assume 'locked' funds on a finished auction are effectively spent.
                    }

                    await session.commitTransaction();
                    console.log(`Auction ${auction._id} Closed.`);
                } catch (err) {
                    console.error(`Failed to close auction ${auction._id}`, err);
                    await session.abortTransaction();
                } finally {
                    session.endSession();
                }
            }
        } catch (err) {
            console.error('Worker Loop Error:', err);
        }
    }, CHECK_INTERVAL_MS);
}

runWorker();
