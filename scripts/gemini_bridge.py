import json
import sys
import traceback

from google import genai

if hasattr(sys.stdin, "reconfigure"):
    sys.stdin.reconfigure(encoding="utf-8")
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")


def read_request():
    raw = sys.stdin.read()
    if not raw.strip():
        raise ValueError("Missing JSON request on stdin.")
    return json.loads(raw)


def build_config(request):
    config = {
        "temperature": request.get("temperature", 0.2),
    }

    if request.get("systemInstruction"):
        config["system_instruction"] = request["systemInstruction"]

    if request.get("maxOutputTokens"):
        config["max_output_tokens"] = request["maxOutputTokens"]

    if request.get("responseMimeType"):
        config["response_mime_type"] = request["responseMimeType"]

    if request.get("responseJsonSchema"):
        config["response_schema"] = request["responseJsonSchema"]

    return config


def handle_generate(client, request):
    response = client.models.generate_content(
        model=request["model"],
        contents=request["prompt"],
        config=build_config(request),
    )

    return {
        "ok": True,
        "text": getattr(response, "text", "") or "",
    }


def handle_embed(client, request):
    response = client.models.embed_content(
        model=request["model"],
        contents=request["contents"],
        config={
            "task_type": request.get("taskType"),
            "output_dimensionality": request.get("outputDimensionality"),
        },
    )

    embeddings = []
    for item in getattr(response, "embeddings", []) or []:
        values = getattr(item, "values", None) or []
        embeddings.append(values)

    return {
        "ok": True,
        "embeddings": embeddings,
    }


def main():
    try:
        request = read_request()
        api_key = request.get("apiKey")
        action = request.get("action") or "generate_content"

        if not api_key:
            raise ValueError("Missing apiKey.")
        if not request.get("model"):
            raise ValueError("Missing model.")

        client = genai.Client(api_key=api_key)

        if action == "generate_content":
            if not request.get("prompt"):
                raise ValueError("Missing prompt.")
            payload = handle_generate(client, request)
        elif action == "embed_content":
            if request.get("contents") is None:
                raise ValueError("Missing contents.")
            payload = handle_embed(client, request)
        else:
            raise ValueError(f"Unsupported action: {action}")

        print(json.dumps(payload, ensure_ascii=False), flush=True)
    except Exception as error:
        print(json.dumps({
            "ok": False,
            "error": str(error),
            "errorType": error.__class__.__name__,
            "traceback": traceback.format_exc(),
        }, ensure_ascii=False), flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
