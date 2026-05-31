const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  getProviderForModel,
  getDefaultModelForProvider,
  getApiKeyForProvider,
} = require("../lib/model-providers");

test("resolves the provider for a known model", () => {
  assert.equal(getProviderForModel("gemma-4-31b-it"), "google");
  assert.equal(getProviderForModel("qwen3.6-27b"), "dashscope");
});

test("falls back to the default model's provider for unknown/empty ids", () => {
  // DEFAULT_MODEL is a google model, so an unknown id resolves to google.
  assert.equal(getProviderForModel("does-not-exist"), "google");
  assert.equal(getProviderForModel(""), "google");
});

test("returns the first model registered for a provider", () => {
  assert.equal(getDefaultModelForProvider("google"), "gemma-4-31b-it");
  assert.equal(getDefaultModelForProvider("dashscope"), "qwen3.6-35b-a3b");
});

test("api key precedence: request apiKeys win over everything", () => {
  const key = getApiKeyForProvider({
    provider: "dashscope",
    apiKeys: { dashscope: "request-key" },
    legacyApiKey: "legacy",
  });
  assert.equal(key, "request-key");
});

test("legacy apiKey only applies to the google provider", () => {
  const google = getApiKeyForProvider({ provider: "google", apiKeys: {}, legacyApiKey: "legacy" });
  assert.equal(google, "legacy");

  // legacy must NOT leak into a non-google provider
  const previous = process.env.DASHSCOPE_API_KEY;
  delete process.env.DASHSCOPE_API_KEY;
  const dashscope = getApiKeyForProvider({ provider: "dashscope", apiKeys: {}, legacyApiKey: "legacy" });
  assert.equal(dashscope, "");
  if (previous !== undefined) process.env.DASHSCOPE_API_KEY = previous;
});

test("falls back to the provider's environment variable", () => {
  const previous = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "env-key";
  const key = getApiKeyForProvider({ provider: "google", apiKeys: {}, legacyApiKey: "" });
  assert.equal(key, "env-key");
  if (previous === undefined) {
    delete process.env.GEMINI_API_KEY;
  } else {
    process.env.GEMINI_API_KEY = previous;
  }
});
