const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const DEFAULT_TIMEOUT_MS = 90000;
const BRIDGE_SCRIPT = path.join(__dirname, "..", "scripts", "gemini_bridge.py");

function resolvePythonExecutable() {
  const candidates = [
    process.env.GOOGLE_GENAI_PYTHON,
    process.env.PYTHON,
    "C:\\Users\\neaze\\miniconda3\\envs\\llm\\python.exe",
    "python",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate === "python" || fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return "python";
}

function parseBridgeOutput(stdout, stderr) {
  const trimmed = String(stdout || "").trim();
  if (!trimmed) {
    throw new Error(`Python GenAI bridge returned no stdout.${stderr ? ` stderr: ${stderr}` : ""}`);
  }

  const lines = trimmed.split(/\r?\n/).filter(Boolean);
  const lastLine = lines[lines.length - 1];
  let payload;

  try {
    payload = JSON.parse(lastLine);
  } catch (error) {
    throw new Error(`Python GenAI bridge returned invalid JSON: ${lastLine.slice(0, 500)}`);
  }

  if (!payload.ok) {
    const message = payload.error || "Python GenAI bridge failed.";
    const err = new Error(message);
    err.bridgePayload = payload;
    throw err;
  }

  return payload;
}

function normalizePythonResponseSchema(value) {
  if (Array.isArray(value)) {
    return value.map(normalizePythonResponseSchema);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const normalized = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "additionalProperties") {
      continue;
    }
    normalized[key] = normalizePythonResponseSchema(child);
  }
  return normalized;
}

function callPythonGenAI({
  apiKey,
  model,
  prompt,
  maxOutputTokens,
  systemInstruction,
  responseMimeType,
  responseJsonSchema,
  timeoutMs = Number(process.env.GOOGLE_GENAI_PYTHON_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
}) {
  return new Promise((resolve, reject) => {
    const python = resolvePythonExecutable();
    const child = spawn(python, [BRIDGE_SCRIPT], {
      cwd: path.join(__dirname, ".."),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
      },
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`Python GenAI bridge timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);

      try {
        const payload = parseBridgeOutput(stdout, stderr);
        resolve({
          text: payload.text || "",
          pythonBridge: {
            code,
            stderr,
          },
        });
      } catch (error) {
        reject(error);
      }
    });

    child.stdin.end(JSON.stringify({
      apiKey,
      model,
      prompt,
      maxOutputTokens,
      systemInstruction,
      responseMimeType,
      responseJsonSchema: normalizePythonResponseSchema(responseJsonSchema),
      temperature: 0.2,
    }));
  });
}

module.exports = {
  callPythonGenAI,
  resolvePythonExecutable,
};
