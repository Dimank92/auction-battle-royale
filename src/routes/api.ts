import express, { Request, Response } from 'express';
import { AuctionService } from '../services/AuctionService';
import Auction from '../models/Auction';
import User from '../models/User';

const router = express.Router();
const auctionService = new AuctionService();

// Helper to seed data for demo
import { botService } from '../app';

// Simulation Config Schema
import { z } from 'zod';

const simSchema = z.object({
    roundDuration: z.number().min(1).default(5),
    totalRounds: z.number().min(1).default(50),
    botCount: z.number().min(0).default(49),
    minBidStep: z.number().nonnegative().default(0.01),
    reservePrice: z.number().nonnegative().default(0),
    antiSnipingWindowSec: z.number().nonnegative().default(60),
    antiSnipingExtensionSec: z.number().nonnegative().default(60)
});

router.post('/simulation/start', async (req, res) => {
    try {
        const conf = simSchema.parse(req.body);

        // CLEANUP
        botService.stop(); // Stop existing
        await User.deleteMany({});
        await Auction.deleteMany({});

        // 1. Create Auction
        const auction = await auctionService.createAuction('Gen 0 Hero #777', 100, conf.roundDuration);

        // Apply Extended Config
        auction.totalRounds = conf.totalRounds;
        auction.minBidStep = conf.minBidStep;
        auction.reservePrice = conf.reservePrice;
        auction.antiSnipingWindowSec = conf.antiSnipingWindowSec;
        auction.antiSnipingExtensionSec = conf.antiSnipingExtensionSec;

        await auction.save();

        // 2. Create Bots
        const userDocs = [];
        for (let i = 1; i <= conf.botCount; i++) {
            userDocs.push({
                username: `Bot_${i}`,
                wallet: {
                    available: Math.floor(50000 + Math.random() * 500000), // Richer bots
                    locked: 0
                }
            });
        }
        // Main User (Player)
        userDocs.push({ username: 'Player_One', wallet: { available: 100_000, locked: 0 } });

        await User.create(userDocs);

        // 3. Start Bots
        // We need to wait a moment for DB consistency? Usually fine.
        await botService.start(auction._id.toString(), conf.botCount);

        // 4. Return Player
        const player = await User.findOne({ username: 'Player_One' });

        res.json({
            success: true,
            user: player,
            auction,
            message: `Simulation started with ${conf.botCount} bots, ${conf.roundDuration}m rounds.`
        });

    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

const bidSchema = z.object({
    auctionId: z.string().min(1, "AuctionId is required"),
    userId: z.string().min(1, "UserId is required"),
    amount: z.number().positive("Amount must be positive")
});

router.post('/bid', async (req, res) => {
    try {
        const { auctionId, userId, amount } = bidSchema.parse(req.body);

        const result = await auctionService.placeBid(auctionId, userId, amount);
        if (!result.success) {
            res.status(400).json(result);
            return;
        }
        res.json(result);
    } catch (err: any) {
        if (err instanceof z.ZodError) {
            res.status(400).json({ error: 'Validation Error', details: (err as any).errors });
            return;
        }
        res.status(500).json({ error: err.message });
    }
});

router.get('/auction/:id', async (req, res) => {
    try {
        const auction = await Auction.findById(req.params.id);
        res.json(auction);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/users', async (req, res) => {
    const users = await User.find();
    res.json(users);
});

export default router;
