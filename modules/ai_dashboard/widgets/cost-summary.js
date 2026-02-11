/**
 * cost-summary.js - Cost Summary Widget
 *
 * Shows AI usage costs: today's cost, month-to-date, and trend vs last month.
 * Helps track spending on AI operations.
 */

/**
 * Fetch cost summary data
 *
 * @param {Object} context - Request context with services
 * @returns {Promise<Object>} Cost summary
 */
export async function fetchData(context) {
  const aiStats = context.services.get('ai-stats');

  const now = new Date();
  const today = now.toISOString().split('T')[0];

  // Get current month dates
  const year = now.getFullYear();
  const month = now.getMonth();
  const firstDayOfMonth = new Date(year, month, 1);
  const lastDayOfMonth = new Date(year, month + 1, 0);

  // Get last month dates
  const firstDayOfLastMonth = new Date(year, month - 1, 1);
  const lastDayOfLastMonth = new Date(year, month, 0);

  // Calculate costs
  let todayCost = 0;
  let monthCost = 0;
  let lastMonthCost = 0;
  let todayCalls = 0;
  let monthCalls = 0;

  const { readFileSync, existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  const statsDir = join(context.baseDir, 'content', 'ai-stats');

  // Today's cost
  const todayPath = join(statsDir, `${today}.json`);
  if (existsSync(todayPath)) {
    try {
      const content = readFileSync(todayPath, 'utf-8');
      const events = JSON.parse(content);
      todayCost = events.reduce((sum, e) => sum + (e.cost || 0), 0);
      todayCalls = events.length;
    } catch (err) {
      console.error('[cost-summary] Error reading today stats:', err.message);
    }
  }

  // Month-to-date cost
  for (let d = new Date(firstDayOfMonth); d <= now; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    const filePath = join(statsDir, `${dateStr}.json`);

    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, 'utf-8');
        const events = JSON.parse(content);
        monthCost += events.reduce((sum, e) => sum + (e.cost || 0), 0);
        monthCalls += events.length;
      } catch (err) {
        // Skip files with errors
      }
    }
  }

  // Last month cost (for comparison)
  for (let d = new Date(firstDayOfLastMonth); d <= lastDayOfLastMonth; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    const filePath = join(statsDir, `${dateStr}.json`);

    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, 'utf-8');
        const events = JSON.parse(content);
        lastMonthCost += events.reduce((sum, e) => sum + (e.cost || 0), 0);
      } catch (err) {
        // Skip files with errors
      }
    }
  }

  // Calculate trend
  const trend = lastMonthCost > 0 ? ((monthCost - lastMonthCost) / lastMonthCost) * 100 : 0;

  return {
    todayCost,
    todayCalls,
    monthCost,
    monthCalls,
    lastMonthCost,
    trend,
  };
}

/**
 * Format currency
 */
function formatCost(cost) {
  if (cost === 0) return '$0.00';
  if (cost < 0.01) return '<$0.01';
  return '$' + cost.toFixed(2);
}

/**
 * Render the cost summary
 *
 * @param {Object} data - Cost data
 * @returns {string} HTML string
 */
export function render(data) {
  if (data.error) {
    return `<div class="widget-error">Error: ${data.error}</div>`;
  }

  const { todayCost, todayCalls, monthCost, monthCalls, lastMonthCost, trend } = data;

  const trendColor = trend > 0 ? '#ef4444' : trend < 0 ? '#10b981' : '#6b7280';
  const trendIcon = trend > 0 ? '↑' : trend < 0 ? '↓' : '→';
  const trendLabel = trend > 0 ? 'increase' : trend < 0 ? 'decrease' : 'no change';

  return `
    <div class="cost-summary">
      <div class="cost-cards">
        <div class="cost-card">
          <div class="cost-label">Today</div>
          <div class="cost-value">${formatCost(todayCost)}</div>
          <div class="cost-detail">${todayCalls} calls</div>
        </div>
        <div class="cost-card">
          <div class="cost-label">Month to Date</div>
          <div class="cost-value">${formatCost(monthCost)}</div>
          <div class="cost-detail">${monthCalls} calls</div>
        </div>
        <div class="cost-card">
          <div class="cost-label">Last Month</div>
          <div class="cost-value">${formatCost(lastMonthCost)}</div>
          <div class="cost-detail">Reference</div>
        </div>
      </div>
      <div class="cost-trend" style="border-color: ${trendColor};">
        <div class="trend-label">vs Last Month</div>
        <div class="trend-value" style="color: ${trendColor};">
          <span class="trend-icon">${trendIcon}</span>
          <span>${Math.abs(trend).toFixed(1)}%</span>
        </div>
        <div class="trend-description">${trendLabel} from last month</div>
      </div>
    </div>
    <style>
      .cost-summary {
        padding: 0.5rem 0;
      }
      .cost-cards {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 0.75rem;
        margin-bottom: 1rem;
      }
      .cost-card {
        background: #f9fafb;
        border: 1px solid #e5e7eb;
        border-radius: 6px;
        padding: 1rem;
        text-align: center;
      }
      .cost-label {
        font-size: 0.75rem;
        color: #6b7280;
        margin-bottom: 0.5rem;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .cost-value {
        font-size: 1.5rem;
        font-weight: 700;
        color: #111827;
        margin-bottom: 0.25rem;
      }
      .cost-detail {
        font-size: 0.75rem;
        color: #9ca3af;
      }
      .cost-trend {
        background: #ffffff;
        border: 2px solid;
        border-radius: 6px;
        padding: 1rem;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .trend-label {
        font-size: 0.875rem;
        color: #6b7280;
      }
      .trend-value {
        font-size: 1.25rem;
        font-weight: 700;
        display: flex;
        align-items: center;
        gap: 0.25rem;
      }
      .trend-icon {
        font-size: 1.5rem;
      }
      .trend-description {
        font-size: 0.75rem;
        color: #9ca3af;
      }
      @media (max-width: 768px) {
        .cost-cards {
          grid-template-columns: 1fr;
        }
        .cost-trend {
          flex-direction: column;
          text-align: center;
          gap: 0.5rem;
        }
      }
    </style>
  `;
}

export const widget = {
  id: 'cost-summary',
  title: 'Cost Summary',
  fetchData,
  render,
  refreshInterval: 300000, // Refresh every 5 minutes
};
