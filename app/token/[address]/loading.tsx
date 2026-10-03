import styles from "@/components/robinhood-token-view.module.css";

export default function TokenLoading() {
  return <div className={`${styles.page} page-width`} aria-busy="true" aria-label="Loading coin">
    <div className={styles.back} aria-hidden="true" />
    <section className={styles.market}>
      <span className="sr-only" role="status">Loading coin details</span>
      <div className={styles.loadingIdentity} aria-hidden="true" />
      <div className={styles.loadingMetrics} aria-hidden="true" />
      <div className={styles.tradingLayout} aria-hidden="true"><div className={styles.chart} /><div className={styles.loadingSwap} /></div>
    </section>
  </div>;
}
