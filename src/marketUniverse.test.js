const assert=require("assert");
const {getWholeNseUniverse}=require("./marketUniverse");

(async()=>{
  const instruments=[
    {segment:"NSE_EQ",exchange:"NSE",instrument_type:"EQ",trading_symbol:"ABC",instrument_key:"NSE_EQ|ISINABC"},
    {segment:"NSE_EQ",exchange:"NSE",instrument_type:"EQ",trading_symbol:"DEF",instrument_key:"NSE_EQ|ISINDEF"},
    {segment:"NSE_EQ",exchange:"NSE",instrument_type:"EQ",trading_symbol:"DUP",instrument_key:"NSE_EQ|ISINDUP1"},
    {segment:"NSE_EQ",exchange:"NSE",instrument_type:"EQ",trading_symbol:"DUP",instrument_key:"NSE_EQ|ISINDUP2"},
    {segment:"NSE_FO",exchange:"NSE",instrument_type:"CE",underlying_type:"EQUITY",underlying_symbol:"ABC",underlying_key:"NSE_EQ|ISINABC"},
    {segment:"NSE_FO",exchange:"NSE",instrument_type:"PE",underlying_type:"EQUITY",underlying_symbol:"ABC",underlying_key:"NSE_EQ|ISINABC"},
    // Same symbol but wrong underlying key must not become option eligible.
    {segment:"NSE_FO",exchange:"NSE",instrument_type:"CE",underlying_type:"EQUITY",underlying_symbol:"ABC",underlying_key:"NSE_EQ|ISINDEF"},
    // A derivative with no underlying key is diagnostic-only, never eligible.
    {segment:"NSE_FO",exchange:"NSE",instrument_type:"CE",underlying_type:"EQUITY",underlying_symbol:"DEF"}
  ];
  const universe=await getWholeNseUniverse({loadInstruments:async()=>instruments});
  assert.deepStrictEqual(universe.optionEligibleSymbols,["ABC"],
    "only a symbol whose F&O underlying_key maps to its own NSE_EQ key may be option eligible");
  assert.strictEqual(universe.equityInstrumentKeyBySymbol.get("ABC"),"NSE_EQ|ISINABC");
  assert.strictEqual(universe.equityInstrumentKeyBySymbol.has("DUP"),false,
    "duplicate NSE_EQ identities must not be silently selected");
  assert.ok(universe.foSymbolOnlyUnderlyings.includes("DEF"),
    "symbol-only F&O rows should remain visible for diagnostics");
  assert.ok(universe.symbols.includes("DEF"),
    "an NSE_EQ stock must remain in the equity universe even without an exact F&O link");
  console.log("Market universe exact NSE_EQ/NSE_FO identity tests passed");
})().catch(error=>{console.error(error);process.exitCode=1;});
