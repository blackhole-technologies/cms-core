"""Core conversation engine — builds prompts, manages turns."""
from personalities.loader import load_personality
from knowledge.search import search_knowledge
from knowledge.store import get_article
from memory.sessions import sessions
from engine.providers.claude import ClaudeProvider

provider = ClaudeProvider()


def _build_system_prompt(personality: str, article_id: str | None, user_message: str = "") -> str:
    """Build system prompt from personality + knowledge context + article."""
    parts = []

    # Personality template
    template = load_personality(personality)
    parts.append(template)

    # Always search knowledge base using the user's message
    if user_message:
        _inject_knowledge(parts, user_message, limit=3)

    # Article context
    if article_id:
        article = get_article(article_id)
        if article:
            parts.append(f"\n---\n## Current Article Context\nTitle: {article['title']}\nURL: {article['url']}\nType: {article['type']}")
            if article.get("summary"):
                parts.append(f"Summary: {article['summary']}")
            if article.get("opinion"):
                parts.append(f"Site Owner's Take: {article['opinion']}")

    parts.append("\n---\n## Instructions\nYou are a conversational AI on a content site. Stay in character per the personality above. If knowledge base context is provided, you MUST draw from it — it represents the site owner's actual views and research. Present these as your own understanding, not as quotes. Be engaging — this is a conversation, not a lecture (unless you're the Professor, in which case, lecture beautifully).")

    return "\n".join(parts)


def _inject_knowledge(parts: list[str], query: str, limit: int = 3) -> None:
    """Search knowledge base and inject relevant entries into prompt."""
    related = search_knowledge(query, limit=limit)
    if related:
        parts.append("\n## Knowledge Base (Site Owner's Research & Views)")
        for entry in related:
            # Include more content for better grounding
            content_preview = entry['content'][:1500]
            parts.append(f"\n### {entry['title']} ({entry['type']})\n{content_preview}")


async def chat(session_id: str | None, message: str, personality: str = "default", article_id: str | None = None) -> tuple[str, str]:
    """Process a chat turn. Returns (response, session_id)."""
    sid, history = sessions.get_or_create(session_id)

    system_prompt = _build_system_prompt(personality, article_id, message)

    # Add user message to history
    sessions.append(sid, "user", message)

    # Send to provider
    response = await provider.chat(system_prompt, history)

    # Store assistant response
    sessions.append(sid, "assistant", response)

    return response, sid
