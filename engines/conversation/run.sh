#!/bin/bash
cd "$(dirname "$0")"
python3 -m venv .venv 2>/dev/null
source .venv/bin/activate
pip install -q fastapi uvicorn anthropic python-dotenv pydantic
set -a; source .env 2>/dev/null; set +a
uvicorn main:app --host 0.0.0.0 --port ${PORT:-8765} --reload
