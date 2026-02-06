# RSES CMS Design System

## Apple-Inspired Minimalist Design Philosophy

> "Simplicity is the ultimate sophistication." - Leonardo da Vinci

The RSES CMS design system embodies the principle that **complexity should be invisible**. Users should feel the system is simple while having access to unlimited power when needed.

---

## Table of Contents

1. [Design Principles](#1-design-principles)
2. [Progressive Disclosure System](#2-progressive-disclosure-system)
3. [Admin Interface UX](#3-admin-interface-ux)
4. [Theme Token System](#4-theme-token-system)
5. [Module UI Guidelines](#5-module-ui-guidelines)
6. [Micro-Interactions](#6-micro-interactions)
7. [Mobile-First Dashboard](#7-mobile-first-dashboard)

---

## 1. Design Principles

### Core Philosophy: "It Just Works"

Every design decision must pass three tests:

| Test | Question | Threshold |
|------|----------|-----------|
| **Clarity** | Can a first-time user understand this in 3 seconds? | Instant comprehension |
| **Power** | Can a power user accomplish this faster? | Hidden shortcuts exist |
| **Consistency** | Does this feel like RSES? | Brand identity preserved |

### The Seven Pillars

#### 1.1 Purposeful Reduction

```
BAD:  "Module Configuration - Advanced Settings - Content Type Settings - Field Options"
GOOD: "Content Fields" (with expandable details)
```

**Rule:** Every screen has ONE primary purpose. Secondary options are always one gesture away, never visible by default.

#### 1.2 Optical Harmony

```css
/* The Golden Ratio Grid: 1:1.618 */
--grid-ratio: 1.618;
--spacing-unit: 8px;

/* All spacing derives from this base */
--space-xs:  calc(var(--spacing-unit) / var(--grid-ratio));  /* 4.94px  */
--space-sm:  var(--spacing-unit);                              /* 8px     */
--space-md:  calc(var(--spacing-unit) * var(--grid-ratio));    /* 12.94px */
--space-lg:  calc(var(--space-md) * var(--grid-ratio));        /* 20.94px */
--space-xl:  calc(var(--space-lg) * var(--grid-ratio));        /* 33.88px */
--space-2xl: calc(var(--space-xl) * var(--grid-ratio));        /* 54.82px */
```

#### 1.3 Quiet Confidence

The interface never shouts. Information density is controlled through:
- **Typographic hierarchy** (not color or icons)
- **Whitespace** (negative space is a feature)
- **Progressive revelation** (complexity unfolds on demand)

#### 1.4 Meaningful Motion

Motion has exactly three purposes:
1. **Orient** - Help users understand where they are
2. **Guide** - Direct attention to what matters
3. **Feedback** - Confirm actions happened

```css
/* Motion should be felt, not seen */
--duration-instant: 100ms;  /* Micro-feedback */
--duration-quick: 200ms;    /* UI responses */
--duration-normal: 300ms;   /* Transitions */
--duration-slow: 500ms;     /* Major changes */

--easing-default: cubic-bezier(0.4, 0.0, 0.2, 1);  /* Material standard */
--easing-decelerate: cubic-bezier(0.0, 0.0, 0.2, 1);  /* Entering elements */
--easing-accelerate: cubic-bezier(0.4, 0.0, 1, 1);    /* Exiting elements */
```

#### 1.5 Respecting Intelligence

Users are not stupid. The system:
- Remembers preferences
- Predicts common actions
- Never asks twice for the same information
- Provides intelligent defaults

#### 1.6 Invisible Infrastructure

Technical concepts must be translated:
| Technical Term | User-Facing Language |
|----------------|---------------------|
| Module | Feature |
| Hook | Automation |
| Content Type | Template |
| Schema | Fields |
| API Token | Access Key |
| Session | Login |

#### 1.7 Branded Moments

The RSES brand appears in:
- The subtle animation when modules toggle
- The satisfying "click" when actions complete
- The particular shade of the accent color
- The consistent corner radius across all elements

---

## 2. Progressive Disclosure System

### The Three Layers

```
Layer 0: GLANCE     - What's the status? (1 second)
Layer 1: UNDERSTAND - What are my options? (5 seconds)
Layer 2: MASTER     - How do I customize everything? (exploration)
```

### Implementation Pattern

```html
<!-- Layer 0: Status at a glance -->
<div class="module-card">
  <span class="module-name">Blog</span>
  <switch class="module-toggle" aria-label="Enable Blog module" />
</div>

<!-- Layer 1: Tap/click to expand -->
<div class="module-card--expanded">
  <span class="module-name">Blog</span>
  <switch class="module-toggle" />

  <div class="module-details" aria-expanded="true">
    <p class="module-description">Create and manage blog posts</p>
    <div class="module-stats">
      <span>42 posts</span>
      <span>3 categories</span>
    </div>
    <div class="module-actions">
      <button class="btn-secondary">View Posts</button>
      <button class="btn-text">Settings</button>
    </div>
  </div>
</div>

<!-- Layer 2: Full configuration (separate screen or modal) -->
<div class="module-settings-panel">
  <!-- Comprehensive settings, reached via explicit action -->
</div>
```

### Disclosure Triggers

| User Action | Response |
|-------------|----------|
| Hover (desktop) | Show subtle preview hint |
| Tap (mobile) | Expand to Layer 1 |
| Long press | Show context menu |
| Swipe right | Quick enable/disable |
| Click "Settings" | Navigate to Layer 2 |

### The 80/20 Rule

- **80% of users** need only Layer 0 and Layer 1
- **20% of users** (power users) access Layer 2
- Design for the 80%, accommodate the 20%

---

## 3. Admin Interface UX

### Module Management: The Toggle-First Paradigm

```
+---------------------------------------------------------+
|  FEATURES                                    [+ Add New] |
+---------------------------------------------------------+
|                                                          |
|  +--------------------------------------------------+  |
|  |  Blog                                        [ON] |  |
|  +--------------------------------------------------+  |
|                                                          |
|  +--------------------------------------------------+  |
|  |  E-commerce                                 [OFF] |  |
|  +--------------------------------------------------+  |
|                                                          |
|  +--------------------------------------------------+  |
|  |  Analytics                                   [ON] |  |
|  +--------------------------------------------------+  |
|                                                          |
+---------------------------------------------------------+
```

### Card States

#### Default State
```css
.module-card {
  background: var(--surface-primary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  padding: var(--space-lg);

  display: flex;
  justify-content: space-between;
  align-items: center;

  transition:
    transform var(--duration-quick) var(--easing-default),
    box-shadow var(--duration-quick) var(--easing-default);
}
```

#### Hover State (Desktop)
```css
.module-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-elevated);
  border-color: var(--border-hover);
}
```

#### Active/Pressed State
```css
.module-card:active {
  transform: scale(0.98);
  box-shadow: var(--shadow-inset);
}
```

#### Expanded State
```css
.module-card[aria-expanded="true"] {
  border-color: var(--accent-primary);
  box-shadow: var(--shadow-focus);
}

.module-card[aria-expanded="true"] .module-details {
  max-height: 200px;
  opacity: 1;
  padding-top: var(--space-md);
  margin-top: var(--space-md);
  border-top: 1px solid var(--border-subtle);
}
```

### The Dashboard: Information Architecture

```
+------------------------------------------------------------------+
|  RSES                                    [Search] [User] [Help]  |
+------------------------------------------------------------------+
|                                                                   |
|  Good morning, Sarah                                             |
|                                                                   |
|  +---------------------------+  +---------------------------+    |
|  |  CONTENT                  |  |  ACTIVITY                 |    |
|  |  [========    ] 67%       |  |  12 changes today         |    |
|  |  8 drafts, 42 published   |  |  Last: 3 minutes ago      |    |
|  +---------------------------+  +---------------------------+    |
|                                                                   |
|  +---------------------------+  +---------------------------+    |
|  |  FEATURES                 |  |  SITE STATUS              |    |
|  |  6 active / 12 available  |  |  [*] All systems normal   |    |
|  +---------------------------+  +---------------------------+    |
|                                                                   |
|  QUICK ACTIONS                                                   |
|  +----------+  +----------+  +----------+  +----------+          |
|  | New Post |  | Upload   |  | Settings |  | Preview  |          |
|  +----------+  +----------+  +----------+  +----------+          |
|                                                                   |
+------------------------------------------------------------------+
```

### Visual Hierarchy

1. **Primary Focus**: User name (personalization) and status overview
2. **Secondary Focus**: Quick action cards
3. **Tertiary Focus**: Detailed statistics (available but not demanding attention)

### The Switch Component

The module toggle is the most critical UI element. It must:

```html
<label class="rses-switch">
  <input type="checkbox" class="rses-switch__input" />
  <span class="rses-switch__track">
    <span class="rses-switch__thumb"></span>
  </span>
  <span class="rses-switch__label sr-only">Enable module</span>
</label>
```

```css
.rses-switch {
  --switch-width: 52px;
  --switch-height: 32px;
  --thumb-size: 28px;
  --thumb-offset: 2px;

  position: relative;
  display: inline-flex;
  align-items: center;
}

.rses-switch__track {
  width: var(--switch-width);
  height: var(--switch-height);
  background: var(--surface-disabled);
  border-radius: var(--switch-height);
  transition: background var(--duration-quick) var(--easing-default);
}

.rses-switch__thumb {
  position: absolute;
  width: var(--thumb-size);
  height: var(--thumb-size);
  background: var(--surface-primary);
  border-radius: 50%;
  box-shadow: var(--shadow-thumb);

  transform: translateX(var(--thumb-offset));
  transition: transform var(--duration-quick) var(--easing-default);
}

/* Checked state */
.rses-switch__input:checked + .rses-switch__track {
  background: var(--accent-primary);
}

.rses-switch__input:checked + .rses-switch__track .rses-switch__thumb {
  transform: translateX(calc(var(--switch-width) - var(--thumb-size) - var(--thumb-offset)));
}

/* Focus state (keyboard navigation) */
.rses-switch__input:focus-visible + .rses-switch__track {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

/* Disabled state */
.rses-switch__input:disabled + .rses-switch__track {
  opacity: 0.5;
  cursor: not-allowed;
}
```

---

## 4. Theme Token System

### Token Architecture

```
Tokens are organized in three layers:

1. PRIMITIVE TOKENS (raw values)
   |
   v
2. SEMANTIC TOKENS (contextual meaning)
   |
   v
3. COMPONENT TOKENS (specific applications)
```

### 4.1 Primitive Tokens

```css
:root {
  /* Color Primitives */
  --gray-50:  #fafafa;
  --gray-100: #f5f5f5;
  --gray-200: #e5e5e5;
  --gray-300: #d4d4d4;
  --gray-400: #a3a3a3;
  --gray-500: #737373;
  --gray-600: #525252;
  --gray-700: #404040;
  --gray-800: #262626;
  --gray-900: #171717;
  --gray-950: #0a0a0a;

  /* Brand Colors */
  --rses-50:  #f0f9ff;
  --rses-100: #e0f2fe;
  --rses-200: #bae6fd;
  --rses-300: #7dd3fc;
  --rses-400: #38bdf8;
  --rses-500: #0ea5e9;  /* Primary brand */
  --rses-600: #0284c7;
  --rses-700: #0369a1;
  --rses-800: #075985;
  --rses-900: #0c4a6e;

  /* Status Colors */
  --green-500: #22c55e;
  --yellow-500: #eab308;
  --red-500: #ef4444;

  /* Typography Scale (Major Third: 1.25) */
  --font-size-xs:   0.64rem;   /* 10.24px */
  --font-size-sm:   0.8rem;    /* 12.8px  */
  --font-size-base: 1rem;      /* 16px    */
  --font-size-md:   1.25rem;   /* 20px    */
  --font-size-lg:   1.563rem;  /* 25px    */
  --font-size-xl:   1.953rem;  /* 31.25px */
  --font-size-2xl:  2.441rem;  /* 39.06px */
  --font-size-3xl:  3.052rem;  /* 48.83px */

  /* Font Weights */
  --font-regular: 400;
  --font-medium: 500;
  --font-semibold: 600;
  --font-bold: 700;

  /* Line Heights */
  --leading-tight: 1.25;
  --leading-normal: 1.5;
  --leading-relaxed: 1.75;

  /* Border Radius */
  --radius-none: 0;
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-full: 9999px;

  /* Shadows */
  --shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.05);
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06);
  --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.1), 0 2px 4px rgba(0, 0, 0, 0.06);
  --shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.1), 0 4px 6px rgba(0, 0, 0, 0.05);
  --shadow-xl: 0 20px 25px rgba(0, 0, 0, 0.1), 0 10px 10px rgba(0, 0, 0, 0.04);
}
```

### 4.2 Semantic Tokens

```css
:root {
  /* Light Mode (default) */

  /* Surfaces */
  --surface-primary: var(--gray-50);     /* Main background */
  --surface-secondary: white;             /* Cards, elevated surfaces */
  --surface-tertiary: var(--gray-100);   /* Subtle backgrounds */
  --surface-disabled: var(--gray-200);   /* Disabled elements */

  /* Text */
  --text-primary: var(--gray-900);       /* Headlines, primary content */
  --text-secondary: var(--gray-600);     /* Descriptions, secondary */
  --text-tertiary: var(--gray-400);      /* Hints, placeholders */
  --text-inverse: white;                  /* Text on dark backgrounds */

  /* Borders */
  --border-subtle: var(--gray-200);
  --border-default: var(--gray-300);
  --border-hover: var(--gray-400);
  --border-focus: var(--rses-500);

  /* Interactive */
  --accent-primary: var(--rses-500);
  --accent-hover: var(--rses-600);
  --accent-active: var(--rses-700);
  --accent-subtle: var(--rses-100);

  /* Status */
  --status-success: var(--green-500);
  --status-warning: var(--yellow-500);
  --status-error: var(--red-500);
  --status-info: var(--rses-500);

  /* Focus */
  --focus-ring: var(--rses-500);
  --focus-ring-offset: 2px;
}

/* Dark Mode */
@media (prefers-color-scheme: dark) {
  :root {
    --surface-primary: var(--gray-950);
    --surface-secondary: var(--gray-900);
    --surface-tertiary: var(--gray-800);
    --surface-disabled: var(--gray-700);

    --text-primary: var(--gray-50);
    --text-secondary: var(--gray-300);
    --text-tertiary: var(--gray-500);
    --text-inverse: var(--gray-900);

    --border-subtle: var(--gray-800);
    --border-default: var(--gray-700);
    --border-hover: var(--gray-600);

    --accent-subtle: var(--rses-900);
  }
}
```

### 4.3 Component Tokens

```css
:root {
  /* Button */
  --btn-height: 40px;
  --btn-padding-x: var(--space-lg);
  --btn-font-size: var(--font-size-sm);
  --btn-font-weight: var(--font-medium);
  --btn-radius: var(--radius-md);

  /* Card */
  --card-padding: var(--space-lg);
  --card-radius: var(--radius-lg);
  --card-shadow: var(--shadow-sm);
  --card-shadow-hover: var(--shadow-md);

  /* Input */
  --input-height: 44px;
  --input-padding-x: var(--space-md);
  --input-radius: var(--radius-md);
  --input-border: var(--border-default);
  --input-border-focus: var(--accent-primary);

  /* Switch */
  --switch-width: 52px;
  --switch-height: 32px;
  --switch-thumb-size: 28px;
  --switch-bg-off: var(--surface-disabled);
  --switch-bg-on: var(--accent-primary);

  /* Navigation */
  --nav-height: 64px;
  --nav-item-padding: var(--space-md) var(--space-lg);

  /* Sidebar */
  --sidebar-width: 280px;
  --sidebar-collapsed-width: 72px;
}
```

### 4.4 Enforcing Consistency

Create a CSS linter rule that **only allows semantic tokens** in component files:

```javascript
// .stylelintrc.js
module.exports = {
  rules: {
    "rses/no-primitive-tokens": true,
    "rses/use-semantic-tokens": true,
  },
  customRules: {
    "rses/no-primitive-tokens": (root, result) => {
      root.walkDecls(decl => {
        if (decl.value.includes("--gray-") || decl.value.includes("--rses-")) {
          if (!decl.source.input.file.includes("tokens/")) {
            result.warn(
              `Direct primitive token "${decl.value}" not allowed. Use semantic tokens.`,
              { node: decl }
            );
          }
        }
      });
    }
  }
};
```

---

## 5. Module UI Guidelines

### Third-Party Module Contract

Every module that contributes UI must:

1. **Import only the RSES component library**
2. **Use only semantic tokens**
3. **Follow the naming convention**
4. **Pass accessibility audit**

### Component Library

Modules have access to these pre-built components:

```javascript
// modules/my-module/index.js
import {
  // Layout
  Card, CardHeader, CardBody, CardFooter,
  Stack, Grid, Divider,

  // Typography
  Heading, Text, Label, Code,

  // Forms
  Input, Textarea, Select, Checkbox, Switch, Radio,
  FormField, FormHelp, FormError,

  // Actions
  Button, IconButton, Link,

  // Feedback
  Alert, Toast, Badge, Progress,

  // Navigation
  Tabs, TabList, Tab, TabPanel,
  Breadcrumb, BreadcrumbItem,

  // Data
  Table, TableHead, TableBody, TableRow, TableCell,
  List, ListItem,

  // Overlays
  Dialog, DialogHeader, DialogBody, DialogFooter,
  Dropdown, DropdownItem,
  Tooltip,

  // Utilities
  Icon, Skeleton, Spinner, EmptyState
} from '@rses/ui';
```

### Module Template Structure

```javascript
// modules/my-module/ui/settings.js
export function SettingsPanel({ config, onUpdate }) {
  return (
    <Card>
      <CardHeader>
        <Heading level={3}>My Module Settings</Heading>
      </CardHeader>
      <CardBody>
        <Stack spacing="md">
          <FormField label="API Key" required>
            <Input
              type="password"
              value={config.apiKey}
              onChange={e => onUpdate({ apiKey: e.target.value })}
            />
            <FormHelp>Your API key from the service dashboard</FormHelp>
          </FormField>

          <FormField label="Enable caching">
            <Switch
              checked={config.cacheEnabled}
              onChange={checked => onUpdate({ cacheEnabled: checked })}
            />
          </FormField>
        </Stack>
      </CardBody>
      <CardFooter>
        <Button variant="primary">Save Changes</Button>
      </CardFooter>
    </Card>
  );
}
```

### Module Contribution Points

Modules can contribute UI to these extension points:

| Extension Point | Description | Component API |
|-----------------|-------------|---------------|
| `dashboard.widget` | Dashboard card widget | `<DashboardWidget title="" stats={} actions={} />` |
| `sidebar.item` | Sidebar navigation item | `<SidebarItem icon="" label="" href="" badge="" />` |
| `content.action` | Content list actions | `<ContentAction icon="" label="" onClick={} />` |
| `settings.section` | Settings page section | `<SettingsSection title="" description="" />` |
| `toolbar.item` | Main toolbar items | `<ToolbarItem icon="" tooltip="" />` |

### Validation Requirements

Before a module can register UI:

```javascript
// core/ui-validator.js
export function validateModuleUI(moduleId, components) {
  const errors = [];

  // 1. Check component imports
  const allowedImports = ['@rses/ui', '@rses/icons'];
  // ... validate imports

  // 2. Check CSS for primitive tokens
  // ... scan for disallowed tokens

  // 3. Run accessibility audit
  // ... run axe-core

  // 4. Check naming conventions
  // ... validate class names, IDs

  return { valid: errors.length === 0, errors };
}
```

---

## 6. Micro-Interactions

### Hiding Technical Complexity

Every micro-interaction serves to **hide complexity** while **providing feedback**.

### 6.1 Module Toggle Interaction

```
User toggles module ON:

1. Thumb slides right (100ms)
2. Track color transitions to accent (100ms)
3. Subtle scale pulse on card (150ms)
4. Success checkmark fades in briefly (200ms, then fades out)
5. If there are dependent modules, they animate in sequence (staggered 50ms)
```

```css
@keyframes module-enable {
  0% { transform: scale(1); }
  50% { transform: scale(1.02); }
  100% { transform: scale(1); }
}

@keyframes success-flash {
  0% { opacity: 0; transform: scale(0.8); }
  30% { opacity: 1; transform: scale(1); }
  100% { opacity: 0; transform: scale(1); }
}

.module-card--just-enabled {
  animation: module-enable 300ms var(--easing-default);
}

.module-card--just-enabled .success-indicator {
  animation: success-flash 600ms var(--easing-default);
}
```

### 6.2 Save Action

```
User saves content:

1. Button text changes: "Save" -> "Saving..."
2. Button gets subtle loading indicator
3. On success: Button briefly shows checkmark, then returns to "Save"
4. Toast notification appears (if user scrolled away from button)
```

```javascript
async function handleSave() {
  setButtonState('saving');

  try {
    await saveContent();
    setButtonState('success');

    // Return to normal after brief success state
    setTimeout(() => setButtonState('idle'), 1500);
  } catch (error) {
    setButtonState('error');
    showToast({ type: 'error', message: 'Failed to save. Please try again.' });
  }
}
```

### 6.3 Navigation Transitions

```
Page transitions use shared element transitions where possible:

1. Clicked element scales slightly
2. Content fades/slides out (150ms)
3. New content fades/slides in (200ms)
4. Focus moves to main content
```

```css
/* Using View Transitions API */
@view-transition {
  navigation: auto;
}

::view-transition-old(root) {
  animation: fade-out 150ms var(--easing-accelerate);
}

::view-transition-new(root) {
  animation: fade-in 200ms var(--easing-decelerate);
}

@keyframes fade-out {
  from { opacity: 1; }
  to { opacity: 0; }
}

@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
```

### 6.4 Form Validation

```
Real-time validation that doesn't interrupt:

1. User types in field
2. After 300ms of inactivity, validation runs
3. If invalid: border subtly changes to error color, help text appears
4. If valid: no visible change (silence = success)
5. On field blur: show validation state explicitly
```

```javascript
function useFieldValidation(value, validator, delay = 300) {
  const [error, setError] = useState(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!touched) return;

    const timeout = setTimeout(() => {
      const result = validator(value);
      setError(result);
    }, delay);

    return () => clearTimeout(timeout);
  }, [value, touched]);

  return { error, setTouched };
}
```

### 6.5 Loading States

**Never show spinners.** Use skeleton screens that match content shape:

```html
<!-- Content Loading State -->
<div class="content-skeleton">
  <div class="skeleton-line skeleton-title"></div>
  <div class="skeleton-line skeleton-text"></div>
  <div class="skeleton-line skeleton-text short"></div>
</div>
```

```css
.skeleton-line {
  height: 1em;
  background: linear-gradient(
    90deg,
    var(--surface-tertiary) 0%,
    var(--surface-secondary) 50%,
    var(--surface-tertiary) 100%
  );
  background-size: 200% 100%;
  animation: skeleton-pulse 1.5s ease-in-out infinite;
  border-radius: var(--radius-sm);
}

.skeleton-title {
  width: 60%;
  height: 1.5em;
  margin-bottom: var(--space-md);
}

.skeleton-text {
  width: 100%;
  margin-bottom: var(--space-sm);
}

.skeleton-text.short {
  width: 40%;
}

@keyframes skeleton-pulse {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

### 6.6 Haptic Feedback (Mobile)

```javascript
// For critical actions on mobile
function triggerHaptic(type = 'light') {
  if ('vibrate' in navigator) {
    const patterns = {
      light: [10],
      medium: [20],
      heavy: [30],
      success: [10, 50, 20],
      error: [50, 50, 50],
    };
    navigator.vibrate(patterns[type]);
  }
}

// Usage
<Switch
  onChange={(checked) => {
    triggerHaptic('light');
    handleToggle(checked);
  }}
/>
```

---

## 7. Mobile-First Dashboard

### The Thumb Zone Design

```
+--------------------------------+
|                                |
|  [  HARD REACH - Status Bar  ]|
|                                |
|  +---------------------------+ |
|  |                           | |
|  |    NATURAL - Content      | |
|  |                           | |
|  |    Dashboard cards        | |
|  |    scroll vertically      | |
|  |                           | |
|  +---------------------------+ |
|                                |
|  +---------------------------+ |
|  | EASY - Primary Actions    | |
|  | [New] [Search] [Menu]     | |
|  +---------------------------+ |
+--------------------------------+
```

### Mobile Navigation Pattern

```html
<!-- Bottom navigation for primary actions -->
<nav class="mobile-nav" role="navigation" aria-label="Main navigation">
  <a href="/dashboard" class="mobile-nav__item active">
    <Icon name="home" />
    <span>Home</span>
  </a>
  <a href="/content" class="mobile-nav__item">
    <Icon name="file" />
    <span>Content</span>
  </a>
  <button class="mobile-nav__item mobile-nav__item--primary" aria-label="Create new">
    <Icon name="plus" />
  </button>
  <a href="/features" class="mobile-nav__item">
    <Icon name="puzzle" />
    <span>Features</span>
  </a>
  <a href="/settings" class="mobile-nav__item">
    <Icon name="settings" />
    <span>Settings</span>
  </a>
</nav>
```

```css
.mobile-nav {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;

  display: flex;
  justify-content: space-around;
  align-items: center;

  height: 80px;
  padding-bottom: env(safe-area-inset-bottom);

  background: var(--surface-secondary);
  border-top: 1px solid var(--border-subtle);

  /* Elevate above content */
  z-index: 100;
}

.mobile-nav__item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;

  padding: var(--space-sm);

  color: var(--text-tertiary);
  text-decoration: none;
  font-size: var(--font-size-xs);

  transition: color var(--duration-instant);
}

.mobile-nav__item.active {
  color: var(--accent-primary);
}

.mobile-nav__item--primary {
  position: relative;
  bottom: 12px;

  width: 56px;
  height: 56px;

  display: flex;
  align-items: center;
  justify-content: center;

  background: var(--accent-primary);
  color: var(--text-inverse);
  border-radius: var(--radius-full);
  box-shadow: var(--shadow-lg);
}
```

### Mobile Dashboard Layout

```css
.dashboard-mobile {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  padding-bottom: 100px; /* Space for nav */
}

.dashboard-mobile__header {
  position: sticky;
  top: 0;
  z-index: 50;

  display: flex;
  justify-content: space-between;
  align-items: center;

  padding: var(--space-md) var(--space-lg);
  background: var(--surface-primary);
  border-bottom: 1px solid var(--border-subtle);
}

.dashboard-mobile__greeting {
  padding: var(--space-xl) var(--space-lg) var(--space-lg);
}

.dashboard-mobile__stats {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--space-md);
  padding: 0 var(--space-lg);
}

.dashboard-mobile__section {
  padding: var(--space-lg);
}

.dashboard-mobile__section-title {
  font-size: var(--font-size-sm);
  font-weight: var(--font-semibold);
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: var(--space-md);
}
```

### Gesture Support

```javascript
// Swipe to enable/disable modules
import { useSwipeable } from 'react-swipeable';

function ModuleCard({ module, onToggle }) {
  const [swiped, setSwiped] = useState(false);

  const handlers = useSwipeable({
    onSwipedRight: () => {
      if (!module.enabled) {
        triggerHaptic('medium');
        onToggle(true);
      }
    },
    onSwipedLeft: () => {
      if (module.enabled) {
        triggerHaptic('medium');
        onToggle(false);
      }
    },
    trackMouse: false,
    delta: 50,
  });

  return (
    <div {...handlers} className="module-card">
      {/* Card content */}
    </div>
  );
}
```

### Pull-to-Refresh

```css
.pull-to-refresh {
  position: relative;
  overflow: hidden;
}

.pull-to-refresh__indicator {
  position: absolute;
  top: -60px;
  left: 50%;
  transform: translateX(-50%);

  width: 40px;
  height: 40px;

  display: flex;
  align-items: center;
  justify-content: center;

  opacity: 0;
  transition: opacity 200ms, transform 200ms;
}

.pull-to-refresh--pulling .pull-to-refresh__indicator {
  opacity: 1;
  transform: translateX(-50%) translateY(70px);
}

.pull-to-refresh--refreshing .pull-to-refresh__indicator {
  opacity: 1;
  transform: translateX(-50%) translateY(70px);
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: translateX(-50%) translateY(70px) rotate(0deg); }
  to { transform: translateX(-50%) translateY(70px) rotate(360deg); }
}
```

### Responsive Breakpoints

```css
:root {
  /* Mobile first - no media query needed for base styles */

  /* Small tablets */
  --breakpoint-sm: 640px;

  /* Large tablets / small laptops */
  --breakpoint-md: 768px;

  /* Desktop */
  --breakpoint-lg: 1024px;

  /* Large desktop */
  --breakpoint-xl: 1280px;
}

/* Dashboard transforms at tablet breakpoint */
@media (min-width: 768px) {
  .dashboard-mobile {
    display: none;
  }

  .dashboard-desktop {
    display: grid;
    grid-template-columns: var(--sidebar-width) 1fr;
  }
}
```

---

## Implementation Checklist

### Phase 1: Foundation
- [ ] Implement token system in `/public/css/tokens.css`
- [ ] Create base component library
- [ ] Set up CSS linting for token enforcement
- [ ] Implement Switch component with full interaction states

### Phase 2: Admin Interface
- [ ] Redesign dashboard layout
- [ ] Implement module cards with toggle-first UX
- [ ] Add progressive disclosure to all sections
- [ ] Create mobile navigation

### Phase 3: Micro-Interactions
- [ ] Add module toggle animations
- [ ] Implement skeleton loading states
- [ ] Add save state transitions
- [ ] Implement haptic feedback for mobile

### Phase 4: Module Integration
- [ ] Create module UI contribution API
- [ ] Build module UI validator
- [ ] Document module UI guidelines
- [ ] Create example module with UI contribution

### Phase 5: Polish
- [ ] Accessibility audit and fixes
- [ ] Performance optimization
- [ ] Cross-browser testing
- [ ] Documentation completion

---

## Brand Guidelines Summary

### The RSES Voice

| Attribute | Expression |
|-----------|------------|
| **Professional** | Clean typography, structured layouts |
| **Approachable** | Warm colors, friendly micro-copy |
| **Powerful** | Depth reveals on interaction |
| **Trustworthy** | Consistent patterns, reliable feedback |

### Color Usage

- **Accent (RSES Blue):** Interactive elements only
- **Gray Scale:** All structural elements
- **Status Colors:** Sparingly, for actual status

### Typography

- **Headings:** System font stack, semibold
- **Body:** System font stack, regular
- **Code:** Monospace, for technical content only

### The RSES Signature

These elements make RSES instantly recognizable:
1. The satisfying toggle animation
2. The card elevation on hover
3. The brief success flash
4. The consistent 8px spacing grid
5. The calm, muted color palette with single accent

---

*This design system is a living document. As RSES evolves, so will these guidelines.*
