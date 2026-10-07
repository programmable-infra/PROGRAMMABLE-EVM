"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { ProfileProjectsSection, ProfileProjectsSkeleton } from "@/components/profile-projects";
import { MODULE_TOKEN_FALLBACK_IMAGE, RobinhoodCoinArtwork } from "@/components/robinhood-coin-artwork";
import { useLiveDataRefresh } from "@/components/use-live-data-refresh";
import { readEthereumModuleProfile, type EthereumModuleProfile } from "@/lib/profile/module-launches";
import { coinTicker } from "@/lib/robinhood-presentation";
import styles from "./robinhood-profile-launches.module.css";

const FoundationProfileClaim = dynamic(() => import("@/components/foundation-profile-claim").then(module => module.FoundationProfileClaim),
  { ssr: false, loading: () => <span className={styles.claimStatus}>Checking rewards…</span> });

export function EthereumProfileLaunches({ account, enableClaims = false }: { account: string; enableClaims?: boolean }) {
  return <AccountLaunches key={account.toLowerCase()} account={account.toLowerCase()} enableClaims={enableClaims} />;
}

function AccountLaunches({ account, enableClaims }: { account: string; enableClaims: boolean }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<EthereumModuleProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const refresh = useLiveDataRefresh({ intervalMs: 30_000 });
  const shownPage = data?.page.number ?? page;
  function requestPage(next: number) { setPage(next); setLoading(true); setRetry(value => value + 1); }

  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 20_000);
    queueMicrotask(() => { if (!disposed) { setLoading(true); setFailed(false); } });
    void fetch(`/api/profile/ethereum/modules?${new URLSearchParams({ account, page: String(page) })}`, {
      signal: controller.signal, headers: { accept: "application/json" },
    }).then(async response => {
      if (!response.ok) throw new Error("Profile unavailable");
      return readEthereumModuleProfile(await response.json(), account);
    }).then(next => {
      if (disposed) return;
      setData(next); setPage(next.page.number); setFailed(false);
    }).catch(() => { if (!disposed) setFailed(true); })
      .finally(() => { window.clearTimeout(timer); if (!disposed) setLoading(false); });
    return () => { disposed = true; controller.abort(); window.clearTimeout(timer); };
  }, [account, page, refresh, retry]);

  const notice = failed ? "Couldn’t refresh module launches. Try again." : data?.status === "stale" ? "Checking for newer launches…" : "";
  return <ProfileProjectsSection title="Ethereum module launches" titleId="profile-module-launches-title"
    refreshInProgress={loading} onRefresh={() => requestPage(shownPage)} currentPage={shownPage}
    totalPages={data?.page.totalPages ?? 1} totalItems={data?.page.totalItems} onPageChange={requestPage}
    pageChangePending={loading} statusMessage={loading ? "Refreshing module launches" : notice}>
    {notice && data?.items.length ? <p className={styles.notice} role="status">{notice}</p> : null}
    {data?.items.length ? <ul className={styles.list} aria-busy={loading}>
      {data.items.map(launch => <li key={launch.tokenAddress}>
        <Link className={styles.row} href={`/token/${launch.tokenAddress}?chainId=1`} prefetch={false}>
          <RobinhoodCoinArtwork className={styles.artwork} imageUrl={launch.imageUrl} fallbackImageUrl={MODULE_TOKEN_FALLBACK_IMAGE} />
          <span className={styles.identity}><strong>{launch.name || "Unnamed token"}</strong><small>{coinTicker(launch.symbol)}</small><small>Module · Ethereum</small></span>
        </Link>
        {enableClaims ? <FoundationProfileClaim launch={launch} account={account} chainId={1} /> : null}
      </li>)}
    </ul> : loading && !data ? <ProfileProjectsSkeleton />
      : failed ? <div className={styles.empty}><p>Couldn’t load module launches.</p><button type="button" onClick={() => requestPage(page)}>Try again</button></div>
      : <div className={styles.empty}><p>No module launches yet.</p><Link href="/launch/modules/foundation?chainId=1">Launch a token</Link></div>}
  </ProfileProjectsSection>;
}
