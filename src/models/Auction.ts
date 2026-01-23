import mongoose, { Schema, Document, Types } from 'mongoose';

export enum AuctionStatus {
    PREVIEW = 'preview',
    ACTIVE = 'active',
    OVERTIME = 'overtime',
    FINISHED = 'finished'
}

export interface IParticipant {
    userId: Types.ObjectId;
    username: string;
    amount: number;
    bidTime: Date;
    rank?: number; // Virtual/Computed, usually not stored but useful for passing to UI
}

export interface IAuction extends Document {
    title: string;
    description: string;
    imageUrl: string;

    // Round Info
    roundIndex: number;
    totalRounds: number;

    // Config
    maxParticipants: number; // e.g., 1000
    winnersCount: number;    // e.g., 20
    minStep: number;

    // State
    status: AuctionStatus;
    startPrice: number;
    currentPrice: number; // Highest Bid
    minEntryPrice: number; // 1000th Bid (Cutoff)
    minWinPrice: number;   // 20th Bid (Win Threshold)

    // New Production Fields
    antiSnipingWindowSec: number;    // Seconds before end to trigger extension
    antiSnipingExtensionSec: number; // Seconds to extend
    minBidStep: number;           // Minimum price increase
    reservePrice: number;         // Minimum sell price
    commissionRate: number;       // Platform fee (e.g. 0.05 for 5%)
    sellerId?: Types.ObjectId;    // User who receives the funds

    participants: IParticipant[];

    endsAt: Date;
    version: number;
}

const ParticipantSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    username: { type: String, required: true },
    amount: { type: Number, required: true },
    bidTime: { type: Date, default: Date.now }
}, { _id: false });

const AuctionSchema: Schema = new Schema({
    title: { type: String, required: true },
    description: { type: String, default: "Rare NFT Gift" },
    imageUrl: { type: String, default: "" },

    roundIndex: { type: Number, default: 1 },
    totalRounds: { type: Number, default: 50 },

    maxParticipants: { type: Number, default: 1000 },
    winnersCount: { type: Number, default: 20 },
    minStep: { type: Number, default: 50 },
    durationMinutes: { type: Number, default: 5 },

    status: { type: String, enum: Object.values(AuctionStatus), default: AuctionStatus.PREVIEW },
    startPrice: { type: Number, required: true },

    currentPrice: { type: Number, default: 0 },
    minEntryPrice: { type: Number, default: 0 },
    minWinPrice: { type: Number, default: 0 },

    // Production Config Defaults
    antiSnipingWindowSec: { type: Number, default: 60 }, // 60 seconds
    antiSnipingExtensionSec: { type: Number, default: 60 }, // 60 seconds
    minBidStep: { type: Number, default: 0.01 }, // Allows your 1 penny default
    reservePrice: { type: Number, default: 0 },
    commissionRate: { type: Number, default: 0.05 }, // 5%
    sellerId: { type: Schema.Types.ObjectId, ref: 'User' },

    participants: [ParticipantSchema],

    endsAt: { type: Date, required: true },
    version: { type: Number, default: 0 }
}, {
    timestamps: true,
    optimisticConcurrency: true,
    versionKey: 'version'
});

// Index mainly on status for Ticker
AuctionSchema.index({ status: 1, endsAt: 1 });

export default mongoose.model<IAuction>('Auction', AuctionSchema);
