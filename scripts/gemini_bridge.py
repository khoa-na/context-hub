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


def main():
    try:
        request = read_request()
        api_key = request.get("apiKey")
        model = request.get("model")
        prompt = request.get("prompt")

        if not api_key:
            raise ValueError("Missing apiKey.")
        if not model:
            raise ValueError("Missing model.")
        if not prompt:
            raise ValueError("Missing prompt.")

        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model=model,
            contents=prompt,
            config=build_config(request),
        )

        print(json.dumps({
            "ok": True,
            "text": getattr(response, "text", "") or "",
        }, ensure_ascii=False), flush=True)
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
