import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createCreatorArticleMediaUploadHandlerV1 } from
  "../lib/server/creator-article/media-api.server";

const TOKEN = "0x3333333333333333333333333333333333333333" as const;
const CREATOR = "0x1111111111111111111111111111111111111111" as const;
const HOST = "k2uoipt9wchjtz3h.public.blob.vercel-storage.com";

describe("creator article media API", () => {
  it("returns content-bound media whose path binds token, kind, dimensions and digest", async () => {
    const source = await sharp({
      create: {
        width: 90,
        height: 60,
        channels: 4,
        background: { r: 210, g: 120, b: 170, alpha: 1 },
      },
    }).png().toBuffer();
    let stored: Uint8Array<ArrayBufferLike> = new Uint8Array();
    let storedPath = "";
    const handler = createCreatorArticleMediaUploadHandlerV1({
      authenticator: {
        authenticate: vi.fn().mockResolvedValue({
          privyUserId: "user",
          privySessionId: "session",
          wallets: [CREATOR],
        }),
      },
      authorityReader: {
        read: vi.fn().mockResolvedValue([{
          chainId: 1,
          tokenAddress: TOKEN,
          creatorAddress: CREATOR,
          source: "codex-classic-launches",
          name: "Project",
          symbol: "PROJECT",
          imageUrl: null,
        }]),
      },
      media: {
        async put(pathname, bytes) {
          storedPath = pathname;
          stored = bytes;
          return {
            url: `https://${HOST}/${pathname}`,
            downloadUrl: `https://${HOST}/${pathname}?download=1`,
            pathname,
            contentType: "image/webp",
            contentDisposition: "inline",
            etag: "etag-1",
          };
        },
        async read() {
          return stored;
        },
      },
    });
    const form = new FormData();
    form.set("kind", "inline");
    form.set("file", new File([source], "discord.png", { type: "image/png" }));

    const response = await handler(new Request(
      `https://programmable.market/api/profile/projects/${TOKEN}/article/media`,
      { method: "POST", body: form },
    ), TOKEN);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(storedPath).toMatch(new RegExp(
      `^creator-article-media/v1/eip155-1/${TOKEN}/[0-9a-f-]{36}\\.inline\\.90x60\\.[0-9a-f]{64}\\.webp$`,
    ));
    expect(body.media).toEqual(expect.objectContaining({
      url: `https://${HOST}/${storedPath}`,
      width: 90,
      height: 60,
      kind: "inline",
    }));
  });
});
