/**
 * CVA Configuration Examples
 * ===========================
 *
 * This file provides examples of valid CVA (Class Variance Authority)
 * configurations for use in the CMS template system.
 *
 * CVA allows you to define variant-based component APIs with:
 * - Base classes (always applied)
 * - Variant options (conditional classes)
 * - Default variants (sensible defaults)
 * - Compound variants (multi-condition rules)
 */

// ============================================================================
// EXAMPLE 1: Simple Button
// ============================================================================
// A basic button with size variants
export const simpleButton = {
  base: 'btn rounded transition',
  variants: {
    size: {
      sm: 'text-sm px-2 py-1',
      md: 'text-base px-4 py-2',
      lg: 'text-lg px-6 py-3'
    }
  },
  defaultVariants: {
    size: 'md'
  }
};

// Usage in template:
// {{cva button simpleButton {"size":"lg"}}}
// Output: "btn rounded transition text-lg px-6 py-3"

// ============================================================================
// EXAMPLE 2: Button with Multiple Variants
// ============================================================================
// A button with both size and intent (color) variants
export const button = {
  base: 'btn rounded transition focus:outline-none',
  variants: {
    size: {
      sm: 'text-sm px-2 py-1',
      md: 'text-base px-4 py-2',
      lg: 'text-lg px-6 py-3'
    },
    intent: {
      primary: 'bg-blue-500 text-white hover:bg-blue-600',
      secondary: 'bg-gray-500 text-white hover:bg-gray-600',
      danger: 'bg-red-500 text-white hover:bg-red-600',
      ghost: 'bg-transparent text-gray-700 hover:bg-gray-100'
    },
    disabled: {
      true: 'opacity-50 cursor-not-allowed pointer-events-none',
      false: ''
    }
  },
  defaultVariants: {
    size: 'md',
    intent: 'primary',
    disabled: 'false'
  }
};

// Usage in template:
// {{cva button button {"size":"lg","intent":"danger"}}}
// Output: "btn rounded transition focus:outline-none text-lg px-6 py-3 bg-red-500 text-white hover:bg-red-600"

// ============================================================================
// EXAMPLE 3: Button with Compound Variants
// ============================================================================
// A button where small + primary gets extra bold styling
export const buttonWithCompound = {
  base: 'btn rounded transition',
  variants: {
    size: {
      sm: 'text-sm px-2 py-1',
      md: 'text-base px-4 py-2',
      lg: 'text-lg px-6 py-3'
    },
    intent: {
      primary: 'bg-blue-500 text-white',
      secondary: 'bg-gray-500 text-white'
    }
  },
  defaultVariants: {
    size: 'md',
    intent: 'primary'
  },
  compoundVariants: [
    // When size is small AND intent is primary, make it bold
    {
      size: 'sm',
      intent: 'primary',
      class: 'font-bold shadow-md'
    },
    // When size is large AND intent is danger, add warning border
    {
      size: 'lg',
      intent: 'secondary',
      class: 'border-2 border-gray-700'
    }
  ]
};

// Usage in template:
// {{cva button buttonWithCompound {"size":"sm","intent":"primary"}}}
// Output: "btn rounded transition text-sm px-2 py-1 bg-blue-500 text-white font-bold shadow-md"

// ============================================================================
// EXAMPLE 4: Alert Component
// ============================================================================
// An alert box with severity variants
export const alert = {
  base: 'alert p-4 rounded-lg border',
  variants: {
    severity: {
      info: 'bg-blue-50 border-blue-200 text-blue-800',
      success: 'bg-green-50 border-green-200 text-green-800',
      warning: 'bg-yellow-50 border-yellow-200 text-yellow-800',
      error: 'bg-red-50 border-red-200 text-red-800'
    },
    dismissible: {
      true: 'pr-10',
      false: ''
    }
  },
  defaultVariants: {
    severity: 'info',
    dismissible: 'false'
  }
};

// Usage in template:
// {{cva div alert {"severity":"error","dismissible":"true"}}}
// Output: "alert p-4 rounded-lg border bg-red-50 border-red-200 text-red-800 pr-10"

// ============================================================================
// EXAMPLE 5: Badge Component
// ============================================================================
// A badge with size and color variants
export const badge = {
  base: 'badge inline-flex items-center font-semibold rounded-full',
  variants: {
    size: {
      sm: 'text-xs px-2 py-0.5',
      md: 'text-sm px-3 py-1',
      lg: 'text-base px-4 py-1.5'
    },
    color: {
      blue: 'bg-blue-100 text-blue-800',
      green: 'bg-green-100 text-green-800',
      yellow: 'bg-yellow-100 text-yellow-800',
      red: 'bg-red-100 text-red-800',
      gray: 'bg-gray-100 text-gray-800'
    },
    outlined: {
      true: 'bg-transparent border-2',
      false: ''
    }
  },
  defaultVariants: {
    size: 'md',
    color: 'blue',
    outlined: 'false'
  },
  compoundVariants: [
    // Outlined blue badge needs blue border
    {
      color: 'blue',
      outlined: 'true',
      class: 'border-blue-500 text-blue-700'
    },
    // Outlined green badge needs green border
    {
      color: 'green',
      outlined: 'true',
      class: 'border-green-500 text-green-700'
    }
  ]
};

// Usage in template:
// {{cva span badge {"color":"green","outlined":"true"}}}
// Output: "badge inline-flex items-center font-semibold rounded-full text-sm px-3 py-1 bg-transparent border-2 border-green-500 text-green-700"

// ============================================================================
// EXAMPLE 6: Card Component
// ============================================================================
// A card with elevation and padding variants
export const card = {
  base: 'card bg-white rounded-lg overflow-hidden',
  variants: {
    elevation: {
      none: 'shadow-none',
      sm: 'shadow-sm',
      md: 'shadow-md',
      lg: 'shadow-lg',
      xl: 'shadow-xl'
    },
    padding: {
      none: 'p-0',
      sm: 'p-3',
      md: 'p-6',
      lg: 'p-8'
    },
    bordered: {
      true: 'border border-gray-200',
      false: ''
    }
  },
  defaultVariants: {
    elevation: 'md',
    padding: 'md',
    bordered: 'false'
  }
};

// Usage in template:
// {{cva div card {"elevation":"lg","padding":"lg","bordered":"true"}}}
// Output: "card bg-white rounded-lg overflow-hidden shadow-lg p-8 border border-gray-200"

// ============================================================================
// EXAMPLE 7: Input Field
// ============================================================================
// A form input with state and size variants
export const input = {
  base: 'input w-full rounded border focus:outline-none focus:ring-2',
  variants: {
    size: {
      sm: 'text-sm px-2 py-1',
      md: 'text-base px-3 py-2',
      lg: 'text-lg px-4 py-3'
    },
    state: {
      default: 'border-gray-300 focus:border-blue-500 focus:ring-blue-500',
      error: 'border-red-500 focus:border-red-500 focus:ring-red-500',
      success: 'border-green-500 focus:border-green-500 focus:ring-green-500'
    },
    disabled: {
      true: 'bg-gray-100 cursor-not-allowed opacity-60',
      false: 'bg-white'
    }
  },
  defaultVariants: {
    size: 'md',
    state: 'default',
    disabled: 'false'
  }
};

// Usage in template:
// {{cva input input {"state":"error","size":"lg"}}}
// Output: "input w-full rounded border focus:outline-none focus:ring-2 text-lg px-4 py-3 border-red-500 focus:border-red-500 focus:ring-red-500 bg-white"

// ============================================================================
// HOW TO USE IN TEMPLATES
// ============================================================================

/*
METHOD 1: Reference config from template data
----------------------------------------------
In your route handler:
  const data = {
    buttonConfig: button,
    buttonProps: { size: 'lg', intent: 'primary' }
  };
  return render('page.html', data);

In your template:
  <button class="{{cva button buttonConfig buttonProps}}">
    Click me
  </button>

METHOD 2: Inline config (for simple cases)
-------------------------------------------
In your template:
  <button class="{{cva button {\"base\":\"btn\",\"variants\":{\"size\":{\"sm\":\"btn-sm\"}}} {\"size\":\"sm\"}}}">
    Click me
  </button>

METHOD 3: Mix data and inline (common pattern)
------------------------------------------------
In your route handler:
  const data = { buttonConfig: button };
  return render('page.html', data);

In your template:
  <button class="{{cva button buttonConfig {\"size\":\"lg\",\"intent\":\"danger\"}}}">
    Click me
  </button>
*/

// ============================================================================
// VALIDATION NOTES
// ============================================================================

/*
All configs are validated against the CVA schema:

REQUIRED:
  - base: string (non-empty CSS classes)

OPTIONAL:
  - variants: object of variant definitions
  - defaultVariants: object mapping variant names to default values
  - compoundVariants: array of compound rules

VALIDATION RULES:
  1. base must be a non-empty string
  2. variants must be object (not array)
  3. Each variant must map values to CSS class strings
  4. defaultVariants keys must exist in variants
  5. defaultVariants values must be valid variant values
  6. compoundVariants must be an array
  7. Each compound must have at least one condition
  8. Each compound must have 'class' or 'classes' property
  9. Compound conditions must reference valid variants

See CvaSchema.js for full validation logic.
*/
