"""Configuration from environment variables."""
import os
from dotenv import load_dotenv

load_dotenv()

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
MODEL = os.getenv("MODEL", "claude-sonnet-4-20250514")
PORT = int(os.getenv("PORT", "8765"))
KNOWLEDGE_DIR = os.getenv("KNOWLEDGE_DIR", "data")
SESSION_TTL_SECONDS = int(os.getenv("SESSION_TTL_SECONDS", "3600"))
