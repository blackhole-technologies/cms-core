/**
 * top-providers.js - Top Providers Widget
 *
 * Shows providers ranked by usage (call count) over the last 7 days.
 * Displays as a horizontal bar chart.
 */

/**
 * Fetch top providers data
 *
 * @param {Object} context - Request context with services
 * @returns {Promise<Object>} Provider rankings
 */
export async function fetchData(context) {
  const aiStats = context.services.get('ai-stats');

  // Get last 7 days
  const now = new Date();
  const providers = {};

  for (let i = 0; i < 7; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];

    const dailyStats = aiStats.getDaily(dateStr);

    if (dailyStats && dailyStats.totalEvents > 0) {
      // Read raw events to get provider breakdown
      const { readFileSync, existsSync } = await import('node:fs');
      const { join } = await import('node:path');

      const statsDir = join(context.baseDir, 'content', 'ai-stats');
      const filePath = join(statsDir, `${dateStr}.json`);

      if (existsSync(filePath)) {
        try {
          const content = readFileSync(filePath, 'utf-8');
          const events = JSON.parse(content);

          for (const event of events) {
            const provider = event.provider || 'unknown';
            if (!providers[provider]) {
              providers[provider] = {
                name: provider,
                calls: 0,
                tokens: 0,
                cost: 0,
              };
            }
            providers[provider].calls++;
            providers[provider].tokens += (event.tokensIn || 0) + (event.tokensOut || 0);
            providers[provider].cost += (event.cost || 0);
          }
        } catch (err) {
          console.error(`[top-providers] Error reading ${filePath}:`, err.message);
        }
      }
    }
  }

  // Convert to array and sort by calls
  const providerList = Object.values(providers);
  providerList.sort((a, b) => b.calls - a.calls);

  // Take top 5
  const topProviders = providerList.slice(0, 5);
  const maxCalls = topProviders.length > 0 ? topProviders[0].calls : 1;

  return {
    providers: topProviders,
    total: providerList.reduce((sum, p) => sum + p.calls, 0),
    maxCalls,
  };
}

/**
 * Render the top providers chart
 *
 * @param {Object} data - Provider data
 * @returns {string} HTML string
 */
export function render(data) {
  if (data.error) {
    return `<div class="widget-error">Error: ${data.error}</div>`;
  }

  const { providers, total, maxCalls } = data;

  if (providers.length === 0) {
    return `<div class="widget-empty">No provider activity in the last 7 days</div>`;
  }

  const bars = providers.map((provider, index) => {
    const percentage = maxCalls > 0 ? (provider.calls / maxCalls) * 100 : 0;
    const color = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'][index % 5];

    return `
      <div class="provider-row">
        <div class="provider-name">${provider.name}</div>
        <div class="provider-bar-track">
          <div class="provider-bar" style="width: ${percentage}%; background: ${color};" title="${provider.calls} calls"></div>
        </div>
        <div class="provider-value">${provider.calls}</div>
      </div>
    `;
  }).join('');

  return `
    <div class="top-providers">
      <div class="provider-summary">
        <span><strong>${total}</strong> total calls</span>
        <span>Last 7 days</span>
      </div>
      <div class="provider-list">
        ${bars}
      </div>
    </div>
    <style>
      .top-providers {
        padding: 0.5rem 0;
      }
      .provider-summary {
        display: flex;
        justify-content: space-between;
        margin-bottom: 1rem;
        font-size: 0.875rem;
        color: #6b7280;
      }
      .provider-list {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      .provider-row {
        display: grid;
        grid-template-columns: 120px 1fr 60px;
        align-items: center;
        gap: 0.75rem;
      }
      .provider-name {
        font-size: 0.875rem;
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .provider-bar-track {
        height: 24px;
        background: #f3f4f6;
        border-radius: 4px;
        overflow: hidden;
      }
      .provider-bar {
        height: 100%;
        border-radius: 4px;
        transition: width 0.3s ease;
      }
      .provider-value {
        font-size: 0.875rem;
        font-weight: 600;
        text-align: right;
        color: #374151;
      }
      @media (max-width: 768px) {
        .provider-row {
          grid-template-columns: 80px 1fr 50px;
          gap: 0.5rem;
        }
        .provider-name {
          font-size: 0.75rem;
        }
      }
    </style>
  `;
}

export const widget = {
  id: 'top-providers',
  title: 'Top Providers',
  fetchData,
  render,
  refreshInterval: 300000, // Refresh every 5 minutes
};
