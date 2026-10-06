# Confirmed launches in Explore

After a successful Module Mode receipt, the browser sends its chain, token and transaction hash to `POST /api/module-foundation/confirmed`. This is a lookup hint. It does not supply token metadata or authorize indexing.

The server loads the admitted source and independently checks the exact transaction, factory event, immutable metadata and pool state with both chain providers. It stores matching observations in the private `website-index/module-foundation/confirmed-v1.json` object. Failed verification leaves the normal background index unchanged.

Explore can show these receipt-confirmed rows before settlement finality. Their API rows carry `confirmation: "confirmed"`. They are presentation records only and are never used as trading, launch or module authority. Each distinct receipt block is checked against both providers with a shared 15-second read window. A conflicting block or unavailable provider omits the provisional row.

Canonical indexed identities always take precedence. Records expire after one hour, the store holds at most 64 identities, and updates use conditional writes to preserve concurrent launches. Owner-hidden identities stay hidden. Price feeds are not requested for provisional rows.

The browser deduplicates notifications and uses at most three attempts. The endpoint coalesces identical requests, caps concurrent verification and limits new verification jobs. Explore refreshes only while visible using its existing shared market caches; it does not make individual Codex requests for these new rows.

This reduces the delay after receipt confirmation. It does not make transaction mining or settlement finality instantaneous.
