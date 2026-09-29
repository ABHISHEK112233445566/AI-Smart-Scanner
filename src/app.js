const { main } = require("./appV14");

if (require.main === module) {
  main().catch((error) => {
    console.error(`FATAL: ${error?.stack || error}`);
    process.exitCode = 1;
  });
}

module.exports = { main };
