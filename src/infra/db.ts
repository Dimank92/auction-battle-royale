import mongoose from 'mongoose';

export const connectDB = async () => {
    const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/auction_db?replicaSet=rs0&directConnection=true';
    // Note: In prod, auth source should be admin. The env var handles fully formed URI.
    try {
        await mongoose.connect(MONGO_URI);
        console.log('MongoDB Connected');
    } catch (err) {
        console.error('MongoDB Connection Error:', err);
        process.exit(1);
    }
};
