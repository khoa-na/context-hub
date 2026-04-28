const OpenAIImport = require("openai");

const OpenAI = OpenAIImport.default || OpenAIImport;
const DEFAULT_BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
const DEFAULT_TIMEOUT_MS = 90000;

function getErrorStatusCode(error) {
  const directStatus = Number(error?.status);
  if (Number.isFinite(directStatus) && directStatus > 0) {
    return directStatus;
  }

  const statusCode = Number(error?.statusCode);
  if (Number.isFinite(statusCode) && statusCode > 0) {
    return statusCode;
  }

  const message = String(error?.message || error?.cause?.message || "");
  const match = message.match(/\b(\d{3})\b/);
  return match ? Number(match[1]) : null;
}

function getClient(apiKey) {
  return new OpenAI({
    apiKey,
    baseURL: process.env.DASHSCOPE_BASE_URL || DEFAULT_BASE_URL,
    timeout: Number(process.env.OPENAI_COMPATIBLE_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
  });
}

async function callDashScopeChatCompletion({
  apiKey,
  model,
  prompt,
  maxOutputTokens,
  systemInstruction,
}) {
  try {
    const response = await getClient(apiKey).chat.completions.create({
      model,
      messages: [
        ...(systemInstruction ? [{ role: "system", content: systemInstruction }] : []),
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
      ...(maxOutputTokens ? { max_tokens: maxOutputTokens } : {}),
    });

    return {
      text: response?.choices?.[0]?.message?.content || "",
      choices: response?.choices || [],
      usage: response?.usage,
      openAICompatible: true,
      provider: "dashscope",
    };
  } catch (error) {
    const wrapped = new Error(error?.message || "DashScope chat completion failed.");
    wrapped.statusCode = getErrorStatusCode(error);
    wrapped.cause = error;
    throw wrapped;
  }
}

module.exports = {
  callDashScopeChatCompletion,
};
