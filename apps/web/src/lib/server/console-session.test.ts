import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

/**
 * The console gate's security properties, not its happy path.
 *
 * Loaded fresh per assertion group where the module's process-lifetime signing
 * key matters. `CONSOLE_SESSION_SECRET` is set so tokens survive within a test.
 */

const original = {
  code: process.env.CONSOLE_ACCESS_CODE,
  secret: process.env.CONSOLE_SESSION_SECRET,
};

after(() => {
  if (original.code === undefined) delete process.env.CONSOLE_ACCESS_CODE;
  else process.env.CONSOLE_ACCESS_CODE = original.code;
  if (original.secret === undefined) delete process.env.CONSOLE_SESSION_SECRET;
  else process.env.CONSOLE_SESSION_SECRET = original.secret;
});

beforeEach(() => {
  process.env.CONSOLE_ACCESS_CODE = "correct-horse-battery";
  process.env.CONSOLE_SESSION_SECRET = "a".repeat(64);
});

async function load() {
  // A cache-busting query gives each group its own module instance.
  return import(`./console-session.ts?fresh=${Math.random()}`);
}

test("an unconfigured gate rejects every code and every session", async () => {
  const gate = await load();
  const issued = gate.issueSession();
  assert.equal(gate.sessionIsValid(issued), true);

  delete process.env.CONSOLE_ACCESS_CODE;
  assert.equal(gate.gateIsConfigured(), false);
  assert.equal(gate.codeMatches(""), false);
  assert.equal(gate.codeMatches("correct-horse-battery"), false);
  // Fail closed: a previously valid cookie must not survive losing the code.
  assert.equal(gate.sessionIsValid(issued), false);
});

test("only the exact code matches; near misses and prefixes do not", async () => {
  const gate = await load();
  assert.equal(gate.codeMatches("correct-horse-battery"), true);
  for (const wrong of [
    "correct-horse-batter",
    "correct-horse-batteryy",
    "Correct-Horse-Battery",
    "correct horse battery",
    "",
    "a",
  ]) {
    assert.equal(gate.codeMatches(wrong), false, `accepted ${JSON.stringify(wrong)}`);
  }
});

test("a session must be signed by this server and must not be expired", async () => {
  const gate = await load();
  const token = gate.issueSession();
  assert.equal(gate.sessionIsValid(token), true);

  const [expiry, signature] = token.split(".");

  // Forged and malformed shapes.
  assert.equal(gate.sessionIsValid(undefined), false);
  assert.equal(gate.sessionIsValid(""), false);
  assert.equal(gate.sessionIsValid(expiry), false, "unsigned expiry accepted");
  assert.equal(gate.sessionIsValid(`${expiry}.${"f".repeat(64)}`), false);
  assert.equal(gate.sessionIsValid(`${expiry}.deadbeef`), false);
  assert.equal(gate.sessionIsValid(`${expiry}.${signature.toUpperCase()}`), false);
  assert.equal(gate.sessionIsValid(`not-a-number.${signature}`), false);

  // Extending the expiry invalidates the signature over it.
  const later = String(Number(expiry) + 60_000);
  assert.equal(gate.sessionIsValid(`${later}.${signature}`), false);

  // Expiry is enforced against the supplied clock.
  assert.equal(gate.sessionIsValid(token, Number(expiry) - 1), true);
  assert.equal(gate.sessionIsValid(token, Number(expiry) + 1), false);
});

test("a token signed with a different key is rejected", async () => {
  const first = await load();
  const token = first.issueSession();

  process.env.CONSOLE_SESSION_SECRET = "b".repeat(64);
  const second = await load();
  assert.equal(second.sessionIsValid(token), false);
});

test("without CONSOLE_SESSION_SECRET each process signs differently", async () => {
  delete process.env.CONSOLE_SESSION_SECRET;
  const first = await load();
  const second = await load();
  const token = first.issueSession();
  assert.equal(first.sessionIsValid(token), true);
  assert.equal(
    second.sessionIsValid(token),
    false,
    "a per-process key must not be shared across instances",
  );
});

test("repeated failures block, and a success clears the block", async () => {
  const gate = await load();
  const key = "198.51.100.7";
  assert.equal(gate.throttleState(key).blocked, false);

  for (let i = 0; i < 5; i += 1) gate.recordFailure(key);
  const blocked = gate.throttleState(key);
  assert.equal(blocked.blocked, true);
  assert.ok(blocked.retryAfterSeconds > 0);

  // Other callers are unaffected.
  assert.equal(gate.throttleState("203.0.113.9").blocked, false);

  gate.clearFailures(key);
  assert.equal(gate.throttleState(key).blocked, false);
});

test("the throttle window expires on its own", async () => {
  const gate = await load();
  const key = "198.51.100.8";
  const now = Date.now();
  for (let i = 0; i < 5; i += 1) gate.recordFailure(key, now);
  assert.equal(gate.throttleState(key, now).blocked, true);
  assert.equal(gate.throttleState(key, now + 5 * 60 * 1000 + 1).blocked, false);
});

test("cookie flags keep the session out of JavaScript and off cross-site requests", async () => {
  const gate = await load();
  const insecure = gate.setCookie("token", false);
  assert.match(insecure, /^silentops-console=token;/);
  assert.match(insecure, /HttpOnly/);
  assert.match(insecure, /SameSite=Strict/);
  assert.match(insecure, /Path=\//);
  assert.match(insecure, /Max-Age=28800/);
  assert.doesNotMatch(insecure, /Secure/);

  assert.match(gate.setCookie("token", true), /Secure/);

  const cleared = gate.clearCookie(false);
  assert.match(cleared, /^silentops-console=;/);
  assert.match(cleared, /Max-Age=0/);
  assert.match(cleared, /HttpOnly/);
});
