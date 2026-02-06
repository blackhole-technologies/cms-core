# Testing Phase 1 - Manual CLI Verification

**Version:** 1.0.0
**Date:** 2026-02-03
**Type:** Manual Test Scenarios
**Status:** Active

## Overview

This document defines manual test scenarios for Phase 1 systems: Taxonomy, Menu, and Blocks.
No automated test framework required. All tests run via CLI commands and HTTP requests.

---

## Taxonomy Tests

### CLI Tests

#### 1. Create Vocabulary
```bash
# Create vocabularies
node index.js taxonomy:create tags
node index.js taxonomy:create categories
node index.js taxonomy:create topics

# Expected output:
# - Success message with vocabulary ID
# - Confirmation of storage
```

#### 2. List Vocabularies
```bash
node index.js taxonomy:list

# Expected output:
# - Table/list showing:
#   - ID
#   - Name
#   - Term count
#   - Created date
```

#### 3. Add Terms
```bash
# Add top-level terms
node index.js taxonomy:add tags "JavaScript"
node index.js taxonomy:add tags "Python"
node index.js taxonomy:add tags "Go"
node index.js taxonomy:add categories "Technology"
node index.js taxonomy:add categories "Science"

# Expected output:
# - Success message with term ID
# - Confirmation of parent relationship (none for top-level)
```

#### 4. Add Nested Terms
```bash
# First get parent term ID from previous output
# Replace <js-id> with actual JavaScript term ID

node index.js taxonomy:add tags "Node.js" --parent=<js-id>
node index.js taxonomy:add tags "React" --parent=<js-id>
node index.js taxonomy:add tags "Vue.js" --parent=<js-id>

node index.js taxonomy:add tags "Django" --parent=<python-id>
node index.js taxonomy:add tags "Flask" --parent=<python-id>

# Expected output:
# - Success message
# - Confirmation of parent-child relationship
```

#### 5. Display Vocabulary Tree
```bash
node index.js taxonomy:tree tags

# Expected output:
# - Hierarchical tree display:
#   JavaScript
#     ├── Node.js
#     ├── React
#     └── Vue.js
#   Python
#     ├── Django
#     └── Flask
#   Go
```

#### 6. Move Terms
```bash
# Move Node.js to top level (remove parent)
node index.js taxonomy:move tags <nodejs-id> --parent=null

# Move React under Node.js
node index.js taxonomy:move tags <react-id> --parent=<nodejs-id>

# Verify with tree command
node index.js taxonomy:tree tags

# Expected output:
# - Updated hierarchy showing new structure
```

#### 7. Delete Terms
```bash
# Delete leaf node (no children)
node index.js taxonomy:delete tags <flask-id>

# Attempt to delete parent (should handle children)
node index.js taxonomy:delete tags <js-id>

# Expected output:
# - Success for leaf node
# - Error or cascade confirmation for parent node
```

#### 8. Error Cases
```bash
# Invalid vocabulary
node index.js taxonomy:add nonexistent "Term"
# Expected: Error - vocabulary not found

# Duplicate term
node index.js taxonomy:add tags "JavaScript"
# Expected: Error or warning about duplicate

# Invalid parent
node index.js taxonomy:add tags "Test" --parent=invalid-id
# Expected: Error - parent term not found

# Circular reference
node index.js taxonomy:move tags <parent-id> --parent=<child-id>
# Expected: Error - circular reference detected
```

### HTTP Tests

#### 1. Taxonomy Overview
```bash
curl http://localhost:3000/admin/taxonomy

# Expected response:
# - HTML page listing all vocabularies
# - Links to individual vocabulary pages
# - Create new vocabulary button/form
```

#### 2. Vocabulary Detail
```bash
curl http://localhost:3000/admin/taxonomy/tags

# Expected response:
# - HTML page showing:
#   - Vocabulary name and metadata
#   - Tree view of all terms
#   - Add term form
#   - Edit/delete buttons for each term
```

#### 3. JSON API
```bash
# Get vocabulary list as JSON
curl -H "Accept: application/json" http://localhost:3000/admin/taxonomy

# Get specific vocabulary
curl -H "Accept: application/json" http://localhost:3000/admin/taxonomy/tags

# Expected response:
# - JSON representation of vocabularies/terms
# - Proper content-type headers
```

---

## Menu Tests

### CLI Tests

#### 1. List Menus
```bash
node index.js menu:list

# Expected output:
# - Table showing all menus
# - System menus (main, footer, etc.)
# - Custom menus
# - Item counts
```

#### 2. Create Menu
```bash
node index.js menu:create main "Main Navigation"
node index.js menu:create footer "Footer Menu"
node index.js menu:create user "User Menu"

# Expected output:
# - Success message with menu ID
# - Confirmation of storage
```

#### 3. Add Menu Items
```bash
# Add top-level items
node index.js menu:add main "Home" "/" --weight=0
node index.js menu:add main "About" "/about" --weight=10
node index.js menu:add main "Services" "/services" --weight=20
node index.js menu:add main "Contact" "/contact" --weight=30

# Expected output:
# - Success message with item ID
# - Confirmation of weight/position
```

#### 4. Add Nested Items
```bash
# Add submenu items
node index.js menu:add main "Web Development" "/services/web" --parent=<services-id> --weight=0
node index.js menu:add main "Consulting" "/services/consulting" --parent=<services-id> --weight=10
node index.js menu:add main "Training" "/services/training" --parent=<services-id> --weight=20

# Expected output:
# - Success message
# - Confirmation of parent-child relationship
```

#### 5. List Menu Items
```bash
node index.js menu:items main

# Expected output:
# - Flat or hierarchical list of items
# - Shows:
#   - ID
#   - Title
#   - Path
#   - Weight
#   - Parent ID
#   - Enabled status
```

#### 6. Render Menu
```bash
node index.js menu:render main

# Expected output:
# - HTML markup for menu
# - Proper nesting (ul/li structure)
# - Active classes if applicable
# - Accessible markup (ARIA attributes)
```

#### 7. Update Menu Item
```bash
# Change weight
node index.js menu:update main <item-id> --weight=5

# Change parent
node index.js menu:update main <item-id> --parent=<new-parent-id>

# Disable item
node index.js menu:update main <item-id> --enabled=false

# Expected output:
# - Success confirmation
# - Updated values
```

#### 8. Delete Menu Item
```bash
# Delete leaf item
node index.js menu:delete main <item-id>

# Delete parent item (handle children)
node index.js menu:delete main <services-id>

# Expected output:
# - Success for leaf
# - Error or cascade confirmation for parent
```

#### 9. Error Cases
```bash
# Invalid menu
node index.js menu:add nonexistent "Item" "/"
# Expected: Error - menu not found

# Duplicate path at same level
node index.js menu:add main "Home2" "/" --weight=1
# Expected: Warning or error about duplicate path

# Invalid parent
node index.js menu:add main "Item" "/path" --parent=invalid-id
# Expected: Error - parent not found

# Circular reference
node index.js menu:update main <parent-id> --parent=<child-id>
# Expected: Error - circular reference
```

### HTTP Tests

#### 1. Menu Overview
```bash
curl http://localhost:3000/admin/menus

# Expected response:
# - HTML page listing all menus
# - Links to edit each menu
# - Create new menu button/form
# - Item counts per menu
```

#### 2. Menu Editor
```bash
curl http://localhost:3000/admin/menus/main

# Expected response:
# - HTML page showing:
#   - Menu name and description
#   - Draggable tree of items
#   - Add item form
#   - Edit/delete buttons
#   - Weight controls
```

#### 3. JSON API
```bash
# Get menu list
curl -H "Accept: application/json" http://localhost:3000/admin/menus

# Get specific menu with items
curl -H "Accept: application/json" http://localhost:3000/admin/menus/main

# Expected response:
# - JSON representation
# - Proper nesting structure
```

---

## Block Tests

### CLI Tests

#### 1. List Block Types
```bash
node index.js block:types

# Expected output:
# - Table of available block types:
#   - html (HTML Block)
#   - text (Text Block)
#   - menu (Menu Block)
#   - view (View Block)
#   - custom (Custom Block)
# - Description for each type
# - Configuration requirements
```

#### 2. List Regions
```bash
node index.js block:regions

# Expected output:
# - Table of theme regions:
#   - header
#   - sidebar
#   - content
#   - footer
# - Block count per region
```

#### 3. Create Blocks
```bash
# Create HTML block
node index.js block:create html --region=sidebar --title="Welcome" --content="<p>Welcome to our site</p>"

# Create text block
node index.js block:create text --region=footer --title="Copyright" --content="© 2026"

# Create menu block
node index.js block:create menu --region=header --menu=main

# Expected output:
# - Success message with block ID
# - Confirmation of region assignment
# - Type-specific configuration
```

#### 4. List Blocks
```bash
node index.js block:list

# Expected output:
# - Table of all blocks:
#   - ID
#   - Title
#   - Type
#   - Region
#   - Weight
#   - Enabled status
#   - Visibility rules
```

#### 5. Render Single Block
```bash
node index.js block:render <block-id>

# Expected output:
# - HTML markup for block
# - Wrapper div with classes/IDs
# - Title if set
# - Content based on block type
# - Proper escaping/sanitization
```

#### 6. Render Region
```bash
node index.js block:render-region sidebar

# Expected output:
# - HTML for all blocks in region
# - Ordered by weight
# - Only enabled blocks
# - Visibility rules applied
# - Region wrapper div
```

#### 7. Update Block
```bash
# Change region
node index.js block:update <id> --region=header

# Change weight
node index.js block:update <id> --weight=10

# Change title
node index.js block:update <id> --title="New Title"

# Disable block
node index.js block:update <id> --enabled=false

# Update visibility
node index.js block:update <id> --visibility="path" --paths="/node/*"

# Expected output:
# - Success confirmation
# - Updated values
```

#### 8. Delete Block
```bash
node index.js block:delete <id>

# Expected output:
# - Success confirmation
# - Block removed from storage
```

#### 9. Error Cases
```bash
# Invalid block type
node index.js block:create invalid --region=sidebar
# Expected: Error - unknown block type

# Invalid region
node index.js block:create html --region=nonexistent
# Expected: Error - invalid region

# Missing required config
node index.js block:create menu --region=header
# Expected: Error - menu parameter required

# Render nonexistent block
node index.js block:render invalid-id
# Expected: Error - block not found
```

### HTTP Tests

#### 1. Block Overview
```bash
curl http://localhost:3000/admin/blocks

# Expected response:
# - HTML page listing all blocks
# - Grouped by region
# - Create new block button
# - Quick edit controls
# - Drag-drop reordering interface
```

#### 2. Region Layout
```bash
curl http://localhost:3000/admin/regions

# Expected response:
# - HTML page showing:
#   - Visual layout of regions
#   - Blocks in each region
#   - Drag-drop between regions
#   - Weight controls
```

#### 3. Block Editor
```bash
curl http://localhost:3000/admin/blocks/<id>/edit

# Expected response:
# - HTML form for editing block:
#   - Title field
#   - Region selector
#   - Weight input
#   - Type-specific fields
#   - Visibility settings
#   - Save/delete buttons
```

#### 4. JSON API
```bash
# Get all blocks
curl -H "Accept: application/json" http://localhost:3000/admin/blocks

# Get blocks by region
curl -H "Accept: application/json" http://localhost:3000/admin/blocks?region=sidebar

# Get single block
curl -H "Accept: application/json" http://localhost:3000/admin/blocks/<id>

# Expected response:
# - JSON representation
# - Proper data structures
```

---

## Integration Tests

Test workflows that span multiple systems.

### Workflow 1: Content with Taxonomy

```bash
# 1. Create vocabulary
node index.js taxonomy:create tags

# 2. Add terms
node index.js taxonomy:add tags "Featured"
node index.js taxonomy:add tags "Breaking News"

# 3. Create content (future)
# node index.js content:create article --title="Test" --tags=<featured-id>

# 4. Verify taxonomy display
curl http://localhost:3000/admin/taxonomy/tags

# Expected:
# - Terms created and visible
# - Ready for content association
```

### Workflow 2: Menu with Taxonomy Pages

```bash
# 1. Create vocabulary
node index.js taxonomy:create categories

# 2. Add category
node index.js taxonomy:add categories "Technology"

# 3. Add menu item for category
node index.js menu:add main "Technology" "/taxonomy/categories/technology" --weight=15

# 4. Render menu
node index.js menu:render main

# Expected:
# - Menu includes taxonomy link
# - Proper hierarchy maintained
```

### Workflow 3: Block with Menu

```bash
# 1. Create menu
node index.js menu:create footer "Footer Menu"

# 2. Add menu items
node index.js menu:add footer "Privacy" "/privacy"
node index.js menu:add footer "Terms" "/terms"

# 3. Create menu block
node index.js block:create menu --region=footer --menu=footer --title="Legal"

# 4. Render region
node index.js block:render-region footer

# Expected:
# - Block renders menu
# - Menu items display correctly
# - Proper HTML structure
```

### Workflow 4: Multiple Blocks in Region

```bash
# 1. Create blocks
node index.js block:create html --region=sidebar --title="Ad 1" --weight=0 --content="<img src='/ad1.png'>"
node index.js block:create text --region=sidebar --title="About" --weight=10 --content="About us text"
node index.js block:create menu --region=sidebar --menu=user --weight=20

# 2. Render region
node index.js block:render-region sidebar

# 3. Verify order
# Expected:
# - Ad 1 first (weight 0)
# - About second (weight 10)
# - User menu third (weight 20)
```

### Workflow 5: Visibility Rules

```bash
# 1. Create block
node index.js block:create html --region=header --title="Alert" --content="<div>Important!</div>"

# 2. Set visibility
node index.js block:update <id> --visibility="path" --paths="/admin/*"

# 3. Test rendering
node index.js block:render-region header

# 4. Verify with HTTP
curl http://localhost:3000/admin
curl http://localhost:3000/

# Expected:
# - Block visible on /admin pages
# - Block hidden on non-admin pages
```

---

## Performance Tests

### Large Dataset Tests

#### Taxonomy with 1000+ Terms
```bash
# Create vocabulary
node index.js taxonomy:create performance-test

# Add 1000 terms via script
for i in {1..1000}; do
  node index.js taxonomy:add performance-test "Term $i"
done

# Test operations
time node index.js taxonomy:list
time node index.js taxonomy:tree performance-test

# Expected:
# - Commands complete in <2 seconds
# - Memory usage stable
# - No crashes or errors
```

#### Menu with 100+ Items
```bash
# Create menu
node index.js menu:create large-menu

# Add 100 items
for i in {1..100}; do
  node index.js menu:add large-menu "Item $i" "/item-$i" --weight=$i
done

# Test rendering
time node index.js menu:render large-menu

# Expected:
# - Renders in <1 second
# - Proper HTML structure maintained
```

#### Region with 50+ Blocks
```bash
# Create blocks
for i in {1..50}; do
  node index.js block:create text --region=content --title="Block $i" --content="Content $i" --weight=$i
done

# Test rendering
time node index.js block:render-region content

# Expected:
# - Renders in <2 seconds
# - All blocks included in order
```

---

## Error Handling Tests

### Database Errors

```bash
# 1. Corrupt storage file
echo "invalid json" > storage/taxonomy.json

# 2. Attempt operation
node index.js taxonomy:list

# Expected:
# - Graceful error message
# - No crash
# - Suggestion to restore backup
```

### Invalid Input

```bash
# Special characters in names
node index.js taxonomy:create "test<script>alert(1)</script>"

# SQL injection attempt
node index.js taxonomy:add tags "'; DROP TABLE--"

# Path traversal
node index.js menu:add main "Test" "../../../etc/passwd"

# Expected:
# - Input sanitized
# - No code execution
# - No file system access
```

### Concurrent Access

```bash
# Run two operations simultaneously
node index.js taxonomy:add tags "A" &
node index.js taxonomy:add tags "B" &
wait

# Verify results
node index.js taxonomy:list

# Expected:
# - Both terms created
# - No data corruption
# - Proper file locking
```

---

## Regression Tests

Run before each release to verify existing functionality.

### Quick Smoke Test
```bash
#!/bin/bash
set -e

# Taxonomy
node index.js taxonomy:create smoketest
node index.js taxonomy:add smoketest "Term1"
node index.js taxonomy:list | grep smoketest

# Menu
node index.js menu:create smoketest
node index.js menu:add smoketest "Item" "/" --weight=0
node index.js menu:render smoketest | grep "Item"

# Blocks
node index.js block:create text --region=sidebar --title="Test" --content="Test"
node index.js block:render-region sidebar | grep "Test"

echo "Smoke test passed"
```

### Full Regression Suite
```bash
#!/bin/bash

# Run all CLI tests
./test-taxonomy-cli.sh
./test-menu-cli.sh
./test-blocks-cli.sh

# Run all HTTP tests
./test-taxonomy-http.sh
./test-menu-http.sh
./test-blocks-http.sh

# Run integration tests
./test-integration.sh

echo "Full regression suite completed"
```

---

## Test Data Cleanup

### Reset Between Tests
```bash
# Backup current data
cp -r storage storage-backup-$(date +%s)

# Clear all data
rm storage/*.json

# Reinitialize
node index.js init

# Or restore backup
# cp -r storage-backup-<timestamp>/* storage/
```

### Selective Cleanup
```bash
# Remove test vocabularies
node index.js taxonomy:delete smoketest
node index.js taxonomy:delete performance-test

# Remove test menus
node index.js menu:delete smoketest
node index.js menu:delete large-menu

# Remove test blocks
node index.js block:list | grep "Test" | awk '{print $1}' | xargs -I {} node index.js block:delete {}
```

---

## Test Reporting

### Manual Test Checklist

Track test execution:

```markdown
## Taxonomy Tests
- [ ] Create vocabulary
- [ ] List vocabularies
- [ ] Add terms
- [ ] Add nested terms
- [ ] Display tree
- [ ] Move terms
- [ ] Delete terms
- [ ] Error cases
- [ ] HTTP overview
- [ ] HTTP detail

## Menu Tests
- [ ] List menus
- [ ] Create menu
- [ ] Add items
- [ ] Add nested items
- [ ] List items
- [ ] Render menu
- [ ] Update item
- [ ] Delete item
- [ ] Error cases
- [ ] HTTP overview
- [ ] HTTP editor

## Block Tests
- [ ] List types
- [ ] List regions
- [ ] Create blocks
- [ ] List blocks
- [ ] Render block
- [ ] Render region
- [ ] Update block
- [ ] Delete block
- [ ] Error cases
- [ ] HTTP overview
- [ ] HTTP editor

## Integration Tests
- [ ] Content with taxonomy
- [ ] Menu with taxonomy
- [ ] Block with menu
- [ ] Multiple blocks
- [ ] Visibility rules

## Performance Tests
- [ ] Large taxonomy
- [ ] Large menu
- [ ] Many blocks

## Error Handling
- [ ] Database errors
- [ ] Invalid input
- [ ] Concurrent access
```

### Issue Template

When test fails:

```markdown
## Test Failure Report

**Test:** [Test name from this doc]
**Date:** [Date]
**Tester:** [Name]

**Expected Behavior:**
[What should happen]

**Actual Behavior:**
[What actually happened]

**Steps to Reproduce:**
1. [First step]
2. [Second step]
3. [...]

**Error Output:**
```
[Paste error message or output]
```

**Environment:**
- Node version: [X.X.X]
- OS: [OS name and version]
- CMS version: [X.X.X]

**Additional Context:**
[Any other relevant information]
```

---

## Next Steps

After Phase 1 testing complete:

1. Document all issues found
2. Fix critical bugs
3. Optimize performance bottlenecks
4. Update documentation based on findings
5. Create Phase 2 test plan (Content, Media, Users)

---

**Build Information:**
- Test Suite Version: 1.0.0
- Target Systems: Taxonomy, Menu, Blocks
- Test Type: Manual CLI/HTTP
- Estimated Time: 2-3 hours for full suite
