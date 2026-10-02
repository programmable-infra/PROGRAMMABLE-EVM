import styles from "./studio.module.css";

/** A bounded, decorative star layer above the floral artwork. */
export function StudioAtmosphere() {
  return <div className={styles.stars} aria-hidden="true">{Array.from({ length: 28 }, (_, index) => <i key={index} style={{ left: `${2 + (index * 37.37) % 96}%`, top: `${3 + (index * 61.61) % 94}%`, width: index % 5 === 0 ? 2 : 1, height: index % 5 === 0 ? 2 : 1, animationDuration: `${5.4 + (index * 29 % 43) / 10}s`, animationDelay: `${-(index * 17 % 101) / 10}s` }} />)}</div>;
}
