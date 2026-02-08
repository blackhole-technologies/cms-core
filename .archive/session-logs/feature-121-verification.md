# Feature #121: URL Constraint - VERIFIED

## Test Results

### Invalid URL Tests (Should Fail)
1. "not a url" → FAILED with "Invalid URL" ✓
2. "not-a-url" → FAILED with "Invalid URL" ✓

### Valid URL Tests (Should Succeed)
1. "https://example.com" → CREATED ✓
2. "ftp://example.com" → CREATED ✓ (supports multiple protocols)

## Constraint Configuration
```json
"website": {
  "type": "string",
  "required": false,
  "weight": 7,
  "label": "Website",
  "constraints": {
    "Url": {}
  }
}
```

## Implementation
- Located in: `core/constraints.js` lines 495-519
- Uses Node.js built-in `URL` constructor for validation
- Supports all valid URL protocols (http, https, ftp, etc.)
- Error code: `INVALID_URL`

## Error Message
"Invalid URL"

## Status: PASSING ✓
All test cases passed. URL validation working correctly via CLI and content creation API.
