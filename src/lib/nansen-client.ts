import { createServerFn } from "@tanstack/react-start";

export const fetchNansenInvestigation = createServerFn(
  "GET",
  async (marketQuery: string) => {
    // 1. In a real environment, we use the NANSEN_API_KEY securely from .env
    const apiKey = process.env.NANSEN_API_KEY;
    
    // Simulate a secure backend delay (e.g., querying nansen endpoints)
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // 2. We would normally make a REST call to Nansen like this:
    // const response = await fetch(`https://api.nansen.ai/v1/token/flow?query=${marketQuery}`, {
    //   headers: { "Authorization": `Bearer ${apiKey}` }
    // });
    // const data = await response.json();

    // 3. Since we don't have the exact REST endpoint documentation for their V2 API currently,
    // we return a highly realistic mocked structure formatted identically to what the frontend expects.
    
    const addresses = ["0x4a9b...7c21", "0x88f2...11d9", "0x12bb...90a4"];
    const exchanges = ["Binance Hot Wallet", "Kraken 4", "Coinbase: Misc"];
    const ex = exchanges[Math.floor(Math.random() * exchanges.length)];
    const ad = addresses[Math.floor(Math.random() * addresses.length)];
    
    const isWhale = marketQuery.includes("WHALE");
    
    const thesis = isWhale 
      ? `Coordinated accumulation detected across 3 distinct addresses funded simultaneously from ${ex}. Sizing suggests inside knowledge of impending news before market repricing.`
      : `Automated arb bot malfunction or aggressive manual delta-neutral hedging. Wallet ${ad} aggressively swept the order book ignoring spread fees.`;

    const history = Array.from({ length: 4 }).map((_, i) => ({
      tx: `0x${Math.random().toString(16).slice(2, 10)}...`,
      time: `${i * 15 + Math.floor(Math.random() * 10)} mins ago`,
      amt: `$${(Math.random() * 50 + 10).toFixed(1)}k`,
      type: i === 3 ? "Exchange Deposit" : "Market Buy",
    }));

    return { thesis, history };
  }
);
