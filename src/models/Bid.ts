import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IBid extends Document {
    auctionId: Types.ObjectId;
    userId: Types.ObjectId;
    amount: number;
    createdAt: Date;
}

const BidSchema: Schema = new Schema({
    auctionId: { type: Schema.Types.ObjectId, ref: 'Auction', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    amount: { type: Number, required: true }
}, {
    timestamps: { createdAt: true, updatedAt: false }
});

export default mongoose.model<IBid>('Bid', BidSchema);
