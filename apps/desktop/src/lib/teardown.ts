// Desktop client for the sidecar's teardown endpoint. Removes everything
// Mailpoppy deployed for a domain (stack + RETAINed data + deploy bucket + SES
// identity + DNS). Long-running: the sidecar waits for CloudFormation to finish.
import { sidecar } from "./sidecar";

export interface TeardownResult {
  ok: true;
  domain: string;
  stackName: string;
  deleted: string[];
  warnings: string[];
}

export function teardownEverything(input: {
  domain: string;
  stackName?: string;
  deleteDeployBucket?: boolean;
}): Promise<TeardownResult> {
  return sidecar("/teardown", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}
