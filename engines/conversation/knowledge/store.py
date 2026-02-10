"""JSON file storage for knowledge entries and articles."""
import json
import os
import uuid
from datetime import datetime, timezone
from config import KNOWLEDGE_DIR


def _ensure_dir():
    os.makedirs(KNOWLEDGE_DIR, exist_ok=True)


def _load(filename: str) -> list[dict]:
    path = os.path.join(KNOWLEDGE_DIR, filename)
    if not os.path.exists(path):
        return []
    with open(path, "r") as f:
        return json.load(f)


def _save(filename: str, data: list[dict]):
    _ensure_dir()
    path = os.path.join(KNOWLEDGE_DIR, filename)
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


# --- Knowledge ---

def get_all_knowledge() -> list[dict]:
    return _load("knowledge.json")


def get_knowledge(entry_id: str) -> dict | None:
    for e in _load("knowledge.json"):
        if e["id"] == entry_id:
            return e
    return None


def add_knowledge(title: str, content: str, source_url: str | None, tags: list[str], type_: str) -> dict:
    entries = _load("knowledge.json")
    entry = {
        "id": str(uuid.uuid4())[:8],
        "title": title,
        "content": content,
        "source_url": source_url,
        "tags": tags,
        "type": type_,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    entries.append(entry)
    _save("knowledge.json", entries)
    return entry


def delete_knowledge(entry_id: str) -> bool:
    entries = _load("knowledge.json")
    filtered = [e for e in entries if e["id"] != entry_id]
    if len(filtered) == len(entries):
        return False
    _save("knowledge.json", filtered)
    return True


# --- Articles ---

def get_all_articles() -> list[dict]:
    return _load("articles.json")


def get_article(article_id: str) -> dict | None:
    for a in _load("articles.json"):
        if a["id"] == article_id:
            return a
    return None


def add_article(title: str, url: str, type_: str, summary: str | None, opinion: str | None) -> dict:
    articles = _load("articles.json")
    article = {
        "id": str(uuid.uuid4())[:8],
        "title": title,
        "url": url,
        "type": type_,
        "summary": summary,
        "opinion": opinion,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    articles.append(article)
    _save("articles.json", articles)
    return article
