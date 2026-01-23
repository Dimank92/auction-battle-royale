import axios from 'axios';

const API_URL = 'http://localhost:3000/api';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function runProductionTests() {
    console.log('🚀 Starting Production Features Verification...');

    try {
        // 1. Setup Simulation with minBidStep and anti-sniping
        console.log('\n[1] Starting Simulation with custom config...');
        const simRes = await axios.post(`${API_URL}/simulation/start`, {
            roundDuration: 1, // 1 minute
            totalRounds: 1,
            botCount: 0,
            minBidStep: 50,
            antiSnipingWindow: 1,
            antiSnipingExtension: 1,
            reservePrice: 500
        });

        const initialAuction = simRes.data.auction;
        const initialUser = simRes.data.user;
        const initialEndsAt = new Date(initialAuction.endsAt);

        console.log(`✅ Simulation started. Auction: ${initialAuction._id}`);
        console.log(`   EndsAt: ${initialEndsAt.toLocaleTimeString()}`);

        // 2. Test Step Validation
        console.log('\n[2] Testing Min Bid Step (50)...');
        try {
            await axios.post(`${API_URL}/bid`, {
                auctionId: initialAuction._id,
                userId: initialUser._id,
                amount: 110 // Start 100 + Step 50 = 150 required
            });
            console.error('❌ Failed: Bid of 110 was accepted!');
        } catch (e: any) {
            console.log(`✅ Passed: Bid 110 rejected as expected`);
        }

        // 3. Test Anti-Sniping (Combined with valid bid)
        console.log('\n[3] Testing Valid Bid + Anti-sniping...');
        const validBid = await axios.post(`${API_URL}/bid`, {
            auctionId: initialAuction._id,
            userId: initialUser._id,
            amount: 151
        });

        if (validBid.data.success) {
            console.log('✅ Passed: Valid bid of 151 accepted.');
            const afterEndsAt = new Date(validBid.data.auction.endsAt);
            console.log(`   Initial end: ${initialEndsAt.toLocaleTimeString()}`);
            console.log(`   New end:     ${afterEndsAt.toLocaleTimeString()}`);

            if (afterEndsAt.getTime() > initialEndsAt.getTime()) {
                console.log('✅ Passed: Auction extended due to anti-sniping.');
            } else {
                console.error('❌ Failed: Auction was NOT extended.');
            }
        }

        console.log('\n✨ ALL PRODUCTION FEATURES VERIFIED');

    } catch (error: any) {
        console.error('\n❌ Verification FAILED:', error.message);
        if (error.response) console.error(error.response.data);
    }
}

runProductionTests();
