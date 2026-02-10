"""Anthropic Claude provider."""
import anthropic
from engine.providers.base import LLMProvider
from config import ANTHROPIC_API_KEY, MODEL


class ClaudeProvider(LLMProvider):
    def __init__(self):
        if not ANTHROPIC_API_KEY or ANTHROPIC_API_KEY.startswith("your-"):
            self._client = None
        else:
            self._client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    async def chat(self, system_prompt: str, messages: list[dict], model: str | None = None) -> str:
        if not self._client:
            return (
                "⚠️ No ANTHROPIC_API_KEY configured. "
                "Set it in your .env file and restart the server. "
                "I'd love to chat, but I need an API key first!"
            )
        response = self._client.messages.create(
            model=model or MODEL,
            max_tokens=4096,
            system=system_prompt,
            messages=messages,
        )
        return response.content[0].text
