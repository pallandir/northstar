import assert from "node:assert/strict";
import { test } from "node:test";
import { pageKey, samePage } from "../protocol/src/index.js";

test("trailing slash, query and plain hash are ignored", () => {
  assert.equal(
    pageKey("http://localhost:3000/users/1/?tab=a#top"),
    "http://localhost:3000/users/1",
  );
  assert.equal(pageKey("http://localhost:3000"), "http://localhost:3000/");
});

test("route hashes are part of the key", () => {
  assert.equal(pageKey("http://localhost:3000/#/inbox"), "http://localhost:3000/#/inbox");
  assert.equal(pageKey("http://localhost:3000/#!/inbox"), "http://localhost:3000/#!/inbox");
});

test("different origins never match", () => {
  assert.equal(samePage("http://localhost:3000/a", "http://localhost:5173/a"), false);
  assert.equal(samePage("http://localhost:3000/a", "http://127.0.0.1:3000/a"), false);
});

test("an invalid url throws", () => {
  assert.throws(() => pageKey("not a url"));
});
