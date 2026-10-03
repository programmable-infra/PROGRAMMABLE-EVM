import { UnifiedLaunchesView } from "@/components/robinhood-launches-view";
import styles from "@/components/landing-page.module.css";

export function LandingExploreGate() {
  return (
    <div className={styles.exploreGate}>
      <UnifiedLaunchesView embedded />
    </div>
  );
}
