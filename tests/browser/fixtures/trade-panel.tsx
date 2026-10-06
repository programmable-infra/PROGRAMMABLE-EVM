import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { ResponsiveTradePanel, TradePanelStateProvider, TradeWalletButton } from "../../../components/responsive-trade-panel";

function LoadingTrade({ ready }: { ready: () => void }) {
  return <ResponsiveTradePanel symbol="TEST"><p>Loading trade…</p><button onClick={ready}>Finish loading</button></ResponsiveTradePanel>;
}

function ReadyTrade({ refresh, nextCoin }: { refresh: () => void; nextCoin: () => void }) {
  return <ResponsiveTradePanel symbol="TEST"><label>Amount<input /></label>
    <button onClick={refresh}>Refresh adapter</button><button onClick={nextCoin}>Next coin</button>
    <TradeWalletButton handoff onClick={() => setTimeout(refresh, 0)}>Connect wallet</TradeWalletButton>
  </ResponsiveTradePanel>;
}

function App() {
  const [ready, setReady] = useState(false);
  const [revision, setRevision] = useState(0);
  const [coin, setCoin] = useState(0);
  return <main><h1>Trade panel regression fixture</h1>
    <button onClick={() => setReady(true)}>Resolve pool externally</button>
    <TradePanelStateProvider key={coin}>{ready
      ? <ReadyTrade key={revision} refresh={() => setRevision(value => value + 1)} nextCoin={() => setCoin(value => value + 1)} />
      : <LoadingTrade ready={() => setReady(true)} />}</TradePanelStateProvider>
  </main>;
}

createRoot(document.getElementById("root")!).render(<App />);
