// ============================================================
// V4 BROKER FAILOVER LAYER
// ============================================================
// Upstox is primary. Angel One is fallback.
// Failover happens per request, NOT by restarting the scan.
// ============================================================

function createFailoverBroker(primary, fallback) {
    if (!primary || !fallback) {
        throw new Error("Primary and fallback brokers are required");
    }

    let current = primary;

    async function call(method, args = []) {
        if (typeof current[method] === "function") {
            try {
                return await current[method](...args);
            } catch (primaryError) {
                if (typeof fallback[method] !== "function") throw primaryError;

                console.warn(`⚠️ ${primary.name || "PRIMARY"} ${method} failed; using ${fallback.name || "FALLBACK"}`);
                current = fallback;
                return await fallback[method](...args);
            }
        }

        if (typeof fallback[method] !== "function") {
            throw new Error(`Neither broker exposes ${method}()`);
        }

        current = fallback;
        return await fallback[method](...args);
    }

    return new Proxy({}, {
        get(_target, property) {
            if (property === "name") return "UPSTOX_PRIMARY_ANGELONE_FALLBACK";
            if (property === "getActiveBrokerName") {
                return () => current.name || "UNKNOWN";
            }
            if (property === "reset") {
                return () => { current = primary; };
            }
            if (property === "call") return call;
            return (...args) => call(property, args);
        }
    });
}

module.exports = { createFailoverBroker };
