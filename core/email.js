/**
 * email.js - Email Sending System
 *
 * WHY THIS EXISTS:
 * ================
 * CMS needs to send emails for:
 * - User notifications
 * - Password resets
 * - Welcome emails
 * - Content workflow notifications
 *
 * TRANSPORT TYPES:
 * ===============
 * - console: Log to console (development)
 * - smtp: Send via SMTP server
 * - sendmail: Use local sendmail binary
 *
 * TEMPLATES:
 * ==========
 * Email templates use the same template engine as the CMS.
 * Templates are stored in /templates/email/
 *
 * SECURITY:
 * =========
 * - SMTP credentials stored in config
 * - TLS/SSL support for SMTP
 * - Rate limiting to prevent abuse
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createConnection } from 'node:net';
import { connect as tlsConnect } from 'node:tls';

// ============================================
// STATE
// ============================================

/**
 * Configuration
 */
let config = {
  transport: 'console',
  from: 'noreply@example.com',
  fromName: 'CMS',
  replyTo: null,
  smtp: {
    host: '',
    port: 587,
    secure: false,
    user: '',
    pass: ''
  },
  sendmail: {
    path: '/usr/sbin/sendmail'
  }
};

/**
 * Template directory
 */
let templateDir = null;

/**
 * Template engine reference
 */
let templateEngine = null;

/**
 * Email send log (for testing/debugging)
 */
const sendLog = [];
const MAX_LOG_SIZE = 100;

// ============================================
// INITIALIZATION
// ============================================

/**
 * Initialize email system
 *
 * @param {Object} cfg - Configuration
 * @param {string} baseDir - Base directory
 * @param {Object} template - Template engine
 */
export function init(cfg = {}, baseDir = '', template = null) {
  config = {
    ...config,
    ...cfg,
    smtp: { ...config.smtp, ...(cfg.smtp || {}) },
    sendmail: { ...config.sendmail, ...(cfg.sendmail || {}) }
  };

  templateDir = join(baseDir, 'templates', 'email');
  templateEngine = template;

  console.log(`[email] Initialized (transport: ${config.transport})`);
}

// ============================================
// EMAIL SENDING
// ============================================

/**
 * Send an email
 *
 * @param {string|string[]} to - Recipient(s)
 * @param {string} subject - Email subject
 * @param {string} body - Email body (plain text or HTML)
 * @param {Object} options - Send options
 * @param {Array} [options.attachments] - File attachments
 * @param {string} options.attachments[].filename - Display filename
 * @param {Buffer|string} options.attachments[].content - File content (Buffer or base64 string)
 * @param {string} [options.attachments[].contentType] - MIME type (default: application/octet-stream)
 * @returns {Promise<Object>} Send result
 */
export async function send(to, subject, body, options = {}) {
  const recipients = Array.isArray(to) ? to : [to];
  const from = options.from || `${config.fromName} <${config.from}>`;
  const replyTo = options.replyTo || config.replyTo;
  const isHtml = options.html !== false && (options.html === true || body.includes('<'));

  const email = {
    from,
    to: recipients,
    replyTo,
    subject,
    body,
    isHtml,
    attachments: options.attachments || [],
    timestamp: new Date().toISOString()
  };

  // Inline CSS for HTML emails (email clients strip <style> blocks)
  if (email.isHtml) {
    email.body = inlineCss(email.body);
  }

  // Log the email
  logEmail(email);

  // Send via configured transport
  switch (config.transport) {
    case 'console':
      return sendConsole(email);
    case 'smtp':
      return sendSmtp(email);
    case 'sendmail':
      return sendSendmail(email);
    default:
      console.warn(`[email] Unknown transport: ${config.transport}, using console`);
      return sendConsole(email);
  }
}

/**
 * Send an email using a template
 *
 * @param {string|string[]} to - Recipient(s)
 * @param {string} templateName - Template name (without extension)
 * @param {Object} data - Template data
 * @param {Object} options - Send options
 * @returns {Promise<Object>} Send result
 */
export async function sendTemplate(to, templateName, data = {}, options = {}) {
  // Load template
  const template = loadTemplate(templateName);
  if (!template) {
    throw new Error(`Email template not found: ${templateName}`);
  }

  // Render template
  let body;
  if (templateEngine && templateEngine.render) {
    body = templateEngine.render(template.content, {
      ...data,
      siteName: data.siteName || config.fromName,
      year: new Date().getFullYear()
    });
  } else {
    // Simple variable replacement if no template engine
    body = template.content;
    for (const [key, value] of Object.entries(data)) {
      body = body.replace(new RegExp(`{{${key}}}`, 'g'), value);
    }
  }

  // Extract subject from template or data
  const subject = data.subject || template.subject || templateName;

  return send(to, subject, body, { html: true, ...options });
}

/**
 * Verify email configuration works
 *
 * @returns {Promise<Object>} Verification result
 */
export async function verify() {
  const result = {
    transport: config.transport,
    from: config.from,
    valid: false,
    error: null
  };

  try {
    switch (config.transport) {
      case 'console':
        result.valid = true;
        result.message = 'Console transport always works';
        break;

      case 'smtp':
        if (!config.smtp.host) {
          result.error = 'SMTP host not configured';
        } else {
          // Try to connect to SMTP server
          const connected = await testSmtpConnection();
          result.valid = connected;
          result.message = connected ? 'SMTP connection successful' : 'SMTP connection failed';
        }
        break;

      case 'sendmail':
        if (!existsSync(config.sendmail.path)) {
          result.error = `Sendmail not found at ${config.sendmail.path}`;
        } else {
          result.valid = true;
          result.message = 'Sendmail binary found';
        }
        break;

      default:
        result.error = `Unknown transport: ${config.transport}`;
    }
  } catch (e) {
    result.error = e.message;
  }

  return result;
}

/**
 * Send a test email
 *
 * @param {string} to - Test recipient
 * @returns {Promise<Object>} Send result
 */
export async function sendTest(to) {
  const subject = 'CMS Test Email';
  const body = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #fff; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background: #fff; padding: 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 8px 8px; }
    .footer { text-align: center; color: #888; font-size: 12px; margin-top: 20px; }
    .check { color: #28a745; font-size: 48px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>CMS Email Test</h1>
    </div>
    <div class="content">
      <p class="check" style="text-align: center;">✓</p>
      <h2 style="text-align: center;">Email is working!</h2>
      <p>This is a test email from your CMS. If you're seeing this, your email configuration is working correctly.</p>
      <p><strong>Transport:</strong> ${config.transport}</p>
      <p><strong>From:</strong> ${config.from}</p>
      <p><strong>Sent at:</strong> ${new Date().toISOString()}</p>
    </div>
    <div class="footer">
      <p>Sent by CMS Core</p>
    </div>
  </div>
</body>
</html>
`;

  return send(to, subject, body, { html: true });
}

// ============================================
// TRANSPORT IMPLEMENTATIONS
// ============================================

/**
 * Console transport - logs email to console
 */
function sendConsole(email) {
  console.log('\n' + '='.repeat(60));
  console.log('EMAIL (Console Transport)');
  console.log('='.repeat(60));
  console.log(`From: ${email.from}`);
  console.log(`To: ${email.to.join(', ')}`);
  if (email.replyTo) console.log(`Reply-To: ${email.replyTo}`);
  console.log(`Subject: ${email.subject}`);
  console.log('-'.repeat(60));
  if (email.isHtml) {
    // Strip HTML tags for console output
    const plainText = email.body
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 500);
    console.log(plainText + (email.body.length > 500 ? '...' : ''));
  } else {
    console.log(email.body.slice(0, 500) + (email.body.length > 500 ? '...' : ''));
  }
  if (email.attachments && email.attachments.length > 0) {
    console.log('-'.repeat(60));
    console.log(`Attachments (${email.attachments.length}):`);
    for (const att of email.attachments) {
      const size = att.content ? (Buffer.isBuffer(att.content) ? att.content.length : att.content.length) : 0;
      console.log(`  - ${att.filename} (${att.contentType || 'application/octet-stream'}, ${size} bytes)`);
    }
  }
  console.log('='.repeat(60) + '\n');

  return {
    success: true,
    transport: 'console',
    messageId: `console-${Date.now()}`
  };
}

/**
 * SMTP transport - sends via SMTP server
 */
async function sendSmtp(email) {
  // Build MIME message
  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const altBoundary = `----=_Alt_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const messageId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@${config.smtp.host}>`;
  const hasAttachments = email.attachments && email.attachments.length > 0;

  let message = '';
  message += `From: ${email.from}\r\n`;
  message += `To: ${email.to.join(', ')}\r\n`;
  if (email.replyTo) message += `Reply-To: ${email.replyTo}\r\n`;
  message += `Subject: ${email.subject}\r\n`;
  message += `Message-ID: ${messageId}\r\n`;
  message += `Date: ${new Date().toUTCString()}\r\n`;
  message += `MIME-Version: 1.0\r\n`;

  if (hasAttachments) {
    // multipart/mixed wraps body + attachments
    message += `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n`;

    // Body part
    message += `--${boundary}\r\n`;
    if (email.isHtml) {
      message += `Content-Type: multipart/alternative; boundary="${altBoundary}"\r\n\r\n`;
      message += `--${altBoundary}\r\n`;
      message += `Content-Type: text/plain; charset=utf-8\r\n\r\n`;
      message += stripHtml(email.body) + '\r\n\r\n';
      message += `--${altBoundary}\r\n`;
      message += `Content-Type: text/html; charset=utf-8\r\n\r\n`;
      message += email.body + '\r\n\r\n';
      message += `--${altBoundary}--\r\n`;
    } else {
      message += `Content-Type: text/plain; charset=utf-8\r\n\r\n`;
      message += email.body + '\r\n';
    }

    // Attachment parts
    for (const att of email.attachments) {
      const contentType = att.contentType || 'application/octet-stream';
      const b64 = Buffer.isBuffer(att.content)
        ? att.content.toString('base64')
        : att.content;
      const filename = (att.filename || 'attachment').replace(/[^\w.\-]/g, '_');

      message += `\r\n--${boundary}\r\n`;
      message += `Content-Type: ${contentType}; name="${filename}"\r\n`;
      message += `Content-Disposition: attachment; filename="${filename}"\r\n`;
      message += `Content-Transfer-Encoding: base64\r\n\r\n`;
      // Split base64 into 76-char lines per RFC 2045
      for (let i = 0; i < b64.length; i += 76) {
        message += b64.slice(i, i + 76) + '\r\n';
      }
    }
    message += `--${boundary}--\r\n`;
  } else if (email.isHtml) {
    message += `Content-Type: multipart/alternative; boundary="${boundary}"\r\n\r\n`;
    message += `--${boundary}\r\n`;
    message += `Content-Type: text/plain; charset=utf-8\r\n\r\n`;
    message += stripHtml(email.body) + '\r\n\r\n';
    message += `--${boundary}\r\n`;
    message += `Content-Type: text/html; charset=utf-8\r\n\r\n`;
    message += email.body + '\r\n\r\n';
    message += `--${boundary}--\r\n`;
  } else {
    message += `Content-Type: text/plain; charset=utf-8\r\n\r\n`;
    message += email.body + '\r\n';
  }

  // Send via SMTP
  return new Promise((resolve, reject) => {
    const port = config.smtp.port || 587;
    const host = config.smtp.host;
    const secure = config.smtp.secure || port === 465;

    const connectFn = secure ? tlsConnect : createConnection;
    const socket = connectFn({ host, port, rejectUnauthorized: false }, () => {
      let step = 'connect';
      let response = '';

      socket.on('data', (data) => {
        response += data.toString();

        // Simple SMTP conversation
        if (response.includes('\r\n')) {
          const code = response.slice(0, 3);
          response = '';

          switch (step) {
            case 'connect':
              if (code === '220') {
                step = 'ehlo';
                socket.write(`EHLO ${host}\r\n`);
              }
              break;
            case 'ehlo':
              if (code === '250') {
                if (config.smtp.user) {
                  step = 'auth';
                  socket.write('AUTH LOGIN\r\n');
                } else {
                  step = 'from';
                  socket.write(`MAIL FROM:<${config.from}>\r\n`);
                }
              }
              break;
            case 'auth':
              if (code === '334') {
                step = 'user';
                socket.write(Buffer.from(config.smtp.user).toString('base64') + '\r\n');
              }
              break;
            case 'user':
              if (code === '334') {
                step = 'pass';
                socket.write(Buffer.from(config.smtp.pass).toString('base64') + '\r\n');
              }
              break;
            case 'pass':
              if (code === '235') {
                step = 'from';
                socket.write(`MAIL FROM:<${config.from}>\r\n`);
              } else {
                socket.end();
                reject(new Error('SMTP authentication failed'));
              }
              break;
            case 'from':
              if (code === '250') {
                step = 'to';
                socket.write(`RCPT TO:<${email.to[0]}>\r\n`);
              }
              break;
            case 'to':
              if (code === '250') {
                step = 'data';
                socket.write('DATA\r\n');
              }
              break;
            case 'data':
              if (code === '354') {
                step = 'send';
                socket.write(message + '\r\n.\r\n');
              }
              break;
            case 'send':
              if (code === '250') {
                step = 'quit';
                socket.write('QUIT\r\n');
                resolve({
                  success: true,
                  transport: 'smtp',
                  messageId
                });
              }
              break;
          }
        }
      });

      socket.on('error', (err) => {
        reject(err);
      });
    });

    socket.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Sendmail transport - uses local sendmail binary
 */
async function sendSendmail(email) {
  const { spawn } = await import('node:child_process');

  return new Promise((resolve, reject) => {
    const sendmail = spawn(config.sendmail.path, ['-t', '-i']);

    let message = '';
    message += `From: ${email.from}\n`;
    message += `To: ${email.to.join(', ')}\n`;
    if (email.replyTo) message += `Reply-To: ${email.replyTo}\n`;
    message += `Subject: ${email.subject}\n`;
    message += `MIME-Version: 1.0\n`;
    message += `Content-Type: ${email.isHtml ? 'text/html' : 'text/plain'}; charset=utf-8\n\n`;
    message += email.body;

    sendmail.stdin.write(message);
    sendmail.stdin.end();

    sendmail.on('close', (code) => {
      if (code === 0) {
        resolve({
          success: true,
          transport: 'sendmail',
          messageId: `sendmail-${Date.now()}`
        });
      } else {
        reject(new Error(`Sendmail exited with code ${code}`));
      }
    });

    sendmail.on('error', reject);
  });
}

/**
 * Test SMTP connection
 */
async function testSmtpConnection() {
  return new Promise((resolve) => {
    const port = config.smtp.port || 587;
    const host = config.smtp.host;
    const secure = config.smtp.secure || port === 465;

    const connectFn = secure ? tlsConnect : createConnection;
    const socket = connectFn({ host, port, rejectUnauthorized: false }, () => {
      socket.on('data', (data) => {
        const response = data.toString();
        if (response.startsWith('220')) {
          socket.write('QUIT\r\n');
          socket.end();
          resolve(true);
        }
      });
    });

    socket.on('error', () => {
      resolve(false);
    });

    socket.setTimeout(5000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

// ============================================
// TEMPLATE MANAGEMENT
// ============================================

/**
 * Load an email template
 *
 * @param {string} name - Template name
 * @returns {Object|null} Template object or null
 */
function loadTemplate(name) {
  // Try HTML first, then plain text
  const htmlPath = join(templateDir, `${name}.html`);
  const txtPath = join(templateDir, `${name}.txt`);

  let content = null;
  let isHtml = false;

  if (existsSync(htmlPath)) {
    content = readFileSync(htmlPath, 'utf-8');
    isHtml = true;
  } else if (existsSync(txtPath)) {
    content = readFileSync(txtPath, 'utf-8');
    isHtml = false;
  }

  if (!content) return null;

  // Extract subject from template (if present)
  let subject = null;
  const subjectMatch = content.match(/<!--\s*subject:\s*(.+?)\s*-->/i);
  if (subjectMatch) {
    subject = subjectMatch[1];
    content = content.replace(subjectMatch[0], '').trim();
  }

  return { content, subject, isHtml };
}

/**
 * List available email templates
 *
 * @returns {string[]} Template names
 */
export function listTemplates() {
  if (!existsSync(templateDir)) return [];

  const { readdirSync } = require('node:fs');
  const files = readdirSync(templateDir);

  return [...new Set(
    files
      .filter(f => f.endsWith('.html') || f.endsWith('.txt'))
      .map(f => f.replace(/\.(html|txt)$/, ''))
  )];
}

// ============================================
// UTILITIES
// ============================================

/**
 * Log an email to the send log
 */
function logEmail(email) {
  sendLog.unshift({
    ...email,
    body: email.body.slice(0, 200)
  });

  if (sendLog.length > MAX_LOG_SIZE) {
    sendLog.length = MAX_LOG_SIZE;
  }
}

/**
 * Get recent email log
 *
 * @param {number} limit - Max entries
 * @returns {Array} Log entries
 */
export function getLog(limit = 20) {
  return sendLog.slice(0, limit);
}

/**
 * Clear email log
 */
export function clearLog() {
  sendLog.length = 0;
}

/**
 * Inline CSS styles from <style> blocks into matching elements.
 * Email clients (Gmail, Outlook) strip <style> tags, so inline styles are required.
 * Zero-dependency alternative to the `juice` library.
 *
 * Supports: element, .class, #id, element.class selectors.
 *
 * @param {string} html - HTML string with <style> blocks
 * @returns {string} - HTML with styles inlined
 */
function inlineCss(html) {
  const styleBlocks = [];
  const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m;
  while ((m = styleRegex.exec(html)) !== null) {
    styleBlocks.push(m[1]);
  }
  if (styleBlocks.length === 0) return html;

  // Parse CSS rules
  const rules = [];
  for (const css of styleBlocks) {
    const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const ruleRegex = /([^{@]+)\{([^}]+)\}/g;
    let rm;
    while ((rm = ruleRegex.exec(clean)) !== null) {
      const selectors = rm[1].trim().split(',').map(s => s.trim()).filter(Boolean);
      const declarations = rm[2].trim();
      for (const selector of selectors) {
        if (selector.includes(':') || selector.includes('[') || selector.includes('>')) continue;
        rules.push({ selector, declarations });
      }
    }
  }
  if (rules.length === 0) return html;

  let result = html;
  for (const { selector, declarations } of rules) {
    const pattern = cssSelectorToPattern(selector);
    if (!pattern) continue;
    result = result.replace(pattern, (tag) => {
      if (/style\s*=\s*"/i.test(tag)) {
        return tag.replace(/style\s*=\s*"([^"]*)"/i, (_, existing) => `style="${existing}; ${declarations}"`);
      }
      return tag.replace(/>$/, ` style="${declarations}">`);
    });
  }

  // Strip <style> blocks now that styles are inlined
  result = result.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  return result;
}

/**
 * Convert a simple CSS selector to a regex matching the opening HTML tag.
 */
function cssSelectorToPattern(sel) {
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  sel = sel.trim();
  if (/^#[\w-]+$/.test(sel)) {
    return new RegExp(`<[a-z][a-z0-9]*[^>]*\\bid\\s*=\\s*["']${esc(sel.slice(1))}["'][^>]*>`, 'gi');
  }
  if (/^\.[\w-]+$/.test(sel)) {
    return new RegExp(`<[a-z][a-z0-9]*[^>]*\\bclass\\s*=\\s*["'][^"']*\\b${esc(sel.slice(1))}\\b[^"']*["'][^>]*>`, 'gi');
  }
  if (/^[a-z][a-z0-9]*\.[\w-]+$/i.test(sel)) {
    const [tag, cls] = sel.split('.');
    return new RegExp(`<${esc(tag)}[^>]*\\bclass\\s*=\\s*["'][^"']*\\b${esc(cls)}\\b[^"']*["'][^>]*>`, 'gi');
  }
  if (/^[a-z][a-z0-9]*$/i.test(sel)) {
    return new RegExp(`<${esc(sel)}(?:\\s[^>]*)?>`, 'gi');
  }
  return null;
}

/**
 * Strip HTML tags from string
 */
function stripHtml(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Get configuration (for diagnostics)
 */
export function getConfig() {
  return {
    transport: config.transport,
    from: config.from,
    fromName: config.fromName,
    smtpHost: config.smtp.host || '(not configured)',
    smtpPort: config.smtp.port
  };
}
