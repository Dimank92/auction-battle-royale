import { AuctionService } from './AuctionService';
import User from '../models/User';
import Auction, { AuctionStatus } from '../models/Auction';

export class BotService {
    private auctionService: AuctionService;
    private intervalId: NodeJS.Timeout | null = null;
    private bots: any[] = [];
    private activeAuctionId: string | null = null;

    constructor() {
        this.auctionService = new AuctionService();
    }

    async start(auctionId: string, botCount: number = 49) {
        this.stop(); // Clear any existing loop
        this.activeAuctionId = auctionId;

        // Load Bots (Optimisation: Cache them in memory)
        // We assume bots are named Bot_1 ... Bot_N from the seed
        this.bots = await User.find({ username: { $regex: /^Bot_/ } });

        console.log(`🤖 BotService Started. Loaded ${this.bots.length} bots.`);

        // Loop every 5 seconds for video demo readability
        this.intervalId = setInterval(() => this.tick(), 5000);
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            console.log('🤖 BotService Stopped.');
        }
    }

    /*
     * Main Bot Loop
     */
    async tick() {
        if (!this.activeAuctionId || this.bots.length === 0) return;

        try {
            // 1. Get current auction state (Lightweight check)
            const auction = await Auction.findById(this.activeAuctionId);
            if (!auction || auction.status !== AuctionStatus.ACTIVE) {
                // If auction ended or not found, stop logic for this ID
                // But wait! Ticker might create a NEW round. 
                // We depend on external call to update activeAuctionId or we check for new rounds?
                // For now, let's just abort if invalid.
                return;
            }

            // 2. Pick 1-2 random bots to act this tick
            const actionCount = Math.floor(Math.random() * 2) + 1; // 1 to 2 bots
            const shuffled = [...this.bots].sort(() => 0.5 - Math.random());
            const activeBots = shuffled.slice(0, actionCount);

            for (const bot of activeBots) {
                await this.performBotAction(bot, auction);
            }

        } catch (e) {
            console.error('Bot Loop Error:', e);
        }
    }

    async performBotAction(bot: any, auction: any) {
        // Strategy: 
        // 1. If I'm already winning (Top 20), small chance to upgrade? Or hold.
        // 2. If I'm losing (or not in list), try to enter.
        // 3. Bid Amount = MinEntry + Random Step.

        // Simulating "Thinking" time? No need for backend.

        const isWinning = auction.participants.some((p: any) => p.userId.toString() === bot._id.toString());

        // 30% chance to skip if already participating (laziness/strategy)
        if (isWinning && Math.random() > 0.7) return;

        const step = auction.minBidStep || 0;
        const currentTop = auction.currentPrice;

        // Strategy: Always beat the current top leader
        let bidAmount = Math.ceil(currentTop + step + (Math.random() * step * 5));

        // Sanity: Don't bid more than wallet
        // But for simulation, let's assume they have "infinite" or autorefill? 
        // No, user said "Balances 0". We need to ensure they have funds.
        // The Seed gave them ~50k. 
        if (bidAmount > bot.wallet.available + bot.wallet.locked) {
            // Can't afford. Skip.
            return;
        }

        try {
            await this.auctionService.placeBid(this.activeAuctionId!, bot._id.toString(), Math.round(bidAmount));
        } catch (e: any) {
            // Ignore "Bid too low" etc.
        }
    }

    // Called by Ticker when round changes
    updateActiveAuction(auctionId: string) {
        this.activeAuctionId = auctionId;
        console.log(`🤖 Switch to Round: ${auctionId}`);
    }
}
