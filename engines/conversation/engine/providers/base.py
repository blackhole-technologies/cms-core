"""Abstract base for LLM providers."""
from abc import ABC, abstractmethod


class LLMProvider(ABC):
    @abstractmethod
    async def chat(self, system_prompt: str, messages: list[dict], model: str) -> str:
        ...
