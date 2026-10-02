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
0.001 ETH. It records signed transaction bytes before sending. Repeat the exact command and output
directory after an interruption. The operator reconciles that transaction's receipt or resends its
identical signed bytes. It never allocates a replacement nonce during recovery.

`tests-passed.json` checkpoints one successful module test command. Recovery reuses it while the
working files, job, test environment, report and compiled artifacts still match. Changed inputs
require fresh tests. `publication.json` checkpoints the signed release; a catalog/network failure
after that point only repeats runtime verification and storage publication. `complete.json` confirms
the exact signed record was read back. Keep credentials and journals outside the Git working files;
run only one operator at a time for each run directory and publication wallet.

Independent RPC reads and up to four catalog modules are checked in parallel. Concurrent website
requests share an in-flight catalog read; later requests read fresh data. Publication conflicts
merge the latest catalog with up to three attempts without retesting or redeploying. Changes to
these exact operator files use the Interface CI lane; Solidity, configuration, dependency and
unknown operations changes retain their own required checks.

New package versions have distinct package IDs. Existing launches keep their
onchain module instances. The live host must still match the publication's protocol release digest.
Publishing is an owner release, not an independent audit or a contributor review decision.
