import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { normalizeHeadshot } from "./image-variants.ts";

test("square headshots keep the top framing and lose the padded lower canvas", async () => {
  const source = await sharp({ create: { width: 1024, height: 640, channels: 4, background: "red" } })
    .extend({ bottom: 384, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const framed = await normalizeHeadshot(source);
  assert.ok(framed);
  const { info, data } = await sharp(framed).raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 1024);
  assert.equal(info.height, 640);
  assert.deepEqual([...data.subarray(-4)], [255, 0, 0, 255]);
});

test("standard UFC headshots and wider photos need no conversion", async () => {
  for (const width of [520, 640]) {
    const source = await sharp({ create: { width, height: 325, channels: 4, background: "red" } }).png().toBuffer();
    assert.equal(await normalizeHeadshot(source), null);
  }
});

test("print-size originals are shrunk to twice the canvas", async () => {
  const source = await sharp({ create: { width: 5474, height: 3324, channels: 4, background: "red" } }).png().toBuffer();
  const { width, height } = await sharp((await normalizeHeadshot(source))!).metadata();
  assert.equal(width, 1040);
  assert.equal(height, 632);
});
