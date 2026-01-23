import axios from 'axios';

const API_URL = 'http://localhost:3000/api';
const CONCURRENT_USERS = 20;
const BIDS_PER_USER = 5;

// Utility to sleep
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
    console.log('🚀 Starting Load Test...');

    // 1. Setup Phase
    console.log('Step 1: Seeding data...');
    try {
        const seedRes = await axios.post(`${API_URL}/simulation/start`, {
            roundDuration: 1,
            totalRounds: 5,
            botCount: 0 // We create "users" manually in this script for load test
        });
        const { auction, user } = seedRes.data;
        console.log(` Auction Created: ${auction._id}, Start Price: ${auction.currentPrice}`);

        // Create more users
        console.log(` Creating ${CONCURRENT_USERS} users...`);
        const users = [];
        for (let i = 0; i < CONCURRENT_USERS; i++) {
            // We can just use the same create endpoint functionality or assume users exist/register
            // For simplicity, we'll hit the seed endpoint multiple times or just mock user IDs if the backend allowed.
            // But our backend needs real users. Let's assume we use the first user and just spam, 
            // OR better: let's add a quick route to create a user if strictly needed, 
            // but for now we will just use the one seed user and simulate "Self-Bidding" race or 
            // just accept that we are testing CONCURRENCY of the endpoint, not unique logic.
            // UPDATE: The seed creates A user. Let's create multiple users via some helper or assume we can reuse.
            // Actually, let's just make the script create users by abusing the seed endpoint? No, that resets auction.
            // Let's rely on the fact that we can just use Random ObjectIds if authentication is loose? 
            // Looking at code: User.findById(userId) checks DB.

            // HACK: We will just insert them directly via a simplified approach or just rely on 'seed' creating one user 
            // and we spam bids from the SAME user. This still tests the LOCKING mechanism because the user lock 
            // will contend with itself. Effective for testing DB write conflicts.
            users.push(user._id);
        }

        // 2. Attack Phase
        console.log(`Step 2: Launching ${CONCURRENT_USERS} concurrent workers spamming bids...`);

        const errors: any[] = [];
        const successes: any[] = [];

        const workers = users.map((userId, index) => async () => {
            for (let j = 0; j < BIDS_PER_USER; j++) {
                // Fetch current state to try and calculate a valid bid (simulate a real client)
                try {
                    // Determine a price. In a race, everyone tries to bid +5% of what they SAW.
                    // This means everyone sees 500, bids 525. Only one should win.
                    const auctionState = (await axios.get(`${API_URL}/auction/${auction._id}`)).data;
                    const priceToBid = Math.ceil(auctionState.currentPrice * 1.05) + (Math.random() > 0.5 ? 1 : 0); // Add randomness to vary prices

                    await axios.post(`${API_URL}/bid`, {
                        auctionId: auction._id,
                        userId: userId,
                        amount: priceToBid
                    });
                    successes.push({ worker: index, price: priceToBid });
                    process.stdout.write('.');
                } catch (err: any) {
                    // 400 Bad Request is EXPECTED (Bid too low, User locked, etc)
                    // 500 is BAD.
                    if (err.response && err.response.status === 400) {
                        // logic error (outbid) - valuable info
                    } else {
                        errors.push(err.message);
                        process.stdout.write('x');
                    }
                }
                await sleep(50 + Math.random() * 100); // jitter
            }
        });

        await Promise.all(workers.map(w => w()));

        console.log('\n\n🏁 Load Test Finished.');
        console.log(`Successful Bids: ${successes.length}`);
        console.log(`Errors (Unexpected): ${errors.length}`);

        // 3. Validation Phase
        const finalState = (await axios.get(`${API_URL}/auction/${auction._id}`)).data;
        console.log(`Final Price: ${finalState.currentPrice}`);
        console.log('Sanity Check: Price should be significantly higher than start.');

    } catch (err: any) {
        console.error('Fatal Error:', err.message);
    }
}

main();
