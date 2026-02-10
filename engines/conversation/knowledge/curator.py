"""Knowledge ingestion/curation."""
from knowledge.store import add_knowledge


def ingest(title: str, content: str, source_url: str | None, tags: list[str], type_: str) -> dict:
    return add_knowledge(title, content, source_url, tags, type_)
