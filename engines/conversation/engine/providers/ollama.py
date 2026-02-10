"""Ollama provider stub — for future local model support."""
from engine.providers.base import LLMProvider


class OllamaProvider(LLMProvider):
    async def chat(self, system_prompt: str, messages: list[dict], model: str | None = None) -> str:
        return "🚧 Ollama provider not yet implemented. Coming when we move to the M3!"
