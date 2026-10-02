import type { Metadata } from "next";
import Link from "next/link";
import publishers from "@/config/module-foundation/owner-publishers.json";

export const metadata: Metadata = {
  title: "Module publishing · Programmable",
  description: "Publish Programmable modules with the automation wallet.",
  robots: { index: false, follow: false },
};

export default function ModuleReviewPage() {
  return <main style={{ maxWidth: 760, margin: "64px auto", padding: "0 24px" }}>
    <h1>Module publishing</h1>
    <p>Build a compatible module, test its behavior, and publish it directly.</p>
    <p>Our automation wallet deploys contracts and publishes modules. You do not need a module application,
      a separate reviewer, or a connected admin wallet on this page.</p>
    <p>Automation wallet · Robinhood Chain</p>
    <code style={{ overflowWrap: "anywhere" }}>{publishers.wallets[0]}</code>
    <ol>
      <li>Build against the Foundation module interface.</li>
      <li>Run the module’s focused launch and trading checks.</li>
      <li>Publish. The module appears in Add module without a separate website deployment.</li>
    </ol>
    <Link href="/launch/modules/foundation">Open Module Mode</Link>
  </main>;
}
