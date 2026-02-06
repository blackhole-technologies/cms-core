# Module UI Contribution Guidelines

## Making Third-Party Modules Look Native

This document defines how third-party modules contribute UI elements to the RSES CMS while maintaining a consistent, Apple-like user experience.

---

## Core Principles

### 1. Use the Component Library

Every UI element must use components from `@rses/ui`. Direct HTML/CSS for UI elements is prohibited.

```javascript
// CORRECT: Use provided components
import { Card, Button, Switch, FormField, Input } from '@rses/ui';

export function MyModuleSettings({ config, onUpdate }) {
  return (
    <Card>
      <Card.Header>
        <Card.Title>My Module Settings</Card.Title>
      </Card.Header>
      <Card.Body>
        <FormField label="API Key" required>
          <Input
            type="password"
            value={config.apiKey}
            onChange={e => onUpdate({ apiKey: e.target.value })}
          />
        </FormField>
      </Card.Body>
    </Card>
  );
}

// INCORRECT: Custom HTML/CSS
export function MyModuleSettings({ config, onUpdate }) {
  return (
    <div className="my-custom-card">  // NO!
      <h3>My Module Settings</h3>
      <input type="password" />
    </div>
  );
}
```

### 2. Use Only Semantic Tokens

Never use primitive color values or hardcoded sizes. Always reference semantic tokens.

```css
/* CORRECT: Semantic tokens */
.my-module-element {
  color: var(--text-primary);
  background: var(--surface-secondary);
  padding: var(--space-lg);
  border-radius: var(--radius-md);
}

/* INCORRECT: Hardcoded values */
.my-module-element {
  color: #333;           /* NO! */
  background: #f5f5f5;   /* NO! */
  padding: 20px;         /* NO! */
  border-radius: 8px;    /* NO! */
}
```

### 3. Follow the Naming Convention

All module-specific CSS classes must be prefixed with the module name.

```css
/* CORRECT: Module-prefixed classes */
.analytics-dashboard { }
.analytics-chart { }
.analytics-filter { }

/* INCORRECT: Generic or unprefixed classes */
.dashboard { }      /* Could conflict with core! */
.chart { }          /* Too generic */
.filter-box { }     /* Not prefixed */
```

---

## UI Extension Points

Modules can contribute UI to these specific locations:

### 1. Dashboard Widgets

Small cards displayed on the main dashboard.

```javascript
// modules/analytics/ui/widget.js
export const dashboardWidget = {
  // Required
  id: 'analytics-summary',
  title: 'Analytics',

  // Widget size: 'small' (1 col), 'medium' (2 col), 'large' (full width)
  size: 'small',

  // Priority determines order (lower = higher priority)
  priority: 50,

  // Render function
  render: (context) => (
    <DashboardWidget>
      <DashboardWidget.Stat value="1,234" label="Page Views" />
      <DashboardWidget.Stat value="567" label="Visitors" />
      <DashboardWidget.Action href="/admin/analytics">View Details</DashboardWidget.Action>
    </DashboardWidget>
  )
};
```

**Widget Constraints:**
- Maximum 3 stats per small widget
- No complex interactions (links/buttons only)
- Data must load in < 500ms or show skeleton
- No custom styling allowed

### 2. Sidebar Navigation Items

Links in the main admin sidebar.

```javascript
// modules/analytics/ui/nav.js
export const sidebarItems = [
  {
    id: 'analytics',
    label: 'Analytics',
    icon: 'chart-line',  // Must use @rses/icons
    href: '/admin/analytics',

    // Optional: Badge for notifications/counts
    badge: {
      value: 3,
      variant: 'info'  // 'info' | 'warning' | 'error'
    },

    // Optional: Sub-items (creates collapsible section)
    children: [
      { id: 'analytics-overview', label: 'Overview', href: '/admin/analytics' },
      { id: 'analytics-reports', label: 'Reports', href: '/admin/analytics/reports' },
    ]
  }
];
```

**Navigation Constraints:**
- Maximum 1 top-level item per module
- Maximum 5 sub-items
- Icons must be from `@rses/icons`
- No custom icons allowed

### 3. Settings Sections

Configuration panels in the site settings.

```javascript
// modules/analytics/ui/settings.js
export const settingsSection = {
  id: 'analytics-settings',
  title: 'Analytics',
  description: 'Configure analytics tracking and reporting',
  icon: 'chart-line',

  // Priority determines order in settings page
  priority: 100,

  // Render function receives current config and update handler
  render: ({ config, onUpdate, context }) => (
    <SettingsSection>
      <FormField label="Tracking ID" required>
        <Input
          value={config.trackingId}
          onChange={e => onUpdate({ trackingId: e.target.value })}
          placeholder="UA-XXXXXXXX-X"
        />
        <FormField.Help>Your Google Analytics tracking ID</FormField.Help>
      </FormField>

      <FormField label="Enable tracking">
        <Switch
          checked={config.enabled}
          onChange={checked => onUpdate({ enabled: checked })}
        />
        <FormField.Help>Track page views and events</FormField.Help>
      </FormField>
    </SettingsSection>
  )
};
```

**Settings Constraints:**
- Use `FormField` for all inputs
- Group related settings logically
- Provide help text for non-obvious options
- Validate input before calling `onUpdate`

### 4. Content Actions

Buttons/links in content list and edit views.

```javascript
// modules/social/ui/actions.js
export const contentActions = {
  // Actions for content list (bulk actions)
  list: [
    {
      id: 'social-share',
      label: 'Share to Social',
      icon: 'share',

      // Conditions for when action is available
      conditions: {
        contentTypes: ['article', 'page'],  // Or '*' for all
        minSelected: 1,
        maxSelected: 10,
      },

      // Handler receives selected content items
      handler: async (items, context) => {
        await shareToSocial(items);
        context.toast.success('Shared successfully!');
      }
    }
  ],

  // Actions for single content item (edit page)
  item: [
    {
      id: 'social-preview',
      label: 'Preview Share',
      icon: 'eye',
      variant: 'secondary',

      handler: async (item, context) => {
        context.modal.open(SharePreviewModal, { item });
      }
    }
  ]
};
```

**Action Constraints:**
- Maximum 3 list actions per module
- Maximum 2 item actions per module
- Must use standard button variants
- Async handlers must show loading state

### 5. Toolbar Items

Quick actions in the main admin toolbar.

```javascript
// modules/notifications/ui/toolbar.js
export const toolbarItems = [
  {
    id: 'notifications-bell',
    icon: 'bell',
    tooltip: 'Notifications',

    // Badge for unread count
    badge: {
      count: () => getUnreadCount(),  // Can be function
      max: 99,  // Shows "99+" if exceeded
    },

    // Dropdown content
    dropdown: ({ close }) => (
      <NotificationDropdown onClose={close} />
    )
  }
];
```

**Toolbar Constraints:**
- Maximum 1 toolbar item per module
- Must be icon-only (no text)
- Tooltips are required
- Dropdowns must be dismissible

---

## Required Component Patterns

### Loading States

Always show skeleton loaders, never spinners.

```javascript
function MyModuleWidget({ data, loading }) {
  if (loading) {
    return (
      <Card>
        <Card.Body>
          <Skeleton.Text lines={3} />
        </Card.Body>
      </Card>
    );
  }

  return (
    <Card>
      <Card.Body>
        {/* Actual content */}
      </Card.Body>
    </Card>
  );
}
```

### Empty States

Provide helpful empty states with clear actions.

```javascript
function MyModuleList({ items }) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon="inbox"
        title="No items yet"
        description="Create your first item to get started."
        action={
          <Button variant="primary" href="/admin/mymodule/new">
            Create Item
          </Button>
        }
      />
    );
  }

  return (
    <List>
      {items.map(item => (
        <List.Item key={item.id}>{item.name}</List.Item>
      ))}
    </List>
  );
}
```

### Error States

Handle errors gracefully with recovery options.

```javascript
function MyModuleWidget() {
  const { data, error, retry } = useMyModuleData();

  if (error) {
    return (
      <Alert variant="error">
        <Alert.Title>Failed to load data</Alert.Title>
        <Alert.Description>{error.message}</Alert.Description>
        <Alert.Action onClick={retry}>Try Again</Alert.Action>
      </Alert>
    );
  }

  return (/* Normal content */);
}
```

### Form Validation

Use inline validation with clear error messages.

```javascript
function MyModuleForm() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState(null);

  const validate = (value) => {
    if (!value.includes('@')) {
      setError('Please enter a valid email address');
      return false;
    }
    setError(null);
    return true;
  };

  return (
    <FormField label="Email" required error={error}>
      <Input
        type="email"
        value={email}
        onChange={e => setEmail(e.target.value)}
        onBlur={() => validate(email)}
        aria-invalid={!!error}
      />
      {error && <FormField.Error>{error}</FormField.Error>}
    </FormField>
  );
}
```

---

## Accessibility Requirements

### Keyboard Navigation

All interactive elements must be keyboard accessible.

```javascript
// CORRECT: Button handles keyboard
<Button onClick={handleClick}>Click me</Button>

// INCORRECT: Div with click handler
<div onClick={handleClick}>Click me</div>  // NO!
```

### Screen Reader Support

Use proper ARIA attributes and labels.

```javascript
// CORRECT: Labeled switch
<Switch
  checked={enabled}
  onChange={setEnabled}
  aria-label="Enable notifications"
/>

// CORRECT: Described form field
<FormField label="API Key" description="Found in your dashboard">
  <Input aria-describedby="api-key-help" />
</FormField>
```

### Focus Management

Manage focus appropriately in modals and dynamic content.

```javascript
function MyModal({ onClose }) {
  const closeButtonRef = useRef();

  useEffect(() => {
    // Focus close button when modal opens
    closeButtonRef.current?.focus();

    // Trap focus within modal
    return () => {
      // Return focus to trigger element
    };
  }, []);

  return (
    <Dialog onClose={onClose}>
      <Dialog.Header>
        <Dialog.Title>My Modal</Dialog.Title>
        <Dialog.Close ref={closeButtonRef} />
      </Dialog.Header>
      {/* Content */}
    </Dialog>
  );
}
```

---

## Validation & Approval Process

### Automated Checks

Before a module can register UI, it must pass:

1. **Import Validation**: Only `@rses/ui` and `@rses/icons` imports allowed
2. **Token Validation**: No primitive tokens or hardcoded values in CSS
3. **Naming Validation**: All classes prefixed with module name
4. **A11y Audit**: Passes axe-core automated checks
5. **Bundle Size**: UI code < 50KB gzipped

### Manual Review (for marketplace)

Modules submitted to the RSES marketplace undergo:

1. **Visual Consistency**: UI matches RSES aesthetic
2. **UX Quality**: Interactions feel native
3. **Performance**: No jank or slow renders
4. **Edge Cases**: Empty, loading, error states handled

---

## Examples

### Complete Module UI Registration

```javascript
// modules/analytics/index.js
export const manifest = {
  name: 'analytics',
  version: '1.0.0',
  description: 'Website analytics and reporting',
};

// Hook to register UI contributions
export function hook_ui(register, context) {
  // Dashboard widget
  register('dashboard.widget', {
    id: 'analytics-summary',
    title: 'Analytics',
    size: 'small',
    priority: 50,
    render: AnalyticsDashboardWidget,
  });

  // Sidebar navigation
  register('sidebar.item', {
    id: 'analytics',
    label: 'Analytics',
    icon: 'chart-line',
    href: '/admin/analytics',
  });

  // Settings section
  register('settings.section', {
    id: 'analytics-settings',
    title: 'Analytics',
    description: 'Configure tracking and reporting',
    priority: 100,
    render: AnalyticsSettings,
  });
}

// Hook to register routes for full pages
export function hook_routes(register, context) {
  register('GET', '/admin/analytics', AnalyticsPage, 'Analytics dashboard');
  register('GET', '/admin/analytics/reports', ReportsPage, 'Analytics reports');
}
```

### Minimal Module (Settings Only)

```javascript
// modules/seo/index.js
export const manifest = {
  name: 'seo',
  version: '1.0.0',
  description: 'SEO optimization tools',
};

export function hook_ui(register) {
  register('settings.section', {
    id: 'seo-settings',
    title: 'SEO',
    icon: 'search',
    priority: 80,
    render: ({ config, onUpdate }) => (
      <SettingsSection>
        <FormField label="Site Title">
          <Input
            value={config.siteTitle}
            onChange={e => onUpdate({ siteTitle: e.target.value })}
            maxLength={60}
          />
          <FormField.Help>
            Appears in search results. {60 - (config.siteTitle?.length || 0)} characters remaining.
          </FormField.Help>
        </FormField>

        <FormField label="Meta Description">
          <Textarea
            value={config.metaDescription}
            onChange={e => onUpdate({ metaDescription: e.target.value })}
            maxLength={160}
            rows={3}
          />
          <FormField.Help>
            Brief description for search engines. {160 - (config.metaDescription?.length || 0)} characters remaining.
          </FormField.Help>
        </FormField>
      </SettingsSection>
    ),
  });
}
```

---

## Quick Reference

### Allowed Imports

```javascript
import { /* components */ } from '@rses/ui';
import { /* icons */ } from '@rses/icons';
import { useRSES, useContent, useConfig } from '@rses/hooks';
```

### Semantic Token Categories

| Category | Example Tokens |
|----------|---------------|
| **Surfaces** | `--surface-primary`, `--surface-secondary`, `--surface-tertiary` |
| **Text** | `--text-primary`, `--text-secondary`, `--text-tertiary` |
| **Borders** | `--border-subtle`, `--border-default`, `--border-focus` |
| **Accents** | `--accent-primary`, `--accent-subtle` |
| **Status** | `--status-success`, `--status-error`, `--status-warning` |
| **Spacing** | `--space-xs` through `--space-3xl` |
| **Radius** | `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-full` |

### Component Quick Reference

| Component | Use For |
|-----------|---------|
| `Card` | Contained content sections |
| `Button` | Actions and navigation |
| `Switch` | Binary toggles |
| `FormField` | Form inputs with labels |
| `Input` | Text input |
| `Select` | Dropdown selection |
| `Table` | Tabular data |
| `List` | Vertical lists |
| `Badge` | Status indicators |
| `Alert` | Important messages |
| `EmptyState` | No-data states |
| `Skeleton` | Loading states |
| `Dialog` | Modal dialogs |
| `Dropdown` | Contextual menus |

---

*These guidelines ensure that every module feels like a natural part of RSES, creating a cohesive experience for all users.*
