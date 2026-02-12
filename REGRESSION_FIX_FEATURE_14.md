# Regression Fix for Feature #14: Provider Configuration UI

## Issue
The `/admin/config/ai` route returns 404 despite the code being correct and the module being enabled.

## Root Cause
The currently running server instance (PID 44219 on port 3000) was started BEFORE the ai_dashboard module routes were properly registered. The boot logs from a fresh start show that the routes ARE being registered correctly:

```
[boot] Routes registered from modules: ... GET /admin/config/ai, POST /admin/config/ai, ...
```

## Verification
The code is correct:
- Module exists: `/modules/ai_dashboard/index.js`
- Module is enabled in: `/config/modules.json` (line 14)
- Routes are registered: `hook_routes` function at lines 1272-1456
- Service dependencies are met: `ai-provider-manager` service is registered

## Fix Required
**Restart the server** to pick up the registered routes.

### Option 1: Manual Restart
```bash
# Kill the current server
pkill node

# Start the server
cd /Users/Alchemy/Projects/experiments/cms-core
node index.js
```

### Option 2: If port 3001 binding fails
The config was set to port 3001, which may have permission issues. It has been changed to port 3000 in `/config/site.json`.

If you still see "EPERM: operation not permitted" errors when binding to ports, you may need to:
1. Check firewall/security settings
2. Run with appropriate permissions
3. Use a different port (e.g., 8080)

## After Restart
Once restarted, navigate to `http://localhost:3000/admin/config/ai` and verify:
1. Page loads successfully
2. Shows list of available providers
3. Can add/edit API keys
4. Can enable/disable providers
5. Configuration saves persist to `/config/ai_providers.json`

## Status
- **Code**: ✅ Correct
- **Configuration**: ✅ Module enabled
- **Runtime**: ❌ Needs server restart
