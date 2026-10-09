# Launch recovery guidance V1

Ethereum and Robinhood JSON responses add two advisory headers:

- `Programmable-Next-Action`: a stable action identifier.
- `Programmable-Next-Action-Detail`: a bounded explanation with no source or provider credentials.

Existing response bodies, manifest digests, signatures and review decisions are unchanged. Headers describe what a client should inspect next; they never authorize signing or override findings, review expiry or an unresolved local wallet journal. Existing `Retry-After` values take precedence.

| Action | Client behavior |
| --- | --- |
| `wait_for_review` | Poll the same owned resource after `Retry-After`; display `manualReview.state`. |
| `read_review_feedback` | Display `manualReview.reason`. Address feedback before submitting changed execution with a new idempotency key. |
| `request_new_review` | Obtain a new approval. Resubmission does not extend the expired window. |
| `retry_service` | Preserve exact bytes and identity. Retry a preflight, or poll the already-created launch. |
| `repair_request` | Follow finding pointers, constraints and repairs. Changed bytes require a new idempotency key. |
| `replan` | Follow the documented continuation after reconciling any unresolved send. |
| `poll_status` | GET the same owned resource. Never duplicate the creation request to poll. |
| `review_wallet_step` | Refetch and validate the current handoff before asking the wallet to sign. |
| `track_transaction` | Keep the transaction hash and poll for finality. Never resend automatically. |
| `wait_for_index` | The launch is onchain; wait for source/index projection. This does not prove tradability. |
| `view_launch` | The index is confirmed; consult separate market routing evidence. |
| `check_access` | Check credentials, scope and controller identity. |
| `inspect_findings` | Display the structured error/findings and request ID. |
| `wait` | Respect the existing rate limit and retry the same request. |

Review pending takes precedence over the old unsigned plan deadline. Submitted transaction recovery takes precedence over review expiry. Unknown provider failures never become a finding that the submitted contract is unsafe.

The website reads existing owner-authorized status endpoints while visible, displays review changes, and stops or cancels reads when the wallet context changes. It does not send email or Discord messages and does not open a signing prompt automatically.


## Approval windows

The review target is 24 hours after submission. An overdue review remains open until a reviewer decides. Approval gives the team a separate 24 hours to start. `Programmable-Next-Action: start_launch` means the controller should open its wallet handoff and select **Start launch**, or its agent should call `POST /v1/custom-launch-reviews/start` with `chainId` and `launchId` using the submitting wallet API key. Poll the same resource for the prepared wallet action.

The resulting transaction lasts at most one hour and never beyond the approval expiry. Repeating start does not extend it. An expired transaction still needs the documented recovery path. Do not change calldata, resubmit or send a second transaction while an earlier send is unresolved.
