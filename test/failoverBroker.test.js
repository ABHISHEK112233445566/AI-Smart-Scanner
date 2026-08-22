// ============================================================
// V4 FAILOVER BROKER TEST
// ============================================================
// Verifies that a failed Upstox request is retried through
// Angel One without restarting or duplicating the scan.
// ============================================================

const assert = require("assert");
const { createFailoverBroker } = require("../src/brokers/failoverBroker");

async function run() {
    let primaryCalls = 0;
    let fallbackCalls = 0;
    const requestLog = [];

    const primary = {
        name: "UPSTOX",
        async getQuote(symbol) {
            primaryCalls++;
            requestLog.push(`UPSTOX:${symbol}`);
            if (symbol === "FAILTEST") {
                throw new Error("Intentional primary failure");
            }
            return { broker: "UPSTOX", symbol };
        }
    };

    const fallback = {
        name: "ANGELONE",
        async getQuote(symbol) {
            fallbackCalls++;
            requestLog.push(`ANGELONE:${symbol}`);
            return { broker: "ANGELONE", symbol };
        }
    };

    const broker = createFailoverBroker(primary, fallback);

    const first = await broker.getQuote("PASS1");
    const failed = await broker.getQuote("FAILTEST");
    const afterFailover = await broker.getQuote("PASS2");

    assert.deepStrictEqual(first, { broker: "UPSTOX", symbol: "PASS1" });
    assert.deepStrictEqual(failed, { broker: "ANGELONE", symbol: "FAILTEST" });
    assert.deepStrictEqual(afterFailover, { broker: "ANGELONE", symbol: "PASS2" });

    // Primary handled PASS1 and the intentional failure exactly once.
    assert.strictEqual(primaryCalls, 2, "Primary should receive exactly two requests");

    // Angel One handles the failed request and subsequent requests after failover.
    assert.strictEqual(fallbackCalls, 2, "Fallback should receive exactly two requests");

    // There must be no second complete scan / duplicate retry of PASS1.
    assert.deepStrictEqual(requestLog, [
        "UPSTOX:PASS1",
        "UPSTOX:FAILTEST",
        "ANGELONE:FAILTEST",
        "ANGELONE:PASS2"
    ]);

    console.log("✅ FAILOVER TEST PASSED");
    console.log("   Primary requests:", primaryCalls);
    console.log("   Fallback requests:", fallbackCalls);
    console.log("   Request flow:", requestLog.join(" → "));
}

run().catch(error => {
    console.error("❌ FAILOVER TEST FAILED");
    console.error(error);
    process.exitCode = 1;
});
