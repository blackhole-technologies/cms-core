/**
 * widget.js - Image Field Widget with AI Alt Text Generation
 *
 * WHY THIS EXISTS:
 * Extends the core image field widget to automatically generate alt text
 * when images are uploaded, improving accessibility and reducing manual work.
 *
 * FEATURES:
 * - Auto-generates alt text on image upload
 * - Provides regenerate button for new alt text
 * - Shows AI-generated indicator
 * - Allows manual editing with "reviewed" status
 * - Configurable per-field enable/disable
 */

/**
 * Enhance the image field widget with AI alt text capabilities
 *
 * This function is called during hook_boot to modify the image field renderer
 *
 * @param {Object} fieldRegistry - The field type registry
 * @param {Object} services - Service container
 */
export function enhanceImageWidget(fieldRegistry, services) {
  // Get the original image field renderer
  const originalImageField = fieldRegistry.get('image');

  if (!originalImageField) {
    console.warn('[ai_image_alt] Image field type not found, cannot enhance');
    return;
  }

  // Store original widget renderer
  const originalWidget = originalImageField.widget;

  // Create enhanced widget renderer
  const enhancedWidget = (field, value, options = {}) => {
    const id = field.id || `field-${field.name}`;
    const name = field.name;
    const accept = field.accept || 'image/*';
    const required = field.required && !value ? 'required' : '';

    // Check if AI alt text is enabled for this field
    const aiAltEnabled = field.aiAltText !== false; // Default to enabled
    const altFieldName = field.altField || `${name}_alt`;
    const altValue = options.data?.[altFieldName] || '';
    const isAiGenerated = options.data?.[`${altFieldName}_ai_generated`] || false;
    const isReviewed = options.data?.[`${altFieldName}_reviewed`] || false;

    let preview = '';
    if (value) {
      preview = `<div class="image-preview">
        <img src="${escapeHtml(value)}" alt="Preview" style="max-width: 200px; max-height: 200px;">
      </div>`;
    }

    // Alt text field
    let altTextField = '';
    if (aiAltEnabled) {
      const aiIndicator = isAiGenerated && !isReviewed
        ? `<span class="ai-indicator" title="AI Generated">🤖 AI Generated</span>`
        : '';

      const reviewedIndicator = isReviewed
        ? `<span class="reviewed-indicator" title="Manually Reviewed">✓ Reviewed</span>`
        : '';

      altTextField = `
        <div class="alt-text-field" style="margin-top: 10px;">
          <label for="${id}_alt">Alt Text ${aiIndicator}${reviewedIndicator}</label>
          <div class="alt-text-input-group">
            <input
              type="text"
              id="${id}_alt"
              name="${altFieldName}"
              value="${escapeHtml(altValue)}"
              placeholder="Describe the image for accessibility"
              class="form-input"
              oninput="markAltTextAsReviewed('${id}_alt')"
            >
            ${value ? `
              <button
                type="button"
                class="btn btn-small btn-regenerate"
                onclick="regenerateAltText('${id}', '${altFieldName}')"
                title="Generate new alt text"
              >
                🔄 Regenerate
              </button>
            ` : ''}
          </div>
          <input type="hidden" name="${altFieldName}_ai_generated" id="${id}_alt_ai_generated" value="${isAiGenerated}">
          <input type="hidden" name="${altFieldName}_reviewed" id="${id}_alt_reviewed" value="${isReviewed}">
        </div>
      `;
    }

    return `
      <div class="image-field image-field-ai-enhanced" data-field-name="${name}">
        ${preview}
        <input
          type="file"
          id="${id}"
          name="${name}"
          accept="${accept}"
          class="form-file"
          ${required}
          onchange="handleImageUploadWithAI(this, '${id}', '${altFieldName}', ${aiAltEnabled})"
        >
        ${value ? `<input type="hidden" name="${name}_existing" value="${escapeHtml(value)}">` : ''}
        ${altTextField}
      </div>
    `;
  };

  // Update the field type with enhanced widget
  fieldRegistry.register('image', {
    ...originalImageField,
    widget: enhancedWidget,
    _originalWidget: originalWidget
  });

  console.log('[ai_image_alt] Image field widget enhanced with AI alt text');
}

/**
 * Helper function to escape HTML
 */
function escapeHtml(unsafe) {
  if (unsafe === null || unsafe === undefined) return '';
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Client-side JavaScript for AI alt text widget
 * This will be injected into admin pages
 */
export const widgetClientScript = `
<script>
// Handle image upload with AI alt text generation
async function handleImageUploadWithAI(input, fieldId, altFieldName, aiEnabled) {
  // First, show preview
  previewImage(input, fieldId);

  // If AI is enabled and a file was selected, generate alt text
  if (aiEnabled && input.files && input.files[0]) {
    const file = input.files[0];
    const altInput = document.getElementById(fieldId + '_alt');
    const aiGeneratedInput = document.getElementById(fieldId + '_alt_ai_generated');
    const reviewedInput = document.getElementById(fieldId + '_alt_reviewed');

    if (!altInput) return;

    // Show loading state
    const originalPlaceholder = altInput.placeholder;
    altInput.placeholder = '⏳ Generating alt text...';
    altInput.disabled = true;

    try {
      // Create form data
      const formData = new FormData();
      formData.append('file', file);

      // Call AI alt text generation API
      const response = await fetch('/api/ai/alt-text/generate', {
        method: 'POST',
        body: formData
      });

      const result = await response.json();

      if (response.ok && result.data) {
        // Set the generated alt text
        altInput.value = result.data.text || result.data.altText || '';

        // Mark as AI generated
        if (aiGeneratedInput) aiGeneratedInput.value = 'true';
        if (reviewedInput) reviewedInput.value = 'false';

        // Add AI indicator if not present
        updateAIIndicator(fieldId, true, false);

        // Show success notification
        showNotification('✅ Alt text generated successfully', 'success');
      } else {
        throw new Error(result.message || result.error || 'Generation failed');
      }
    } catch (error) {
      console.error('[ai_image_alt] Generation error:', error);
      altInput.placeholder = originalPlaceholder;
      showNotification('⚠️ Could not generate alt text: ' + error.message, 'warning');
    } finally {
      altInput.disabled = false;
      altInput.focus();
    }
  }
}

// Regenerate alt text for existing image
async function regenerateAltText(fieldId, altFieldName) {
  const fileInput = document.getElementById(fieldId);
  const altInput = document.getElementById(fieldId + '_alt');
  const aiGeneratedInput = document.getElementById(fieldId + '_alt_ai_generated');
  const reviewedInput = document.getElementById(fieldId + '_alt_reviewed');

  if (!fileInput || !altInput) return;

  // Check if there's a file to process
  const file = fileInput.files?.[0];
  if (!file) {
    showNotification('⚠️ No image file available', 'warning');
    return;
  }

  // Confirm regeneration if there's existing alt text
  if (altInput.value && !confirm('Regenerate alt text? This will replace the current text.')) {
    return;
  }

  // Show loading state
  const originalValue = altInput.value;
  altInput.value = '';
  altInput.placeholder = '⏳ Regenerating alt text...';
  altInput.disabled = true;

  try {
    // Create form data
    const formData = new FormData();
    formData.append('file', file);

    // Call AI alt text generation API
    const response = await fetch('/api/ai/alt-text/generate', {
      method: 'POST',
      body: formData
    });

    const result = await response.json();

    if (response.ok && result.data) {
      // Set the generated alt text
      altInput.value = result.data.text || result.data.altText || '';

      // Mark as AI generated, not reviewed
      if (aiGeneratedInput) aiGeneratedInput.value = 'true';
      if (reviewedInput) reviewedInput.value = 'false';

      // Update indicator
      updateAIIndicator(fieldId, true, false);

      // Show success notification
      showNotification('✅ Alt text regenerated successfully', 'success');
    } else {
      throw new Error(result.message || result.error || 'Generation failed');
    }
  } catch (error) {
    console.error('[ai_image_alt] Regeneration error:', error);
    altInput.value = originalValue;
    showNotification('⚠️ Could not regenerate alt text: ' + error.message, 'error');
  } finally {
    altInput.disabled = false;
    altInput.placeholder = 'Describe the image for accessibility';
    altInput.focus();
  }
}

// Mark alt text as manually reviewed when edited
function markAltTextAsReviewed(altInputId) {
  const reviewedInput = document.getElementById(altInputId.replace('_alt', '_alt_reviewed'));
  if (reviewedInput) {
    reviewedInput.value = 'true';
    updateAIIndicator(altInputId.replace('_alt', ''), null, true);
  }
}

// Update AI/Reviewed indicators
function updateAIIndicator(fieldId, isAiGenerated, isReviewed) {
  const altTextField = document.querySelector(\`#\${fieldId}_alt\`)?.closest('.alt-text-field');
  if (!altTextField) return;

  const label = altTextField.querySelector('label');
  if (!label) return;

  // Remove existing indicators
  label.querySelectorAll('.ai-indicator, .reviewed-indicator').forEach(el => el.remove());

  // Add new indicators
  if (isAiGenerated !== false) {
    const aiIndicator = document.createElement('span');
    aiIndicator.className = 'ai-indicator';
    aiIndicator.title = 'AI Generated';
    aiIndicator.textContent = ' 🤖 AI Generated';
    label.appendChild(aiIndicator);
  }

  if (isReviewed) {
    const reviewedIndicator = document.createElement('span');
    reviewedIndicator.className = 'reviewed-indicator';
    reviewedIndicator.title = 'Manually Reviewed';
    reviewedIndicator.textContent = ' ✓ Reviewed';
    label.appendChild(reviewedIndicator);
  }
}

// Show notification (fallback implementation if not available globally)
function showNotification(message, type = 'info') {
  if (window.showNotification && typeof window.showNotification === 'function') {
    window.showNotification(message, type);
  } else {
    alert(message);
  }
}
</script>

<style>
.image-field-ai-enhanced {
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  padding: 15px;
  background: #fafafa;
}

.alt-text-field {
  margin-top: 15px;
}

.alt-text-field label {
  display: block;
  margin-bottom: 5px;
  font-weight: 500;
}

.alt-text-input-group {
  display: flex;
  gap: 8px;
}

.alt-text-input-group input {
  flex: 1;
}

.btn-regenerate {
  white-space: nowrap;
}

.ai-indicator {
  font-size: 0.85em;
  color: #0071b9;
  font-weight: normal;
}

.reviewed-indicator {
  font-size: 0.85em;
  color: #4caf50;
  font-weight: normal;
}
</style>
`;
