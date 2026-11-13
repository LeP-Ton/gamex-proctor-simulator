import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildPlan, validatePlan } from "../.test-build/src/engine/schedule.js";
import { makeConfig } from "../.test-build/src/engine/config.js";

const results = [];
for (const difficulty of ["beginner", "standard", "pressure"]) {
  for (let i = 0; i < 5000; i++) {
    const plan = buildPlan(makeConfig(`stress-${i}`, difficulty));
    assert.deepEqual(validatePlan(plan), [], `${difficulty} / stress-${i}`);
  }
  console.log(`通过：${difficulty} / 5000 组种子`);
  results.push({ difficulty, seeds: 5000, passed: true });
}
const artifacts = fileURLToPath(new URL("../artifacts/", import.meta.url));
await mkdir(artifacts, { recursive: true });
await writeFile(
  `${artifacts}stress-report.json`,
  JSON.stringify(
    { date: new Date().toISOString(), total: 15000, results },
    null,
    2,
  ),
);
