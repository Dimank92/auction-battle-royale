import mongoose, { Schema, Document } from 'mongoose';

export interface IInventoryItem {
    name: string;
    description: string;
    wonAt: Date;
    price: number;
    roundIndex: number;
}

export interface IUser extends Document {
    username: string;
    wallet: {
        available: number;
        locked: number; // Funds currently in active bids
    };
    inventory: IInventoryItem[];
    version: number;
}

const UserSchema: Schema = new Schema({
    username: { type: String, required: true, unique: true },
    wallet: {
        available: { type: Number, required: true, default: 0, min: 0 },
        locked: { type: Number, required: true, default: 0, min: 0 }
    },
    inventory: [{
        name: String,
        description: String,
        wonAt: Date,
        price: Number,
        roundIndex: Number
    }],
    version: { type: Number, default: 0 }
}, {
    timestamps: true,
    optimisticConcurrency: true,
    versionKey: 'version'
});

export default mongoose.model<IUser>('User', UserSchema);
