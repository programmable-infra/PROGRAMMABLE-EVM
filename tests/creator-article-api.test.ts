import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseCreatorArticleDraftV1 } from "../lib/creator-article/contract-v1";
import { createCreatorArticleApiHandlersV1 } from
  "../lib/server/creator-article/api.server";

const TOKEN = "0x3333333333333333333333333333333333333333" as const;
const CREATOR = "0x1111111111111111111111111111111111111111" as const;

function draft() {
  return parseCreatorArticleDraftV1({
    schemaVersion: "programmable.creator-article-draft.v1",
    chainId: 1,
    tokenAddress: TOKEN,
    title: "A project story",
    bannerImage: null,
    document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }] },
  });
}

describe("creator article authenticated APIs", () => {
  const authenticate = vi.fn();
  const readAuthorities = vi.fn();
  const readCurrent = vi.fn();
  const publish = vi.fn();
  const principal = { privyUserId: "u", privySessionId: "s", wallets: [CREATOR] } as const;
  const authority = {
    chainId: 1 as const,
    tokenAddress: TOKEN,
    creatorAddress: CREATOR,
    source: "codex-classic-launches" as const,
    name: "Project",
    symbol: "PROJECT",
    imageUrl: null,
  };
  const handlers = createCreatorArticleApiHandlersV1({
    authenticator: { authenticate },
    authorityReader: { read: readAuthorities },
    store: { readCurrent, publish },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    authenticate.mockResolvedValue(principal);
    readAuthorities.mockResolvedValue([authority]);
    readCurrent.mockResolvedValue(null);
    publish.mockResolvedValue({
      article: {
        ...draft(),
        schemaVersion: "programmable.creator-article.v1",
        revision: 1,
        status: "published",
        createdAt: "2026-08-21T00:00:00.000Z",
        updatedAt: "2026-08-21T00:00:00.000Z",
      },
      etag: "etag-1",
      contentSha256: `sha256:${"aa".repeat(32)}`,
    });
  });

  it("lists only the authenticated wallet's verified projects", async () => {
    const response = await handlers.listProjects(new Request("https://example.com/api/profile/projects", {
      headers: { accept: "application/json" },
    }));
    expect(response.status).toBe(200);
    expect((await response.json()).projects).toEqual([expect.objectContaining({ tokenAddress: TOKEN })]);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("fails closed when an article read cannot distinguish absence from outage", async () => {
    readCurrent.mockRejectedValueOnce(new Error("Blob read failed"));
    const response = await handlers.listProjects(new Request(
      "https://example.com/api/profile/projects",
      { headers: { accept: "application/json" } },
    ));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      schemaVersion: "programmable.creator-article-error.v1",
      code: "creator_article_unavailable",
    });
  });

  it("requires create/update preconditions and publishes the canonical draft", async () => {
    const missing = await handlers.article(new Request(`https://example.com/api/profile/projects/${TOKEN}/article`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(draft()),
    }), TOKEN);
    expect(missing.status).toBe(428);

    const response = await handlers.article(new Request(`https://example.com/api/profile/projects/${TOKEN}/article`, {
      method: "PUT",
      headers: { "content-type": "application/json", "if-none-match": "*" },
      body: JSON.stringify(draft()),
    }), TOKEN);
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe("etag-1");
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      creatorAddress: CREATOR,
      expectedEtag: null,
    }));
  });

  it("normalizes a weak HTTP ETag before the exact Blob precondition", async () => {
    const response = await handlers.article(new Request(
      `https://example.com/api/profile/projects/${TOKEN}/article`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "if-match": 'W/"etag-1"',
        },
        body: JSON.stringify(draft()),
      },
    ), TOKEN);
    expect(response.status).toBe(200);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      expectedEtag: '"etag-1"',
    }));
  });

  it("does not trust a draft for another token", async () => {
    const wrong = { ...draft(), tokenAddress: "0x4444444444444444444444444444444444444444" };
    const response = await handlers.article(new Request(`https://example.com/api/profile/projects/${TOKEN}/article`, {
      method: "PUT",
      headers: { "content-type": "application/json", "if-none-match": "*" },
      body: JSON.stringify(wrong),
    }), TOKEN);
    expect(response.status).toBe(400);
    expect(publish).not.toHaveBeenCalled();
  });
});
