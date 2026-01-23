import mongoose, { Schema, Document, Types } from 'mongoose';

export enum TransactionType {
    DEPOSIT = 'deposit',
    BID_LOCK = 'bid_lock',
    BID_REFUND = 'bid_refund',
    PAYMENT = 'payment'
}

export interface ITransaction extends Document {
    userId: Types.ObjectId;
    type: TransactionType;
    amount: number;
    refId?: Types.ObjectId; // AuctionId or BidId
    createdAt: Date;
}

const TransactionSchema: Schema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: Object.values(TransactionType), required: true },
    amount: { type: Number, required: true },
    refId: { type: Schema.Types.ObjectId }
}, {
    timestamps: { createdAt: true, updatedAt: false }
});

export default mongoose.model<ITransaction>('Transaction', TransactionSchema);
