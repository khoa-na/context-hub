const config = require("../config");

function getModelConfig(modelId) {
  const id = String(modelId || "").trim();
  return config.MODELS.find((model) => model.id === id) || config.MODELS.find((model) => model.id === config.DEFAULT_MODEL);
}

function getProviderConfig(providerId) {
  const id = String(providerId || "").trim();
  return config.PROVIDERS.find((provider) => provider.id === id) || config.PROVIDERS[0];
}

function getProviderForModel(modelId) {
  return getModelConfig(modelId)?.provider || "google";
}

function getDefaultModelForProvider(providerId) {
  return config.MODELS.find((model) => model.provider === providerId)?.id || config.DEFAULT_MODEL;
}

function getApiKeyForProvider({ provider, apiKeys = {}, legacyApiKey = "" }) {
  const providerId = String(provider || "google").trim();
  const providerConfig = getProviderConfig(providerId);
  const requestKeys = apiKeys && typeof apiKeys === "object" ? apiKeys : {};
  const requestKey = String(requestKeys[providerId] || "").trim();
  const envKey = String(process.env[providerConfig.apiKeyEnv] || "").trim();

  if (requestKey) {
    return requestKey;
  }

  if (providerId === "google" && legacyApiKey) {
    return String(legacyApiKey || "").trim();
  }

  return envKey;
}

module.exports = {
  getModelConfig,
  getProviderConfig,
  getProviderForModel,
  getDefaultModelForProvider,
  getApiKeyForProvider,
};
