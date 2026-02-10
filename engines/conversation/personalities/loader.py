"""Load personality templates from markdown files."""
import os
import re

TEMPLATES_DIR = os.path.join(os.path.dirname(__file__), "templates")


def list_personalities() -> list[dict]:
    results = []
    for f in sorted(os.listdir(TEMPLATES_DIR)):
        if f.endswith(".md"):
            name = f[:-3]
            content = _load_raw(name)
            # Extract first line after "# Personality:" as description
            desc = name.capitalize()
            match = re.search(r'^## Voice\s*\n(.+)', content, re.MULTILINE)
            if match:
                desc = match.group(1).strip()
            results.append({"name": name, "description": desc})
    return results


def load_personality(name: str) -> str:
    content = _load_raw(name)
    if not content:
        content = _load_raw("default")
    return content


def _load_raw(name: str) -> str:
    path = os.path.join(TEMPLATES_DIR, f"{name}.md")
    if not os.path.exists(path):
        return ""
    with open(path, "r") as f:
        return f.read()
