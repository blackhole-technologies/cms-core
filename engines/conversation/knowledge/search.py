"""Simple TF-IDF-ish keyword search over knowledge entries."""
import math
import re
from knowledge.store import get_all_knowledge


def _tokenize(text: str) -> list[str]:
    return re.findall(r'\w+', text.lower())


def _tf(tokens: list[str]) -> dict[str, float]:
    counts: dict[str, int] = {}
    for t in tokens:
        counts[t] = counts.get(t, 0) + 1
    total = len(tokens) or 1
    return {t: c / total for t, c in counts.items()}


def search_knowledge(query: str, tags: list[str] | None = None, limit: int = 5) -> list[dict]:
    entries = get_all_knowledge()
    if not entries:
        return []

    # Filter by tags first
    if tags:
        tag_set = set(t.lower() for t in tags)
        entries = [e for e in entries if tag_set & set(t.lower() for t in e.get("tags", []))]

    query_tokens = _tokenize(query)
    if not query_tokens:
        return entries[:limit]

    # Build IDF from corpus
    doc_count = len(entries)
    doc_freq: dict[str, int] = {}
    doc_tokens = []
    for e in entries:
        text = f"{e['title']} {e['content']} {' '.join(e.get('tags', []))}"
        tokens = set(_tokenize(text))
        doc_tokens.append(tokens)
        for t in tokens:
            doc_freq[t] = doc_freq.get(t, 0) + 1

    idf = {t: math.log((doc_count + 1) / (df + 1)) + 1 for t, df in doc_freq.items()}

    # Score each entry
    scored = []
    for i, e in enumerate(entries):
        text = f"{e['title']} {e['content']} {' '.join(e.get('tags', []))}"
        tf = _tf(_tokenize(text))
        score = sum(tf.get(qt, 0) * idf.get(qt, 1) for qt in query_tokens)
        if score > 0:
            scored.append((score, e))

    scored.sort(key=lambda x: x[0], reverse=True)
    return [e for _, e in scored[:limit]]
