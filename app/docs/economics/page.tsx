import type { Metadata } from "next";
import Link from "next/link";
import { DocsShell } from "@/components/docs-shell";

export const metadata: Metadata = {
  title: "Fees and revenue · Programmable",
  description: "Creator and module rewards, platform fees and revenue allocation.",
  alternates: { canonical: "/docs/economics" },
};

const sections = [
  { id: "basis", label: "Fee units" },
  { id: "custom", label: "Custom Launches" },
  { id: "ethereum", label: "Ethereum Mainnet" },
  { id: "modules", label: "Module Mode" },
  { id: "revenue", label: "Revenue allocation" },
  { id: "analytics", label: "Analytics" },
] as const;

export default function EconomicsDocsPage() {
  return (
    <DocsShell currentPath="/docs/economics" title="Fees and revenue" sections={sections}
      description="Trading fees, recipient shares and protocol revenue are recorded separately for each launch model.">
      <section id="basis">
        <h2>Fee units</h2>
        <p>One basis point is 0.01%; 20 bps is 0.20%. Gas, initial purchases, liquidity deposits and module operating budgets are separate costs. The launch review shows the selected fees and funding before wallet confirmation.</p>
      </section>
      <section id="custom">
        <h2>Robinhood Custom Launches</h2>
        <p>Native20 charges the full 20 bps (0.20%) of gross native ETH per successful buy or sell for Programmable, rounded up to the next wei. Creator fees and Uniswap pool fees are additional. A 1 ETH gross trade accrues 0.002 ETH for Programmable.</p>
        <p>PoolManager native claims accrue to the fixed platform recipient <code>0xD88539d3c4C460136a733A3Fd60cf6BF269079da</code>. Anyone may trigger a claim, but its payment goes only to that recipient. Creator rewards use a separate balance; a creator fee of zero earns no creator rewards.</p>
        <p>The supported separate-contract and shared token/hook Native20 paths use this fee model. These Native20 contracts retain their recorded fees. Read the exact launch configuration for earlier deployments.</p>
      </section>
      <section id="ethereum">
        <h2>Ethereum Mainnet Custom Hooks</h2>
        <p>The current Programmable platform fee is <strong>0.30% (30 bps)</strong> on each successful buy or sell through the launch&apos;s fee-bearing pool. Project fees and LP fees are separate. A 1 ETH trade at this rate allocates 0.003 ETH to Programmable.</p>
        <p>Verify the deployed hook&apos;s fee basis, asset, accounting mode and claim path. A launch stamp establishes origin; it does not prove fee enforcement or payment. Earlier Classic contracts and retained fee-certified API profiles keep their recorded 0.10% share.</p>
        <p><Link href="/developer-reference/ethereum-custom-hook#fees">Read the Ethereum Custom Hook reference</Link> for launch inputs and fee disclosure.</p>
      </section>
      <section id="modules">
        <h2>Module Mode</h2>
        <p>The current coin builder uses Foundation. Programmable receives 0.30% on each buy and sell through the launch pool. Creators can add a fee from 0% to 10% in whole percentage points. Selected modules may receive part of that creator fee; they do not reduce the platform&apos;s 0.30%.</p>
        <p>Both fees are calculated on the gross quote amount and accrue in the quote asset. A 1 WETH trade with a 1% creator fee allocates 0.003 WETH to Programmable and 0.01 WETH to creator and module recipients. The combined fee is 1.30%. Foundation&apos;s initial pool has no additional LP fee. Earlier engines retain their original settings; read the <a href="https://programmable.market/api/module-mode">active engine</a> and launch review for the applicable rate.</p>
      </section>
      <section id="revenue">
        <h2>Protocol revenue allocation</h2>
        <p>The revenue policy assigns 50% of net protocol revenue to V4 buybacks and burns and 50% to the treasury, with daily processing. Net revenue excludes creator, module author and other third-party liabilities. For Native20, the buyback allocation is equivalent to 10 bps of the qualifying trading amount; for a 30 bps platform share it is equivalent to 15 bps.</p>
        <p>Collected V4 from the project&apos;s main-token LP fees is also assigned to daily burns. Finalized transactions establish what was processed. A policy, an accrued balance and a completed burn must not be counted as the same event. Read <Link href="/docs/v4-token">V4 token</Link> for token identity and burn accounting.</p>
      </section>
      <section id="analytics">
        <h2>Analytics</h2>
        <p>The <a href="https://dune.com/programmablehq/analytics">Dune dashboard</a> refreshes every 24 hours and separates launch counts, creator rewards, protocol revenue and burns. Custom fees are counted when <code>NativeFeesAccrued</code> credits the recipient, including unclaimed balances. Claiming later does not create new revenue. Gas, liquidity deposits and LP fees are excluded from those Custom totals.</p>
      </section>
    </DocsShell>
  );
}
