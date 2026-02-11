/**
 * activity-chart.js - Activity Chart Widget
 *
 * Shows AI API calls over the last 24 hours grouped by hour buckets.
 * Displays as a simple line/bar chart using ASCII or HTML bars.
 */

/**
 * Fetch activity data for the last 24 hours
 *
 * @param {Object} context - Request context with services
 * @returns {Promise<Object>} Activity data by hour
 */
export async function fetchData(context) {
  const aiStats = context.services.get('ai-stats');

  // Get today's date
  const now = new Date();
  const today = now.toISOString().split('T')[0];

  // Get yesterday's date
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  // Fetch stats for today and yesterday
  const todayStats = aiStats.getDaily(today);
  const yesterdayStats = aiStats.getDaily(yesterdayStr);

  // Read raw events from files to get hourly breakdown
  const { readFileSync, existsSync } = await import('node:fs');
  const { join } = await import('node:path');

  const statsDir = join(context.baseDir, 'content', 'ai-stats');
  const allEvents = [];

  // Read today's events
  const todayPath = join(statsDir, `${today}.json`);
  if (existsSync(todayPath)) {
    try {
      const content = readFileSync(todayPath, 'utf-8');
      const events = JSON.parse(content);
      allEvents.push(...events);
    } catch (err) {
      console.error('[activity-chart] Error reading today stats:', err.message);
    }
  }

  // Read yesterday's events
  const yesterdayPath = join(statsDir, `${yesterdayStr}.json`);
  if (existsSync(yesterdayPath)) {
    try {
      const content = readFileSync(yesterdayPath, 'utf-8');
      const events = JSON.parse(content);
      allEvents.push(...events);
    } catch (err) {
      console.error('[activity-chart] Error reading yesterday stats:', err.message);
    }
  }

  // Filter to last 24 hours and group by hour
  const cutoff = Date.now() - (24 * 60 * 60 * 1000);
  const hourlyBuckets = {};

  for (const event of allEvents) {
    const timestamp = new Date(event.timestamp).getTime();
    if (timestamp < cutoff) continue;

    const hour = new Date(event.timestamp).toISOString().substring(0, 13); // YYYY-MM-DDTHH
    hourlyBuckets[hour] = (hourlyBuckets[hour] || 0) + 1;
  }

  // Generate array of last 24 hours
  const hours = [];
  for (let i = 23; i >= 0; i--) {
    const hourDate = new Date(now.getTime() - (i * 60 * 60 * 1000));
    const hourKey = hourDate.toISOString().substring(0, 13);
    hours.push({
      hour: hourKey,
      label: hourDate.getHours().toString().padStart(2, '0') + ':00',
      count: hourlyBuckets[hourKey] || 0,
    });
  }

  return {
    hours,
    total: hours.reduce((sum, h) => sum + h.count, 0),
    max: Math.max(...hours.map(h => h.count), 1),
  };
}

/**
 * Render the activity chart
 *
 * @param {Object} data - Chart data
 * @returns {string} HTML string
 */
export function render(data) {
  if (data.error) {
    return `<div class="widget-error">Error: ${data.error}</div>`;
  }

  const { hours, total, max } = data;

  if (total === 0) {
    return `<div class="widget-empty">No activity in the last 24 hours</div>`;
  }

  // Render as simple bar chart
  const bars = hours.map(h => {
    const percentage = max > 0 ? (h.count / max) * 100 : 0;
    const height = Math.max(percentage, 2); // Minimum 2% for visibility

    return `
      <div class="chart-bar-container" title="${h.label}: ${h.count} calls">
        <div class="chart-bar" style="height: ${height}%; background: #3b82f6;">
          <span class="chart-value">${h.count}</span>
        </div>
        <div class="chart-label">${h.label}</div>
      </div>
    `;
  }).join('');

  return `
    <div class="activity-chart">
      <div class="chart-summary">
        <span><strong>${total}</strong> calls in last 24 hours</span>
        <span>Peak: <strong>${max}</strong> calls/hour</span>
      </div>
      <div class="chart-bars">
        ${bars}
      </div>
    </div>
    <style>
      .activity-chart {
        padding: 0.5rem 0;
      }
      .chart-summary {
        display: flex;
        justify-content: space-between;
        margin-bottom: 1rem;
        font-size: 0.875rem;
        color: #6b7280;
      }
      .chart-bars {
        display: flex;
        align-items: flex-end;
        gap: 2px;
        height: 120px;
        border-bottom: 1px solid #e5e7eb;
      }
      .chart-bar-container {
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        align-items: center;
        height: 100%;
      }
      .chart-bar {
        width: 100%;
        background: #3b82f6;
        border-radius: 2px 2px 0 0;
        position: relative;
        transition: opacity 0.2s;
        min-height: 2px;
      }
      .chart-bar:hover {
        opacity: 0.8;
      }
      .chart-value {
        position: absolute;
        top: -18px;
        left: 50%;
        transform: translateX(-50%);
        font-size: 0.7rem;
        color: #374151;
        display: none;
      }
      .chart-bar:hover .chart-value {
        display: block;
      }
      .chart-label {
        font-size: 0.65rem;
        color: #9ca3af;
        margin-top: 4px;
        writing-mode: horizontal-tb;
        transform: rotate(-45deg);
        transform-origin: center;
        width: 100%;
        text-align: center;
      }
      @media (max-width: 768px) {
        .chart-label {
          font-size: 0.55rem;
        }
      }
    </style>
  `;
}

export const widget = {
  id: 'activity-chart',
  title: 'Activity Chart',
  fetchData,
  render,
  refreshInterval: 60000, // Refresh every 60 seconds
};
