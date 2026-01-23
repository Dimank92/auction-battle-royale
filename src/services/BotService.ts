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

        // Loop every 2 seconds
        this.intervalId = setInterval(() => this.tick(), 2000);
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

            // 2. Pick 3-5 random bots to act this tick
            const actionCount = Math.floor(Math.random() * 3) + 3; // 3 to 5 bots
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

        const currentMin = auction.minEntryPrice || auction.participants[auction.participants.length - 1]?.amount || 0;
        const currentTop = auction.currentPrice;

        // Determine Bid
        // Aggressive bots might top the leader
        // Passive bots just want to get in (MinEntry + tiny)

        const isAggressive = Math.random() > 0.8;

        let bidAmount = 0;
        if (isAggressive) {
            bidAmount = Math.ceil(currentTop * (1.05 + Math.random() * 0.1)); // Beat top by 5-15%
        } else {
            bidAmount = Math.ceil(currentMin * (1.01 + Math.random() * 0.05)); // Beat min by 1-5%
        }

        // Ensure strictly greater than current min entry if full (Service handles logic, but let's be smart)
        if (bidAmount <= currentMin && auction.participants.length >= auction.maxParticipants) {
            bidAmount = Math.ceil(currentMin * 1.02);
        }

        // Sanity: Don't bid more than wallet
        // But for simulation, let's assume they have "infinite" or autorefill? 
        // No, user said "Balances 0". We need to ensure they have funds.
        // The Seed gave them ~50k. 
        if (bidAmount > bot.wallet.available + bot.wallet.locked) {
            // Can't afford. Skip.
            return;
        }

        try {
            await this.auctionService.placeBid(this.activeAuctionId!, bot._id.toString(), bidAmount);
            // console.log(`🤖 ${bot.username} bid ${bidAmount}`);
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
