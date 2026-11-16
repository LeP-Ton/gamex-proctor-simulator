import test from "node:test";
import assert from "node:assert/strict";
import { LocalStore, SAVE_KEY } from "../src/storage.js";

test("照片版只读写自己的保存空间，插画与3D原档逐字节不变", () => {
  const modern = '{"settings":{"seed":"三维原档"},"recent":[{"id":"rig-only"}],"best":{"3d":100}}';
  const classic = '{"settings":{"seed":"插画原档"},"recent":[{"id":"classic-only"}],"best":{"classic":200}}';
  const saved = new Map<string, string>([["gamex-proctor-v1", modern], ["gamex-proctor-illustrated-v1", classic]]);
  const reads: string[] = [];
  const storage = { getItem(key: string) { reads.push(key); return saved.get(key) ?? null; }, setItem(key: string, value: string) { saved.set(key, value); } };
  const photo = new LocalStore(storage);
  assert.equal(SAVE_KEY, "gamex-proctor-photo-v1");
  assert.deepEqual(reads, [SAVE_KEY]);
  assert.deepEqual(photo.data.recent, []);
  photo.data.settings.seed = "照片独立记录";
  photo.persist();
  assert.equal(saved.get("gamex-proctor-v1"), modern);
  assert.equal(saved.get("gamex-proctor-illustrated-v1"), classic);
  assert.equal(new LocalStore(storage).data.settings.seed, "照片独立记录");
});
