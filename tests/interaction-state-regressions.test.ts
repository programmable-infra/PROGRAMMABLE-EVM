import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  actionLabel,
  actionPending,
  waitForTransaction,
} from "../components/profile-view";

const root = process.cwd();

describe("interaction state regressions", () => {
  it("keeps the profile claim surface free of payout-setting controls", () => {
    const source = readFileSync(
      join(root, "components/profile-view.tsx"),
      "utf8",
    );

    expect(source).not.toContain("{payoutActionLabel(payoutState)}");
    expect(source).not.toContain("New payout address");
    expect(source).not.toContain("Payouts, fee terms and splits");
    expect(source).toContain("Claim rewards");
    expect(source).toContain(
      'onSelect: () => onClassicV3Action(reward, "claim")',
    );
  });

  it("gives repeated claim controls token- and position-specific accessible names", () => {
    const source = readFileSync(
      join(root, "components/profile-view.tsx"),
      "utf8",
    );
    const rowSource = source.slice(source.indexOf("function ProfileClaimRow"));
    const claimTrigger = rowSource.match(
      /<button[\s\S]*?aria-haspopup="dialog"[\s\S]*?<\/button>/,
    )?.[0];
    const claimAccessibleName = claimTrigger?.match(
      /aria-label=\{`([^`]+)`\}/,
    )?.[1];
    const actionAccessibleName = [
      ...source.matchAll(/aria-label=\{`([^`]+)`\}/g),
    ]
      .map((match) => match[1])
      .find((label) => label.includes("${action.label}"));

    expect(claimTrigger).toBeDefined();
    expect(claimAccessibleName).toBeDefined();
    expect(claimAccessibleName).toContain("${token.name}");
    expect(claimAccessibleName).toContain("${token.symbol}");
    expect(actionAccessibleName).toBeDefined();
    expect(actionAccessibleName).toContain("${action.label}");
    expect(actionAccessibleName).toContain("${group.source}");
    expect(actionAccessibleName).toContain("${tokenName}");
    expect(actionAccessibleName).toContain("${tokenSymbol}");
  });

  it("auto-reconciles submitted claims while preserving a manual status check", () => {
    const source = readFileSync(
      join(root, "components/profile-view.tsx"),
      "utf8",
    );

    expect(source).toContain("autoResumingProfileTransactionsRef");
    expect(source).toContain('message: "Confirming on Ethereum"');
    expect(source).toContain(
      'message: "Waiting for confirmation. Select Check status to check again."',
    );
    expect(source).toContain('return "Check status"');
    expect(source).not.toContain("View transaction");
    expect(source).not.toContain("Rechecking");
    expect(source).not.toContain("Transaction is not visible yet");
  });

  it.each(["fetch", "json"] as const)(
    "bounds a never-resolving transaction-status %s step and preserves manual recovery",
    async (hangingStep) => {
      vi.useFakeTimers();
      try {
        const response = new Response(
          JSON.stringify({ status: "confirmed" }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
        if (hangingStep === "json") {
          vi.spyOn(response, "json").mockImplementation(
            () => new Promise<never>(() => undefined),
          );
        }
        const fetcher = vi.fn<typeof fetch>(() =>
          hangingStep === "fetch"
            ? new Promise<Response>(() => undefined)
            : Promise.resolve(response),
        );
        const transactionHash = `0x${"a".repeat(64)}` as const;
        const result = waitForTransaction(transactionHash, 1, {
          maxAttempts: 1,
          requestTimeoutMs: 25,
          overallTimeoutMs: 50,
          fetcher,
        });

        await vi.advanceTimersByTimeAsync(25);
        await expect(result).resolves.toBe("pending");

        const pendingState = {
          account: "0x0000000000000000000000000000000000000001",
          status: "pending" as const,
          message:
            "Waiting for confirmation. Select Check status to check again.",
          transactionHash,
        };
        expect(actionPending(pendingState)).toBe(false);
        expect(actionLabel(pendingState)).toBe("Check status");
        expect(pendingState.transactionHash).toBe(transactionHash);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("auto-reconciles each persisted account and hash only once per mount", () => {
    const source = readFileSync(
      join(root, "components/profile-view.tsx"),
      "utf8",
    );
    const recoverySource = source.slice(
      source.indexOf("for (const record of pending)"),
      source.indexOf("const submitCreatorClaim"),
    );

    expect(recoverySource).toContain(
      "autoReconciledProfileTransactionsRef.current.has(resumeKey)",
    );
    expect(recoverySource).toContain(
      "autoReconciledProfileTransactionsRef.current.add(resumeKey)",
    );
    expect(recoverySource).not.toContain(
      "autoReconciledProfileTransactionsRef.current.delete(resumeKey)",
    );
    expect(source).toContain(
      "autoReconciledProfileTransactionsRef.current.clear()",
    );
  });

  it("keeps claim action and refresh announcements accessible and state-specific", () => {
    const source = readFileSync(
      join(root, "components/profile-view.tsx"),
      "utf8",
    );

    expect(source).toContain("const rowActionLabel = rowActionState");
    expect(source).toContain(
      "aria-label={`${rowActionLabel} for ${token.name} (${token.symbol})`}",
    );
    expect(source).toContain("<span>{rowActionLabel}</span>");
    expect(source).toContain(
      "rowActionPending ? styles.claimRefreshActive : \"\"",
    );
    expect(source).toContain('{visibleError ? "" : state?.message ?? ""}');
    expect(source).toContain("Rewards check complete.");
    expect(source).toContain("Rewards refresh took too long. Try again.");
    expect(source).toContain(
      '{refreshing ? "" : refreshStatusMessage}',
    );
  });

  it("remounts token-detail trade state when the connected account changes", () => {
    const source = readFileSync(
      join(root, "components/token-detail-view.tsx"),
      "utf8",
    );

    expect(source).toContain("const { wallet: activeWallet } = useWallet()");
    expect(source).toContain(
      'activeWallet?.account.toLowerCase() ?? "disconnected"',
    );
  });

  it("shows visible feedback when the detail-page address copy fails", () => {
    const detailSource = readFileSync(
      join(root, "components/token-detail-view.tsx"),
      "utf8",
    );
    const exploreSource = readFileSync(
      join(root, "components/explore-view.tsx"),
      "utf8",
    );

    expect(detailSource).toContain('"Could not copy address"');
    expect(detailSource).toContain('<p className="toast" role="alert">');
    expect(detailSource).toContain(
      "Robinhood Chain token discovery is not active in Explore yet",
    );
    expect(exploreSource).toContain("Copy ${token.name} contract address");
    expect(exploreSource).toContain(
      'setCopyFeedback("Contract address could not be copied")',
    );
  });

  it("keeps Explore project-first without interim market metadata", () => {
    const exploreSource = readFileSync(
      join(root, "components/explore-view.tsx"),
      "utf8",
    );
    const footerSource = readFileSync(
      join(root, "components/site-footer.tsx"),
      "utf8",
    );
    const exploreStyles = readFileSync(
      join(root, "components/explore-experience.module.css"),
      "utf8",
    );

    expect(exploreSource).not.toContain("All tokens");
    expect(exploreSource).not.toContain("V4 model");
    expect(exploreSource).not.toContain("<dt>Market cap</dt>");
    expect(exploreSource).toContain("runnerMeta");
    expect(exploreSource).not.toContain("styles.runnerData");
    expect(exploreSource).not.toContain("title={token.valuationProvider");
    expect(exploreSource).not.toContain(
      "`Fully diluted valuation from ${token.valuationProvider}`",
    );
    expect(exploreSource).not.toContain("FDV{token.valuationProvider");
    expect(exploreSource).not.toContain("` · ${token.valuationProvider}`");
    expect(exploreSource).not.toContain("<AnimatedMarketCap");
    expect(exploreSource).not.toContain("metric={token.valuation}");
    expect(exploreSource).not.toContain(
      '<strong>{token.marketStatus ?? "Unavailable"}</strong>',
    );
    expect(exploreSource).not.toContain(
      "exploreUnavailableFdvLabel(token.marketStatus)",
    );
    expect(exploreSource).not.toContain("Prices may be out of date");
    expect(exploreSource).not.toContain("useLiveDataRefresh");
    expect(exploreSource).not.toContain("No description yet.");
    expect(exploreSource).not.toContain('{ id: "all", label: "Any" }');
    expect(exploreSource).toMatch(
      /tokenLinkOrder[\s\S]*?website:\s*0,[\s\S]*?x:\s*1,[\s\S]*?telegram:\s*2,/,
    );
    expect(footerSource).not.toContain(
      "Launch tokens that work the way you imagine.",
    );
    expect(exploreStyles).toMatch(
      /\.page\s*\{[^}]*display:\s*block;[^}]*height:\s*auto;[^}]*overflow:\s*visible;/s,
    );
  });
});
