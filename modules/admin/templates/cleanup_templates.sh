#!/bin/bash
# Clean up admin template files - remove old wrapper markup
# Version: 1.0.0

set -euo pipefail

TEMPLATE_DIR="/Users/Alchemy/Projects/experiments/cms-core/modules/admin/templates"
MODIFIED_COUNT=0

cd "$TEMPLATE_DIR"

for file in *.html; do
    # Skip dashboard.html (already cleaned)
    if [[ "$file" == "dashboard.html" ]]; then
        continue
    fi

    # Skip if not a regular file
    if [[ ! -f "$file" ]]; then
        continue
    fi

    echo "Processing: $file"

    # Create backup
    cp "$file" "$file.bak"

    # Process file with perl
    perl -i -0777 -pe '
        # Remove opening <div class="admin-page">
        s/<div class="admin-page">\s*\n//g;

        # Remove admin-header block (multiline)
        s/<div class="admin-header">.*?<\/div>\s*\n//gs;

        # Remove shortcuts.js script tag
        s/\s*<script src="\/public\/js\/shortcuts\.js"><\/script>\s*\n//g;

        # Remove Shortcuts.init script blocks (both variants)
        s/\s*<script>\s*Shortcuts\.init\([^)]*\);\s*<\/script>\s*\n//gs;
        s/\s*<script>\s*if\s*\(\s*typeof\s+Shortcuts\s*!==\s*['"'"'"]undefined['"'"'"]\s*\)\s*Shortcuts\.init\([^)]*\);\s*<\/script>\s*\n//gs;

        # Remove trailing closing div for admin-page wrapper
        s/\n<\/div>\s*$/\n/;
    ' "$file"

    # Check if file changed
    if ! cmp -s "$file" "$file.bak"; then
        echo "  ✓ Modified"
        MODIFIED_COUNT=$((MODIFIED_COUNT + 1))
        rm "$file.bak"
    else
        echo "  - No changes needed"
        mv "$file.bak" "$file"
    fi
done

echo ""
echo "Cleanup complete: $MODIFIED_COUNT files modified"
