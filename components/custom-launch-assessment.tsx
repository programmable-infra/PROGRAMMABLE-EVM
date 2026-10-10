const record = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
export function CustomLaunchAssessment({ value, admin = false }: { value: unknown; admin?: boolean }) {
  const a = record(value), timing = record(a.timing), fees = record(a.fees), trading = record(a.trading);
  const deadlines = Array.isArray(timing.deadlines) ? timing.deadlines.map(record).filter(d => d.state !== "covers_window") : [];
  if (!Object.keys(a).length) return null;
  return <section aria-label="Launch readiness">
    {deadlines.length ? <div role="status"><strong>Embedded deadline needs attention</strong>
      {deadlines.map((d, i) => <p key={i}>{String(d.path)}: {d.state === "expired" ? "already expired" : "ends before the review and launch window"}{typeof d.expiresAt === "string" ? ` (${new Date(d.expiresAt).toLocaleString()})` : ""}.</p>)}
      <p>Approval cannot extend a deadline inside your contract call. Update it to cover review and launch, then submit the new request.</p>
    </div> : null}
    {admin && a.timing === null ? <p>Embedded deadlines have not been checked. Inspect the initializer before approval.</p> : null}
    {Object.keys(fees).length ? <details><summary>Trading fees</summary>
      <p>Programmable route fee: <strong>{typeof fees.platformRoutedRateBps === "number" ? `${(fees.platformRoutedRateBps / 100).toFixed(2)}%` : "See the signed fee obligations"}</strong>.</p>
      {typeof fees.recipient === "string" ? <p>Recipient: <code style={{ overflowWrap: "anywhere" }}>{fees.recipient}</code></p> : null}
      {typeof fees.buyBasis === "string" ? <p>Buy: {fees.buyBasis.replaceAll("-", " ")}. Sell: {String(fees.sellBasis).replaceAll("-", " ")}. Currency: {String(fees.currency)}.</p> : null}
      <p>Custom hook and pool fees may be additional. Total fees are not yet measured. A hook fee only replaces the route fee after the route verifies it.</p>
    </details> : null}
    {admin && Object.keys(trading).length ? <details open><summary>Trading checks</summary>
      <p>Launch approval does not verify trading. Buy, sell and platform fee amount/recipient need separate execution evidence.</p>
      <p>Current status: {String(trading.status).replaceAll("_", " ")}.</p>
      {trading.evidence ? <details><summary>Recorded behavior evidence</summary><pre>{JSON.stringify(trading.evidence, null, 2)}</pre></details> : null}
    </details> : null}
  </section>;
}
