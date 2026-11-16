import test from "node:test";
import assert from "node:assert/strict";
import { LocalStore, SAVE_KEY } from "../src/storage.js";

test("插画版读写独立存档，不读取或覆盖现有写实版数据", () => {
  const existing = JSON.stringify({ settings: { seed: "realistic-existing" }, recent: [] });
  const memory = new Map<string, string>([["gamex-proctor-v1", existing]]);
  const store = new LocalStore({ getItem: key => memory.get(key) ?? null, setItem: (key, value) => { memory.set(key, value); } });
  assert.notEqual(SAVE_KEY, "gamex-proctor-v1");
  assert.equal(store.data.settings.seed, "morning-01");
  store.data.settings.seed = "illustrated-own";
  store.persist();
  assert.equal(memory.get("gamex-proctor-v1"), existing);
  assert.equal(JSON.parse(memory.get(SAVE_KEY)!).settings.seed, "illustrated-own");
});
