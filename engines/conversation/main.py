"""CMS-Core Conversation Engine — FastAPI entry point."""
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional

from config import PORT
from models import (
    ChatRequest, ChatResponse,
    KnowledgeIngestRequest, KnowledgeEntry,
    ArticleCreateRequest, ArticleEntry,
)
from engine.chat import chat
from knowledge.store import (
    get_all_knowledge, get_knowledge, delete_knowledge,
    get_all_articles, get_article, add_article,
)
from knowledge.search import search_knowledge
from knowledge.curator import ingest
from personalities.loader import list_personalities

app = FastAPI(title="CMS-Core Conversation Engine", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Health ---
@app.get("/api/health")
async def health():
    from config import ANTHROPIC_API_KEY
    return {
        "status": "ok",
        "engine": "conversation",
        "api_key_configured": bool(ANTHROPIC_API_KEY),
    }


# --- Chat ---
@app.post("/api/chat", response_model=ChatResponse)
async def api_chat(req: ChatRequest):
    response, session_id = await chat(req.session_id, req.message, req.personality, req.article_id)
    return ChatResponse(response=response, session_id=session_id, personality=req.personality)


# --- Personalities ---
@app.get("/api/personalities")
async def api_personalities():
    return list_personalities()


# --- Knowledge ---
@app.post("/api/knowledge/ingest")
async def api_knowledge_ingest(req: KnowledgeIngestRequest):
    entry = ingest(req.title, req.content, req.source_url, req.tags, req.type.value)
    return entry


@app.get("/api/knowledge/search")
async def api_knowledge_search(q: str, tags: Optional[str] = None, limit: int = Query(default=5, le=50)):
    tag_list = [t.strip() for t in tags.split(",")] if tags else None
    results = search_knowledge(q, tag_list, limit)
    return results


@app.get("/api/knowledge/entries")
async def api_knowledge_entries():
    return get_all_knowledge()


@app.delete("/api/knowledge/{entry_id}")
async def api_knowledge_delete(entry_id: str):
    if not delete_knowledge(entry_id):
        raise HTTPException(status_code=404, detail="Entry not found")
    return {"deleted": entry_id}


# --- Articles ---
@app.post("/api/articles")
async def api_articles_create(req: ArticleCreateRequest):
    article = add_article(req.title, req.url, req.type.value, req.summary, req.opinion)
    return article


@app.get("/api/articles")
async def api_articles_list():
    return get_all_articles()


@app.get("/api/articles/{article_id}")
async def api_articles_get(article_id: str):
    article = get_article(article_id)
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")
    # Include related knowledge
    related = search_knowledge(article["title"], limit=5)
    return {**article, "related_knowledge": related}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, reload=True)
