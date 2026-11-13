// Redact test
// ===========
// `bun test local/prime/redact.test.ts`. Secrets go before anything is
// staged; prose and code that only name them stay.

import { expect, test } from "bun:test";
import { redact, redact_json, env_secrets } from "./redact.ts";

const KEYS: Array<[string, string]> = [
  ["anthropic", "sk-ant-api03-" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6"],
  ["openai", "sk-proj-" + "Zx9Yw8Vu7Ts6Rq5Po4Nm3Lk2Ji1Hg0Fe"],
  ["aws", "AKIA" + "IOSFODNN7EXAMPLE"],
  ["github", "ghp_" + "0123456789abcdefghijABCDEFGHIJ012345"],
  ["github", "github_pat_" + "11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz"],
  ["slack", "xoxb-" + "123456789012-1234567890123-AbCdEfGhIjKlMnOpQrStUvWx"],
  ["databricks", "dapi" + "0123456789abcdef0123456789abcdef"],
  ["jwt", "eyJhbGciOiJIUzI1NiJ9." + "eyJzdWIiOiIxMjM0NTY3ODkwIn0." + "dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk"],
];

test("each kind of key is redacted, by name", () => {
  for (const [name, key] of KEYS) {
    const out = redact("before " + key + " after", []);
    expect(out.text).toBe("before [REDACTED:" + name + "] after");
    expect(out.hits[name]).toBe(1);
  }
});

test("bearer tokens, assigned secrets and private keys are redacted", () => {
  expect(redact("Authorization: Bearer abcdEFGH1234ijklMNOP5678", []).text).toBe("Authorization: Bearer [REDACTED:bearer]");
  expect(redact("api_key = abcd1234efgh5678", []).text).toBe("api_key = [REDACTED:assigned]");
  expect(redact('PASSWORD: "hunter2hunter2"', []).text).toBe('PASSWORD: "[REDACTED:assigned]"');
  const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nabc\n-----END RSA PRIVATE KEY-----";
  expect(redact("x\n" + pem + "\ny", []).text).toBe("x\n[REDACTED:private-key]\ny");
});

// security review M5: synthetic values, each a shape of a real key
const MORE: Array<[string, string]> = [
  ["google-token", "ya29." + "a0AfB_byC1d2E3f4G5h6I7j8K9l0M1n2O3p4"],
  ["google-refresh", "1//0" + "gAbCdEfGhIjKlMnOpQrStUvWxYz0123456"],
  ["google-key", "AIza" + "SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q"],
  ["google-secret", "GOCSPX-" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4"],
  ["stripe", "sk_live_" + "51H8a1B2c3D4e5F6g7H8i9J0k1L2"],
  ["stripe", "rk_live_" + "51H8a1B2c3D4e5F6g7H8i9J0k1L2"],
  ["gitlab", "glpat-" + "a1B2c3D4e5F6g7H8i9J0"],
  ["npm", "npm_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8"],
  ["huggingface", "hf_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7"],
  ["harvest", "1234567" + ".pt." + "AbC1dEf2GhI3jKl4MnO5pQr6StU7vWx8"],
];

test("more kinds of key are redacted, by name (Google, Stripe, GitLab, npm, Hugging Face, Harvest)", () => {
  for (const [name, key] of MORE) {
    const out = redact("before " + key + " after", []);
    expect(out.text).toBe("before [REDACTED:" + name + "] after");
    expect(out.hits[name]).toBe(1);
  }
});

test("secrets assigned to longer names, Basic auth and a URL's password are redacted", () => {
  const v = "q7Rz0plain0value0042";
  expect(redact("GITHUB_TOKEN=" + v, []).text).toBe("GITHUB_TOKEN=[REDACTED:assigned]");
  expect(redact('{"access_token": "' + v + '"}', []).text).toBe('{"access_token": "[REDACTED:assigned]"}');
  expect(redact('{"refresh_token":"' + v + '"}', []).text).toBe('{"refresh_token":"[REDACTED:assigned]"}');
  expect(redact("export GOOGLE_CLIENT_SECRET=" + v, []).text).toBe("export GOOGLE_CLIENT_SECRET=[REDACTED:assigned]");
  expect(redact("X_API_KEY: " + v, []).text).toBe("X_API_KEY: [REDACTED:assigned]");
  expect(redact("_token=" + v, []).text).toBe("_token=[REDACTED:assigned]");
  expect(redact("Authorization: Basic dXNlcjpodW50ZXIyaHVudGVyMg==", []).text).toBe("Authorization: Basic [REDACTED:basic]");
  expect(redact("postgres://admin:" + v + "@db.internal:5432/x", []).text).toBe("postgres://admin:[REDACTED:url-password]@db.internal:5432/x");
});

test("names, URLs and prose like secrets' stay as they are", () => {
  const keep = [
    "token = os.environ['GITHUB_TOKEN']",
    "GITHUB_TOKEN=${{ secrets.GITHUB_TOKEN }}",
    "access_token = process.env.ACCESS_TOKEN",
    "mytoken=abcdefgh12345678",
    "TOKEN_FILE=/etc/thing/abcdefgh",
    "https://example.com:8080/path?q=1",
    "https://user@example.com/repo.git",
    "postgres://admin:${DB_PASSWORD}@db/x",
    "git@github.com:org/repo.git",
    "Basic configuration steps follow.",
    "see https://docs.example.com/1//0 and ya29 notes",
  ];
  for (const text of keep) {
    expect(redact(text, []).text).toBe(text);
  }
});

test("an environment secret's exact value is redacted wherever it is", () => {
  const value = "q7Rz-plain-looking-value-0042";
  const out = redact("the proxy key is " + value + ", again: " + value, [value]);
  expect(out.text).not.toContain(value);
  expect(out.hits.env).toBe(2);
});

test("prose and code that only name secrets stay as they are", () => {
  const keep = [
    "Run the task-list skill, then sk-learn style fits.",
    "Use a token budget; the password reset flow needs a secret manager.",
    "api_key = os.environ['LITELLM_API_KEY']",
    "token: ${{ secrets.GITHUB_TOKEN }}",
    "password = process.env.DB_PASSWORD",
    "secret: <your-secret-here>",
  ];
  for (const text of keep) {
    expect(redact(text, []).text).toBe(text);
  }
});

test("a JSON line stays JSON, its strings redacted at any depth", () => {
  const key = KEYS[0][1];
  const line = JSON.stringify({ type: "user", message: { content: [{ type: "text", text: 'use "' + key + '"\n' }] } });
  const out = redact_json(line, []);
  expect(out).not.toBeNull();
  const j = JSON.parse(out!.text);
  expect(j.message.content[0].text).toBe('use "[REDACTED:anthropic]"\n');
  expect(redact_json("not json", [])).toBeNull();
});

test("env secrets: values of secret-named variables, long enough to match safely", () => {
  const env = { LITELLM_API_KEY: "x".repeat(20), GH_TOKEN: "y".repeat(20), SHORT_KEY: "abc", HOME: "/Users/z", PATH: "/bin" };
  expect(env_secrets(env).sort()).toEqual(["x".repeat(20), "y".repeat(20)]);
});
