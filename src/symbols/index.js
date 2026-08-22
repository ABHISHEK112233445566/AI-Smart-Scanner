const fs = require("fs");
const path = require("path");

function normalizeSymbols(value) {
    if (!Array.isArray(value)) return [];
    return value
        .map(symbol => String(symbol || "").trim().toUpperCase())
        .filter(Boolean);
}

function loadSymbolFiles() {
    const files = fs.readdirSync(__dirname)
        .filter(file => file.endsWith(".js"))
        .filter(file => file !== "index.js")
        .sort();

    const groups = {};
    const all = [];

    for (const file of files) {
        try {
            const exported = require(path.join(__dirname, file));
            const symbols = normalizeSymbols(exported);
            if (!symbols.length) continue;

            const name = path.basename(file, ".js").toUpperCase();
            groups[name] = symbols;
            all.push(...symbols);
        } catch (error) {
            console.warn(`⚠️ Symbol file skipped: ${file} | ${error.message}`);
        }
    }

    return {
        groups,
        all: [...new Set(all)]
    };
}

const loaded = loadSymbolFiles();

module.exports = {
    ...loaded.groups,
    ALL: loaded.all,
    ALL_SYMBOLS: loaded.all
};
