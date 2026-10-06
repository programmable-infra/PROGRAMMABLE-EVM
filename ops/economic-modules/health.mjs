import { readFile } from "node:fs/promises";
import path from "node:path";

try {
  const directory = process.argv[2];
  if (!directory) throw Error();
  const status = JSON.parse(await readFile(path.join(directory, "health.json"), "utf8"));
  const age = Date.now() - Date.parse(status.checkedAt);
  if (!Number.isFinite(age) || age < -30_000 || age > 360_000 || status.caughtUp !== true || status.execution.broadcast !== true
    || status.execution.budgetExhausted || status.execution.deferred > 0 || status.execution.pendingAgeSeconds > 1800) throw Error();
  console.log(JSON.stringify({ status: "ok", targets: status.targets, discoveryBlock: status.discoveryBlock }));
} catch {
  console.error("Economic module service needs attention: check the timer, RPCs, gas budget and durable journal.");
  process.exitCode = 1;
}
