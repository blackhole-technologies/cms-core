/**
 * field-add-more.js - Multi-Value Field Widget
 *
 * Provides "Add more" functionality for multi-value fields with cardinality > 1.
 *
 * Features:
 * - Single empty item display initially
 * - "Add more" button appears after filling first item
 * - Incremental item addition (one at a time)
 * - Respects cardinality limits (disabled/hidden when limit reached)
 * - Smooth UX transitions
 * - Remove item buttons
 * - Per-field instance configuration
 */

class FieldAddMore {
  /**
   * Initialize the Add More widget
   *
   * @param {HTMLElement} container - The field container element
   * @param {Object} options - Configuration options
   */
  constructor(container, options = {}) {
    this.container = container;
    this.options = {
      cardinality: options.cardinality || -1, // -1 = unlimited
      fieldName: options.fieldName || 'field',
      fieldType: options.fieldType || 'text',
      minItems: options.minItems || 1,
      maxItems: options.cardinality === -1 ? 999 : options.cardinality,
      addButtonText: options.addButtonText || 'Add another item',
      removeButtonText: options.removeButtonText || 'Remove',
      animationDuration: options.animationDuration || 200,
      ...options
    };

    this.items = [];
    this.itemCount = 0;
    this.init();
  }

  /**
   * Initialize the widget
   */
  init() {
    // Create wrapper for items
    this.itemsWrapper = document.createElement('div');
    this.itemsWrapper.className = 'field-add-more-items';
    this.itemsWrapper.dataset.fieldName = this.options.fieldName;
    this.container.appendChild(this.itemsWrapper);

    // Create "Add more" button container
    this.buttonWrapper = document.createElement('div');
    this.buttonWrapper.className = 'field-add-more-actions';
    this.container.appendChild(this.buttonWrapper);

    this.addButton = document.createElement('button');
    this.addButton.type = 'button';
    this.addButton.className = 'btn btn-secondary btn-sm field-add-more-button';
    this.addButton.textContent = this.options.addButtonText;
    this.addButton.addEventListener('click', () => this.addItem());
    this.buttonWrapper.appendChild(this.addButton);

    // Add initial empty item
    this.addItem(null, true);

    // Hide button initially (shown after first item has data)
    this.addButton.style.display = 'none';

    // Add CSS if not already present
    if (!document.getElementById('field-add-more-styles')) {
      this.injectStyles();
    }
  }

  /**
   * Add a new field item
   *
   * @param {*} value - Pre-populate value (optional)
   * @param {boolean} isInitial - Whether this is the initial item
   */
  addItem(value = null, isInitial = false) {
    // Check cardinality limit
    if (this.itemCount >= this.options.maxItems) {
      return;
    }

    const itemWrapper = document.createElement('div');
    itemWrapper.className = 'field-add-more-item';
    itemWrapper.dataset.delta = this.itemCount;

    // Create the input field based on field type
    const input = this.createInput(value);
    input.name = `${this.options.fieldName}[${this.itemCount}]`;
    input.dataset.delta = this.itemCount;

    // Add input change listener to show/hide "Add more" button
    if (isInitial) {
      input.addEventListener('input', () => {
        if (input.value.trim() !== '') {
          this.addButton.style.display = 'inline-block';
        }
      });
    }

    const itemContent = document.createElement('div');
    itemContent.className = 'field-add-more-item-content';
    itemContent.appendChild(input);

    itemWrapper.appendChild(itemContent);

    // Add remove button (not for the first/only item initially)
    if (!isInitial || this.itemCount > 0) {
      const removeButton = this.createRemoveButton(itemWrapper);
      const removeWrapper = document.createElement('div');
      removeWrapper.className = 'field-add-more-item-actions';
      removeWrapper.appendChild(removeButton);
      itemWrapper.appendChild(removeWrapper);
    }

    // Animate in (except initial item)
    if (!isInitial) {
      itemWrapper.style.opacity = '0';
      itemWrapper.style.maxHeight = '0';
      itemWrapper.style.overflow = 'hidden';
    }

    this.itemsWrapper.appendChild(itemWrapper);
    this.items.push({ wrapper: itemWrapper, input });
    this.itemCount++;

    // Animate in
    if (!isInitial) {
      requestAnimationFrame(() => {
        itemWrapper.style.transition = `opacity ${this.options.animationDuration}ms ease, max-height ${this.options.animationDuration}ms ease`;
        itemWrapper.style.opacity = '1';
        itemWrapper.style.maxHeight = '200px'; // Enough for most fields
        setTimeout(() => {
          itemWrapper.style.maxHeight = 'none';
          itemWrapper.style.overflow = 'visible';
        }, this.options.animationDuration);
      });
    }

    // Update button state
    this.updateButtonState();

    // Focus new input
    if (!isInitial) {
      input.focus();
    }
  }

  /**
   * Create input element based on field type
   *
   * @param {*} value - Initial value
   * @returns {HTMLElement} Input element
   */
  createInput(value) {
    let input;

    switch (this.options.fieldType) {
      case 'textarea':
        input = document.createElement('textarea');
        input.rows = 3;
        break;

      case 'number':
        input = document.createElement('input');
        input.type = 'number';
        break;

      case 'email':
        input = document.createElement('input');
        input.type = 'email';
        break;

      case 'url':
        input = document.createElement('input');
        input.type = 'url';
        break;

      case 'date':
        input = document.createElement('input');
        input.type = 'date';
        break;

      case 'select':
        input = document.createElement('select');
        if (this.options.options) {
          Object.entries(this.options.options).forEach(([val, label]) => {
            const option = document.createElement('option');
            option.value = val;
            option.textContent = label;
            input.appendChild(option);
          });
        }
        break;

      default:
        input = document.createElement('input');
        input.type = 'text';
    }

    input.className = 'form-input field-add-more-input';

    if (value !== null && value !== undefined) {
      if (input.tagName === 'SELECT') {
        input.value = value;
      } else {
        input.value = value;
      }
    }

    if (this.options.placeholder) {
      input.placeholder = this.options.placeholder;
    }

    if (this.options.required && this.itemCount === 0) {
      input.required = true;
    }

    return input;
  }

  /**
   * Create remove button
   *
   * @param {HTMLElement} itemWrapper - Item wrapper element
   * @returns {HTMLElement} Remove button
   */
  createRemoveButton(itemWrapper) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-danger btn-sm field-add-more-remove';
    button.textContent = this.options.removeButtonText;
    button.title = 'Remove this item';

    button.addEventListener('click', () => {
      this.removeItem(itemWrapper);
    });

    return button;
  }

  /**
   * Remove a field item
   *
   * @param {HTMLElement} itemWrapper - Item wrapper to remove
   */
  removeItem(itemWrapper) {
    // Don't allow removing last item
    if (this.items.length <= this.options.minItems) {
      return;
    }

    // Animate out
    itemWrapper.style.transition = `opacity ${this.options.animationDuration}ms ease, max-height ${this.options.animationDuration}ms ease`;
    itemWrapper.style.opacity = '0';
    itemWrapper.style.maxHeight = '0';
    itemWrapper.style.overflow = 'hidden';

    setTimeout(() => {
      // Remove from DOM
      itemWrapper.remove();

      // Remove from items array
      const index = this.items.findIndex(item => item.wrapper === itemWrapper);
      if (index !== -1) {
        this.items.splice(index, 1);
        this.itemCount--;
      }

      // Re-index remaining items
      this.reindexItems();

      // Update button state
      this.updateButtonState();

      // If only one item left and it's empty, hide add button
      if (this.items.length === 1) {
        const firstInput = this.items[0].input;
        if (firstInput.value.trim() === '') {
          this.addButton.style.display = 'none';
        }
      }
    }, this.options.animationDuration);
  }

  /**
   * Re-index items after removal
   */
  reindexItems() {
    this.items.forEach((item, index) => {
      item.wrapper.dataset.delta = index;
      item.input.dataset.delta = index;
      item.input.name = `${this.options.fieldName}[${index}]`;
    });
  }

  /**
   * Update add button state based on cardinality
   */
  updateButtonState() {
    const atLimit = this.itemCount >= this.options.maxItems;

    if (atLimit) {
      this.addButton.disabled = true;
      this.addButton.classList.add('disabled');
      if (this.options.cardinality !== -1) {
        this.addButton.textContent = `Maximum of ${this.options.maxItems} items reached`;
      }
    } else {
      this.addButton.disabled = false;
      this.addButton.classList.remove('disabled');
      this.addButton.textContent = this.options.addButtonText;
    }
  }

  /**
   * Get all field values
   *
   * @returns {Array} Array of values
   */
  getValues() {
    return this.items.map(item => {
      const input = item.input;
      return input.value;
    }).filter(val => val !== ''); // Filter empty values
  }

  /**
   * Set field values
   *
   * @param {Array} values - Array of values to set
   */
  setValues(values) {
    // Clear existing items
    this.items.forEach(item => item.wrapper.remove());
    this.items = [];
    this.itemCount = 0;

    // Add items for each value
    if (values && values.length > 0) {
      values.forEach((value, index) => {
        this.addItem(value, index === 0);
      });
      // Show add button if we have values
      this.addButton.style.display = 'inline-block';
    } else {
      // Add one empty item
      this.addItem(null, true);
      this.addButton.style.display = 'none';
    }
  }

  /**
   * Inject CSS styles for the widget
   */
  injectStyles() {
    const style = document.createElement('style');
    style.id = 'field-add-more-styles';
    style.textContent = `
      .field-add-more-items {
        margin-bottom: 0.75rem;
      }

      .field-add-more-item {
        display: flex;
        gap: 0.5rem;
        margin-bottom: 0.5rem;
        align-items: flex-start;
        transition: opacity 200ms ease, max-height 200ms ease;
      }

      .field-add-more-item-content {
        flex: 1;
      }

      .field-add-more-item-actions {
        display: flex;
        align-items: center;
        padding-top: 0.25rem;
      }

      .field-add-more-input {
        width: 100%;
      }

      .field-add-more-button {
        transition: all 200ms ease;
      }

      .field-add-more-button.disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .field-add-more-remove {
        min-width: 80px;
      }

      .field-add-more-actions {
        margin-top: 0.25rem;
      }

      /* Responsive adjustments */
      @media (max-width: 768px) {
        .field-add-more-item {
          flex-direction: column;
          gap: 0.25rem;
        }

        .field-add-more-item-actions {
          width: 100%;
          justify-content: flex-end;
        }
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Destroy the widget
   */
  destroy() {
    this.items.forEach(item => item.wrapper.remove());
    this.buttonWrapper.remove();
    this.items = [];
    this.itemCount = 0;
  }
}

// Export for use in modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = FieldAddMore;
}

// Make available globally
if (typeof window !== 'undefined') {
  window.FieldAddMore = FieldAddMore;
}
