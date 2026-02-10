"""Pydantic models for API requests/responses."""
from pydantic import BaseModel, Field
from typing import Optional
from enum import Enum


class KnowledgeType(str, Enum):
    opinion = "opinion"
    research = "research"
    conversation = "conversation"


class ArticleType(str, Enum):
    article = "article"
    video = "video"


class ChatRequest(BaseModel):
    session_id: Optional[str] = None
    message: str
    personality: str = "default"
    article_id: Optional[str] = None


class ChatResponse(BaseModel):
    response: str
    session_id: str
    personality: str


class KnowledgeIngestRequest(BaseModel):
    title: str
    content: str
    source_url: Optional[str] = None
    tags: list[str] = Field(default_factory=list)
    type: KnowledgeType = KnowledgeType.opinion


class KnowledgeEntry(BaseModel):
    id: str
    title: str
    content: str
    source_url: Optional[str] = None
    tags: list[str] = Field(default_factory=list)
    type: KnowledgeType = KnowledgeType.opinion
    created_at: str = ""


class KnowledgeSearchQuery(BaseModel):
    q: str
    tags: Optional[str] = None
    limit: int = 5


class ArticleCreateRequest(BaseModel):
    title: str
    url: str
    type: ArticleType = ArticleType.article
    summary: Optional[str] = None
    opinion: Optional[str] = None


class ArticleEntry(BaseModel):
    id: str
    title: str
    url: str
    type: ArticleType = ArticleType.article
    summary: Optional[str] = None
    opinion: Optional[str] = None
    created_at: str = ""
