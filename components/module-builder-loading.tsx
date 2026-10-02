"use client";

import { useLayoutEffect, useRef } from "react";
import styles from "./module-studio/studio.module.css";
import loading from "./module-builder-loading.module.css";

export function ModuleBuilderLoading() {
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    const current = heading.current;
    return () => {
      if (document.activeElement !== current) return;
      requestAnimationFrame(() => {
        if (document.activeElement !== document.body) return;
        const next = document.querySelector<HTMLElement>("main h1");
        if (!next) return;
        next.tabIndex = -1;
        next.focus({ preventScroll: true });
      });
    };
  }, []);
  return <section className={styles.launchPage} aria-busy="true" aria-labelledby="module-loading-title">
    <div className={styles.studio}>
      <header className={styles.heading}>
        <h1 ref={heading} id="module-loading-title">Module Mode</h1>
        <span className="sr-only" role="status">Loading Module Mode…</span>
      </header>
      <div className={loading.navigation} aria-hidden="true">{[0, 1, 2].map(index => <span className={loading.control} key={index} />)}</div>
      <div className={styles.workspace} data-mobile-panel="canvas" aria-hidden="true">
        <aside className={styles.library}>
          <div className={styles.panelHeading}><span className={loading.label} /></div>
          <div className={loading.fields}>{[0, 1, 2].map(index => <span className={loading.control} key={index} />)}</div>
        </aside>
        <div className={`${styles.market} ${loading.canvas}`}>
          <div className={loading.card}><span className={loading.avatar} /><span className={loading.label} /><span className={loading.label} /></div>
        </div>
        <aside className={styles.inspector}>
          <div className={styles.panelHeading}><span className={loading.label} /></div>
          <div className={loading.fields}>{[0, 1].map(index => <div key={index}><span className={loading.label} /><span className={loading.control} /></div>)}</div>
        </aside>
      </div>
    </div>
  </section>;
}
