/**
 * Cookie Consent Module
 *
 * Injects a cookie consent banner into public-facing pages.
 * Consent preferences are stored in localStorage on the client.
 *
 * Categories:
 *   - necessary: Always enabled, cannot be disabled
 *   - analytics: Site analytics and performance tracking
 *   - marketing: Third-party advertising and tracking
 *
 * Admin configuration at /admin/config/cookie-consent
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const hooks = {
  boot(ctx) {
    console.log('[cookie-consent] Module initialized');
  },

  routes(register, ctx) {
    // Admin config page
    register('GET', '/admin/config/cookie-consent', (req, res) => {
      const template = ctx.services.get('template');
      const content = `
        <div class="admin-breadcrumb">
          <a href="/admin">Home</a> <span>&rsaquo;</span>
          <a href="/admin/config">Configuration</a> <span>&rsaquo;</span>
          <span>Cookie Consent</span>
        </div>
        <h1 class="admin-page-title">Cookie Consent Settings</h1>
        <p class="admin-page-description">Configure the cookie consent banner shown to visitors.</p>

        <div class="admin-panel">
          <div class="admin-panel-header"><h2>Banner Configuration</h2></div>
          <div class="admin-panel-body">
            <p class="text-muted text-sm">
              The cookie consent banner is automatically injected on all public-facing pages.
              Visitors can accept or customize their cookie preferences.
              Consent state is stored in the visitor's browser via localStorage.
            </p>
            <h3 style="margin-top:1rem">Cookie Categories</h3>
            <table class="admin-table">
              <thead><tr><th>Category</th><th>Description</th><th>Required</th></tr></thead>
              <tbody>
                <tr><td><strong>Necessary</strong></td><td>Essential cookies for site functionality (sessions, CSRF)</td><td><span class="status-badge status-badge--published">Always on</span></td></tr>
                <tr><td><strong>Analytics</strong></td><td>Performance and usage analytics</td><td><span class="status-badge status-badge--draft">Optional</span></td></tr>
                <tr><td><strong>Marketing</strong></td><td>Third-party advertising and tracking</td><td><span class="status-badge status-badge--draft">Optional</span></td></tr>
              </tbody>
            </table>
          </div>
        </div>
      `;

      const html = template.renderWithLayout('admin-layout.html', content, {
        title: 'Cookie Consent',
        username: ctx.session?.user?.username || 'admin',
        usernameInitial: (ctx.session?.user?.username || 'A').charAt(0).toUpperCase(),
        navConfig: true,
      });

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    });
  },
};

/**
 * Returns the cookie consent banner HTML/JS snippet to inject into pages.
 * This can be called from the template engine or layout hook.
 */
export function getBannerSnippet() {
  return `
<!-- Cookie Consent Banner -->
<div id="cookieConsent" style="display:none;position:fixed;bottom:0;left:0;right:0;z-index:9998;padding:1rem 1.5rem;background:#27272a;color:#e4e4e7;font-family:sans-serif;font-size:14px;box-shadow:0 -2px 10px rgba(0,0,0,0.2)">
  <div style="max-width:1200px;margin:0 auto;display:flex;align-items:center;gap:1rem;flex-wrap:wrap">
    <p style="flex:1;margin:0;min-width:200px">
      We use cookies to enhance your experience. By continuing to visit this site you agree to our use of necessary cookies. You can customize your preferences.
    </p>
    <div style="display:flex;gap:0.5rem;flex-shrink:0">
      <button onclick="acceptAllCookies()" style="padding:6px 16px;background:#2c59ee;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:500">Accept All</button>
      <button onclick="acceptNecessaryCookies()" style="padding:6px 16px;background:transparent;color:#e4e4e7;border:1px solid #52525b;border-radius:6px;cursor:pointer;font-weight:500">Necessary Only</button>
    </div>
  </div>
</div>
<script>
(function() {
  var consent = localStorage.getItem('cookie-consent');
  if (!consent) {
    document.getElementById('cookieConsent').style.display = 'block';
  }
  window.acceptAllCookies = function() {
    localStorage.setItem('cookie-consent', JSON.stringify({ necessary: true, analytics: true, marketing: true, timestamp: Date.now() }));
    document.getElementById('cookieConsent').style.display = 'none';
    // Fire deferred analytics/marketing scripts on consent
    loadGatedScripts('analytics');
    loadGatedScripts('marketing');
  };
  window.acceptNecessaryCookies = function() {
    localStorage.setItem('cookie-consent', JSON.stringify({ necessary: true, analytics: false, marketing: false, timestamp: Date.now() }));
    document.getElementById('cookieConsent').style.display = 'none';
  };
  // Script gating: activate <script data-consent="analytics|marketing"> tags
  // when the matching consent category is granted (Drupal parity: klaro script blocking)
  window.loadGatedScripts = function(category) {
    document.querySelectorAll('script[data-consent="' + category + '"]').forEach(function(s) {
      if (s.dataset.loaded) return;
      s.dataset.loaded = '1';
      var ns = document.createElement('script');
      if (s.src) { ns.src = s.src; ns.async = true; }
      else { ns.textContent = s.textContent; }
      document.head.appendChild(ns);
    });
  };
  // On page load, activate scripts for already-consented categories
  var c = null;
  if (consent) { try { c = JSON.parse(consent); } catch(e) {} }
  if (c) {
    if (c.analytics) window.loadGatedScripts('analytics');
    if (c.marketing) window.loadGatedScripts('marketing');
  }
})();
</script>
`;
}
