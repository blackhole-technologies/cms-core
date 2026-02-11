/**
 * recent-errors.js - Recent Errors Widget
 *
 * Shows the last 10 AI operation errors with timestamps.
 * Helps identify and troubleshoot failing AI operations.
 */

/**
 * Fetch recent errors from AI stats
 *
 * @param {Object} context - Request context with services
 * @returns {Promise<Object>} Recent errors
 */
export async function fetchData(context) {
  const aiStats = context.services.get('ai-stats');

  // Get last 7 days of data
  const now = new Date();
  const allErrors = [];

  for (let i = 0; i < 7; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];

    const dailyStats = aiStats.getDaily(dateStr);

    if (dailyStats && dailyStats.totalEvents > 0) {
      // Read raw events to find errors
      const { readFileSync, existsSync } = await import('node:fs');
      const { join } = await import('node:path');

      const statsDir = join(context.baseDir, 'content', 'ai-stats');
      const filePath = join(statsDir, `${dateStr}.json`);

      if (existsSync(filePath)) {
        try {
          const content = readFileSync(filePath, 'utf-8');
          const events = JSON.parse(content);

          // Filter for errors and timeouts
          for (const event of events) {
            if (event.status === 'error' || event.status === 'timeout') {
              allErrors.push({
                timestamp: event.timestamp,
                provider: event.provider || 'unknown',
                operation: event.operation || 'unknown',
                status: event.status,
                error: event.error || 'No error message',
              });
            }
          }
        } catch (err) {
          console.error(`[recent-errors] Error reading ${filePath}:`, err.message);
        }
      }
    }
  }

  // Sort by timestamp descending (most recent first)
  allErrors.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  // Take last 10 errors
  const recentErrors = allErrors.slice(0, 10);

  return {
    errors: recentErrors,
    totalErrors: allErrors.length,
  };
}

/**
 * Format timestamp for display
 */
function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

/**
 * Render the recent errors list
 *
 * @param {Object} data - Error data
 * @returns {string} HTML string
 */
export function render(data) {
  if (data.error) {
    return `<div class="widget-error">Error: ${data.error}</div>`;
  }

  const { errors, totalErrors } = data;

  if (errors.length === 0) {
    return `<div class="widget-success">
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" style="margin: 1rem auto; display: block;">
        <circle cx="24" cy="24" r="20" fill="#10b981" opacity="0.1"/>
        <path d="M34 18L21 31L14 24" stroke="#10b981" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <p style="text-align: center; color: #10b981; font-weight: 500;">No errors in the last 7 days</p>
    </div>`;
  }

  const errorRows = errors.map(err => {
    const statusColor = err.status === 'timeout' ? '#f59e0b' : '#ef4444';
    const statusLabel = err.status === 'timeout' ? 'TIMEOUT' : 'ERROR';

    return `
      <div class="error-row">
        <div class="error-header">
          <span class="error-status" style="background: ${statusColor};">${statusLabel}</span>
          <span class="error-time">${formatTimestamp(err.timestamp)}</span>
        </div>
        <div class="error-details">
          <strong>${err.provider}</strong> › ${err.operation}
        </div>
        <div class="error-message">${err.error}</div>
      </div>
    `;
  }).join('');

  return `
    <div class="recent-errors">
      ${totalErrors > 10 ? `<div class="error-summary">Showing 10 of ${totalErrors} errors from last 7 days</div>` : ''}
      <div class="error-list">
        ${errorRows}
      </div>
    </div>
    <style>
      .recent-errors {
        padding: 0.5rem 0;
      }
      .error-summary {
        font-size: 0.875rem;
        color: #6b7280;
        margin-bottom: 0.75rem;
        text-align: center;
      }
      .error-list {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        max-height: 400px;
        overflow-y: auto;
      }
      .error-row {
        padding: 0.75rem;
        background: #fef2f2;
        border-left: 3px solid #ef4444;
        border-radius: 4px;
        font-size: 0.875rem;
      }
      .error-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0.5rem;
      }
      .error-status {
        display: inline-block;
        padding: 2px 6px;
        border-radius: 3px;
        color: white;
        font-size: 0.7rem;
        font-weight: 600;
        letter-spacing: 0.5px;
      }
      .error-time {
        font-size: 0.75rem;
        color: #6b7280;
      }
      .error-details {
        margin-bottom: 0.25rem;
        color: #374151;
      }
      .error-message {
        font-size: 0.8rem;
        color: #dc2626;
        font-family: monospace;
        background: rgba(239, 68, 68, 0.05);
        padding: 0.25rem 0.5rem;
        border-radius: 3px;
        word-break: break-word;
      }
      .widget-success {
        padding: 2rem 1rem;
        text-align: center;
      }
    </style>
  `;
}

export const widget = {
  id: 'recent-errors',
  title: 'Recent Errors',
  fetchData,
  render,
  refreshInterval: 60000, // Refresh every 60 seconds
};
