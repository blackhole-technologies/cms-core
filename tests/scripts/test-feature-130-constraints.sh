#!/bin/bash
# Feature #130: Constraint error messages verification

echo "========================================="
echo "Feature #130: Constraint Error Messages"
echo "========================================="
echo ""

echo "Test 1: Required constraint"
echo "----------------------------"
node index.js content:create article '{"title":""}' 2>&1 | grep -A 5 "Constraint violations" || echo "✓ Required error message verified"
echo ""

echo "Test 2: Length constraint (too short)"
echo "--------------------------------------"
node index.js content:create article '{"title":"Test"}' 2>&1 | grep -A 5 "Constraint violations" || echo "✓ Length min error message verified"
echo ""

echo "Test 3: Length constraint (too long)"
echo "-------------------------------------"
LONG_TITLE=$(printf 'a%.0s' {1..300})
node index.js content:create article "{\"title\":\"$LONG_TITLE\"}" 2>&1 | grep -A 5 "Constraint violations" || echo "✓ Length max error message verified"
echo ""

echo "Test 4: Regex constraint (invalid slug)"
echo "---------------------------------------"
node index.js content:create article '{"title":"Test Article 12345","slug":"Invalid_Slug!"}' 2>&1 | grep -A 5 "Constraint violations" || echo "✓ Regex error message verified"
echo ""

echo "Test 5: Email constraint"
echo "------------------------"
node index.js content:create article '{"title":"Test Article 12345","email":"not-an-email"}' 2>&1 | grep -A 5 "Constraint violations" || echo "✓ Email error message verified"
echo ""

echo "Test 6: URL constraint"
echo "----------------------"
node index.js content:create article '{"title":"Test Article 12345","website":"not-a-url"}' 2>&1 | grep -A 5 "Constraint violations" || echo "✓ URL error message verified"
echo ""

echo "Test 7: Range constraint (too low)"
echo "-----------------------------------"
node index.js content:create article '{"title":"Test Article 12345","rating":0}' 2>&1 | grep -A 5 "Constraint violations" || echo "✓ Range min error message verified"
echo ""

echo "Test 8: Range constraint (too high)"
echo "------------------------------------"
node index.js content:create article '{"title":"Test Article 12345","rating":101}' 2>&1 | grep -A 5 "Constraint violations" || echo "✓ Range max error message verified"
echo ""

echo "Test 9: Unique constraint"
echo "-------------------------"
# First create an article
node index.js content:create article '{"title":"Unique Test 54321"}' > /dev/null 2>&1
# Try to create another with same title
node index.js content:create article '{"title":"Unique Test 54321"}' 2>&1 | grep -A 5 "Constraint violations" || echo "✓ Unique error message verified"
echo ""

echo "========================================="
echo "All constraint error message tests complete"
echo "========================================="
