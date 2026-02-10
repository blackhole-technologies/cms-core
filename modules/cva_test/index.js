/**
 * CVA Test Module
 *
 * This module provides test routes to verify CVA (Class Variance Authority)
 * functionality in the template system.
 */

// CVA configurations for testing
const buttonConfig = {
  base: 'btn rounded transition',
  variants: {
    size: {
      sm: 'text-sm px-2 py-1',
      md: 'text-base px-4 py-2',
      lg: 'text-lg px-6 py-3'
    },
    intent: {
      primary: 'bg-blue-500 text-white hover:bg-blue-600',
      secondary: 'bg-gray-500 text-white hover:bg-gray-600',
      danger: 'bg-red-500 text-white hover:bg-red-600'
    }
  },
  defaultVariants: {
    size: 'md',
    intent: 'primary'
  },
  compoundVariants: [
    {
      size: 'sm',
      intent: 'primary',
      class: 'font-bold shadow-md'
    }
  ]
};

const badgeConfig = {
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
      red: 'bg-red-100 text-red-800'
    }
  },
  defaultVariants: {
    size: 'md',
    color: 'blue'
  }
};

/**
 * Register routes
 */
export function hook_routes(register, context) {
  register('/cva-test', {
    handler: showCvaTest,
    methods: ['GET'],
    auth: false,
    title: 'CVA Test Page'
  });
}

/**
 * Show CVA test page
 */
async function showCvaTest(req, res, { render }) {
  const html = render('cva-test.html', {
    title: 'CVA Test Page',
    buttonConfig,
    badgeConfig,
    testCases: [
      {
        name: 'Button - Small Primary (with compound)',
        config: buttonConfig,
        props: { size: 'sm', intent: 'primary' },
        expected: 'btn rounded transition text-sm px-2 py-1 bg-blue-500 text-white hover:bg-blue-600 font-bold shadow-md'
      },
      {
        name: 'Button - Large Danger (no compound)',
        config: buttonConfig,
        props: { size: 'lg', intent: 'danger' },
        expected: 'btn rounded transition text-lg px-6 py-3 bg-red-500 text-white hover:bg-red-600'
      },
      {
        name: 'Button - Default (uses defaultVariants)',
        config: buttonConfig,
        props: {},
        expected: 'btn rounded transition text-base px-4 py-2 bg-blue-500 text-white hover:bg-blue-600'
      },
      {
        name: 'Badge - Small Green',
        config: badgeConfig,
        props: { size: 'sm', color: 'green' },
        expected: 'badge inline-flex items-center font-semibold rounded-full text-xs px-2 py-0.5 bg-green-100 text-green-800'
      }
    ]
  });

  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
}
