# Owner module publication

Programmable's own Foundation modules use a funded automation wallet. They do not require a
contributor API request, an admin wallet login, a separate reviewer or a protected review worker.
The operator runs one module-specific test command, deploys its factory when needed, checks the
actual deployment and code, signs the source/configuration/runtime record, and updates the live
owner catalog. The website reads this catalog without another website or API deployment.

```sh
node ops/module-owner-publication/operator.mjs \
  --job /private/module/job.json \
  --wallet-file /private/module/wallet.private.json \
  --storage-file /private/module/storage.private.json \
  --output /private/module/run-1
```

The wallet file contains `address`, `privateKey`, and `chainId: 4663`; the storage file contains
`token`. Both files must have permissions `0600`. The public publisher allowlist is
`config/module-foundation/owner-publishers.json`. No private key or storage token is committed.

The job supplies `sourceFile` (packed module source), `testCommand` (argument array), optional
`testEnvironment`, and the relative `factoryArtifact` and `moduleArtifact` paths. The test command
must compile and exercise that module's actual behavior and its launch/trading compatibility.
It receives `PROGRAMMABLE_MODULE_WALLET_FILE` for authorized automated lifecycle transactions.
Compiled source metadata must match the packed Solidity. Unresolved constructor immutables or
libraries require resolved artifacts; they cannot be published as zero-filled bytecode templates.

For an already deployed exact factory, pass `deploymentTransactionHash`. Otherwise the operator
deploys it itself with 0 ETH value. `maximumGasCostWei` bounds deployment gas; its default is
0.001 ETH. It records signed transaction bytes before sending. If a run stops after sending or
publishing, inspect that journal and reconcile the hash before starting another run. Successful
tests and deployment are recorded in `publication.json`; `complete.json` confirms storage readback.

Repeat the same command and output directory to reconcile an existing signed publication without
rerunning tests or sending another transaction. A stopped deployment without `publication.json`
requires receipt reconciliation first.

New package versions are retained alongside previous versions. Existing launches keep their
onchain module instances. The live host must still match the publication's protocol release digest.
Publishing is an owner release, not an independent audit or a contributor review decision.
