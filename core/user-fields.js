/**
 * user-fields.js - User Profile Fields System
 *
 * WHY THIS EXISTS:
 * ================
 * User accounts need customizable profile fields beyond the basic username/email/role.
 * This module provides:
 * - Custom field definitions (text, textarea, select, date, image, etc.)
 * - Field visibility controls (public, authenticated, admin)
 * - Field categories/grouping (contact, social, preferences)
 * - Registration field configuration
 * - User edit permissions per field
 * - Profile rendering for forms and display
 *
 * DESIGN DECISIONS:
 * =================
 *
 * 1. STORAGE IN CONFIG FILE
 *    Field definitions stored in config/user-fields.json.
 *    Why not database:
 *    - Field structure is configuration, not content
 *    - Changes require admin intervention
 *    - Easier to version control
 *    - Consistent with content-types approach
 *
 * 2. EXTENDS EXISTING FIELDS SYSTEM
 *    Reuses core/fields.js for rendering and validation.
 *    User profile fields are essentially a specialized content type.
 *
 * 3. VISIBILITY LEVELS
 *    - public: Anyone can see (even anonymous)
 *    - authenticated: Logged-in users only
 *    - admin: Admin users only
 *
 * 4. STORAGE FORMAT
 *    User profiles stored in data/users/{userId}/profile.json
 *    Separate from core user data (username, password, role)
 */

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import * as fields from './fields.js';
import * as hooks from './hooks.js';

/**
 * Module state
 */
let baseDir = null;
let fieldsModule = null;
let validationModule = null;
let authModule = null;

/**
 * User field definitions
 * Structure: { fieldName: { label, type, category, weight, visibility, ... } }
 */
let userFields = {};

/**
 * Field categories
 * Structure: { categoryName: { label, weight } }
 */
let categories = {};

/**
 * Configuration file paths
 */
let configPath = null;

/**
 * Initialize user fields system
 *
 * @param {string} dir - Base directory for data storage
 * @param {Object} fieldsRef - Reference to fields module
 * @param {Object} validationRef - Reference to validation module
 * @param {Object} authRef - Reference to auth module
 */
export async function init(dir, fieldsRef = null, validationRef = null, authRef = null) {
  baseDir = dir;
  fieldsModule = fieldsRef || fields;
  validationModule = validationRef;
  authModule = authRef;

  configPath = join(baseDir, 'config', 'user-fields.json');

  // Load field definitions
  await loadFieldDefinitions();

  const fieldCount = Object.keys(userFields).length;
  const categoryCount = Object.keys(categories).length;
  console.log(`[user-fields] Initialized (${fieldCount} fields, ${categoryCount} categories)`);
}

/**
 * Load field definitions from config file
 */
async function loadFieldDefinitions() {
  try {
    const data = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(data);

    userFields = config.fields || {};
    categories = config.categories || {};
  } catch (error) {
    if (error.code === 'ENOENT') {
      // File doesn't exist - initialize with defaults
      userFields = getDefaultFields();
      categories = getDefaultCategories();
      await saveFieldDefinitions();
    } else {
      console.error('[user-fields] Error loading field definitions:', error.message);
      userFields = {};
      categories = {};
    }
  }
}

/**
 * Save field definitions to config file
 */
async function saveFieldDefinitions() {
  const config = {
    fields: userFields,
    categories: categories
  };

  try {
    await fs.mkdir(join(baseDir, 'config'), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (error) {
    console.error('[user-fields] Error saving field definitions:', error.message);
    throw error;
  }
}

/**
 * Get default field definitions
 */
function getDefaultFields() {
  return {
    bio: {
      label: 'Biography',
      type: 'textarea',
      category: 'about',
      weight: 0,
      visibility: 'public',
      registration: false,
      user_editable: true,
      settings: { rows: 5, maxlength: 500 }
    },
    location: {
      label: 'Location',
      type: 'text',
      category: 'contact',
      weight: 10,
      visibility: 'authenticated',
      registration: false,
      user_editable: true
    },
    avatar: {
      label: 'Profile Picture',
      type: 'image',
      category: 'about',
      weight: -10,
      visibility: 'public',
      registration: true,
      user_editable: true,
      settings: { max_size: '2MB', dimensions: '200x200' }
    }
  };
}

/**
 * Get default categories
 */
function getDefaultCategories() {
  return {
    about: { label: 'About', weight: 0 },
    contact: { label: 'Contact Info', weight: 10 },
    social: { label: 'Social Links', weight: 20 },
    preferences: { label: 'Preferences', weight: 30 }
  };
}

// ============================================
// FIELD DEFINITION MANAGEMENT
// ============================================

/**
 * Define a new user field
 *
 * @param {string} name - Field name
 * @param {Object} config - Field configuration
 * @returns {Object} - The created field definition
 */
export async function defineField(name, config) {
  if (!name || typeof name !== 'string') {
    throw new Error('Field name must be a non-empty string');
  }

  if (!config || typeof config !== 'object') {
    throw new Error('Field config must be an object');
  }

  // Validate required properties
  if (!config.label) {
    throw new Error('Field must have a label');
  }

  if (!config.type) {
    throw new Error('Field must have a type');
  }

  // Create field definition
  userFields[name] = {
    label: config.label,
    type: config.type,
    category: config.category || 'about',
    weight: config.weight !== undefined ? config.weight : 0,
    visibility: config.visibility || 'public',
    registration: config.registration || false,
    user_editable: config.user_editable !== undefined ? config.user_editable : true,
    required: config.required || false,
    settings: config.settings || {},
    default: config.default,
    validate: config.validate
  };

  // Save to config file
  await saveFieldDefinitions();

  // Trigger hook
  await hooks.trigger('user-fields:defined', { name, field: userFields[name] });

  return userFields[name];
}

/**
 * Get all field definitions
 *
 * @returns {Object} - All field definitions
 */
export function getFields() {
  return { ...userFields };
}

/**
 * Get a specific field definition
 *
 * @param {string} name - Field name
 * @returns {Object|null} - Field definition or null
 */
export function getField(name) {
  return userFields[name] ? { ...userFields[name] } : null;
}

/**
 * Update a field definition
 *
 * @param {string} name - Field name
 * @param {Object} updates - Properties to update
 * @returns {Object} - Updated field definition
 */
export async function updateField(name, updates) {
  if (!userFields[name]) {
    throw new Error(`Field "${name}" does not exist`);
  }

  userFields[name] = {
    ...userFields[name],
    ...updates
  };

  await saveFieldDefinitions();

  await hooks.trigger('user-fields:updated', { name, field: userFields[name] });

  return userFields[name];
}

/**
 * Delete a field definition
 *
 * @param {string} name - Field name
 * @returns {boolean} - True if deleted
 */
export async function deleteField(name) {
  if (!userFields[name]) {
    return false;
  }

  delete userFields[name];

  await saveFieldDefinitions();

  await hooks.trigger('user-fields:deleted', { name });

  return true;
}

/**
 * Get fields grouped by category
 *
 * @returns {Object} - { categoryName: [fields] }
 */
export function getFieldsByCategory() {
  const grouped = {};

  // Initialize all categories
  for (const catName of Object.keys(categories)) {
    grouped[catName] = [];
  }

  // Group fields
  for (const [name, field] of Object.entries(userFields)) {
    const cat = field.category || 'about';
    if (!grouped[cat]) {
      grouped[cat] = [];
    }
    grouped[cat].push({ name, ...field });
  }

  // Sort fields by weight within each category
  for (const cat of Object.keys(grouped)) {
    grouped[cat].sort((a, b) => a.weight - b.weight);
  }

  return grouped;
}

/**
 * Get fields shown during registration
 *
 * @returns {Array} - Array of field definitions with names
 */
export function getRegistrationFields() {
  return Object.entries(userFields)
    .filter(([, field]) => field.registration)
    .map(([name, field]) => ({ name, ...field }))
    .sort((a, b) => a.weight - b.weight);
}

/**
 * Get fields that a user can edit
 *
 * @param {Object} user - User object with role
 * @returns {Array} - Array of editable field definitions
 */
export function getEditableFields(user) {
  const isAdmin = authModule?.hasRole(user, 'admin') || false;

  return Object.entries(userFields)
    .filter(([, field]) => {
      // Admins can edit everything
      if (isAdmin) return true;

      // Regular users can only edit user_editable fields
      return field.user_editable;
    })
    .map(([name, field]) => ({ name, ...field }))
    .sort((a, b) => a.weight - b.weight);
}

/**
 * Get fields visible to a viewer for a profile
 *
 * @param {Object} viewer - Viewing user (null for anonymous)
 * @param {Object} profile - Profile being viewed
 * @returns {Array} - Array of visible field definitions
 */
export function getVisibleFields(viewer, profile) {
  const isAdmin = authModule?.hasRole(viewer, 'admin') || false;
  const isAuthenticated = !!viewer;
  const isOwner = viewer && profile && viewer.id === profile.userId;

  return Object.entries(userFields)
    .filter(([, field]) => {
      // Admins can see everything
      if (isAdmin) return true;

      // Owner can see their own fields
      if (isOwner) return true;

      // Check visibility level
      switch (field.visibility) {
        case 'public':
          return true;
        case 'authenticated':
          return isAuthenticated;
        case 'admin':
          return isAdmin;
        default:
          return false;
      }
    })
    .map(([name, field]) => ({ name, ...field }))
    .sort((a, b) => a.weight - b.weight);
}

// ============================================
// PROFILE DATA MANAGEMENT
// ============================================

/**
 * Get profile data file path for a user
 *
 * @param {string} userId - User ID
 * @returns {string} - File path
 */
function getProfilePath(userId) {
  return join(baseDir, 'data', 'users', userId, 'profile.json');
}

/**
 * Validate profile data against field definitions
 *
 * @param {Object} data - Profile data to validate
 * @returns {Object} - { valid: boolean, errors: [...] }
 */
export async function validateProfileData(data) {
  const errors = [];

  // Build schema from field definitions
  const schema = {};
  for (const [name, field] of Object.entries(userFields)) {
    schema[name] = {
      type: field.type,
      label: field.label,
      required: field.required,
      validate: field.validate,
      ...field.settings
    };
  }

  // Use validation module if available
  if (validationModule) {
    const result = await validationModule.validate('user-profile', data, { schema });
    return result;
  }

  // Fallback to fields module validation
  for (const [name, field] of Object.entries(userFields)) {
    const fieldDef = { ...field, name };
    const value = data[name];

    const result = fieldsModule.validateField(fieldDef, value);
    if (!result.valid) {
      errors.push({
        field: name,
        message: result.error
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Save user profile data
 *
 * @param {string} userId - User ID
 * @param {Object} data - Profile data
 * @returns {Object} - Saved profile data
 */
export async function saveProfile(userId, data) {
  // Validate data
  const validation = await validateProfileData(data);
  if (!validation.valid) {
    const error = new Error('Profile validation failed');
    error.validation = validation;
    throw error;
  }

  // Filter to only known fields
  const profileData = {};
  for (const name of Object.keys(userFields)) {
    if (data[name] !== undefined) {
      profileData[name] = data[name];
    }
  }

  // Add metadata
  const profile = {
    userId,
    data: profileData,
    updatedAt: new Date().toISOString()
  };

  // Trigger before hook
  const hookContext = { userId, profile, isNew: false };
  await hooks.trigger('profile:save:before', hookContext);

  // Save to file
  const profilePath = getProfilePath(userId);
  await fs.mkdir(join(baseDir, 'data', 'users', userId), { recursive: true });
  await fs.writeFile(profilePath, JSON.stringify(profile, null, 2), 'utf-8');

  // Trigger after hook
  await hooks.trigger('profile:save:after', hookContext);

  return profile;
}

/**
 * Get user profile data
 *
 * @param {string} userId - User ID
 * @returns {Object|null} - Profile data or null if not found
 */
export async function getProfile(userId) {
  try {
    const profilePath = getProfilePath(userId);
    const data = await fs.readFile(profilePath, 'utf-8');
    const profile = JSON.parse(data);

    // Trigger view hook
    await hooks.trigger('profile:view', { userId, profile });

    return profile;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

// ============================================
// PROFILE RENDERING
// ============================================

/**
 * Render profile edit form
 *
 * @param {string} userId - User ID
 * @param {Object} viewer - Current user (for permission check)
 * @returns {string} - HTML form
 */
export async function renderProfileForm(userId, viewer) {
  // Get profile data
  const profile = await getProfile(userId);
  const profileData = profile?.data || {};

  // Get editable fields
  const editableFields = getEditableFields(viewer);

  // Group by category
  const fieldsByCategory = {};
  for (const field of editableFields) {
    const cat = field.category || 'about';
    if (!fieldsByCategory[cat]) {
      fieldsByCategory[cat] = [];
    }
    fieldsByCategory[cat].push(field);
  }

  // Render form
  let html = '<form method="POST" action="/profile/save" enctype="multipart/form-data" class="profile-form">';

  // Trigger form hook
  const hookContext = { userId, html };
  await hooks.trigger('profile:form:before', hookContext);

  // Render fields by category
  for (const [catName, catFields] of Object.entries(fieldsByCategory)) {
    const category = categories[catName] || { label: catName };

    html += `
      <fieldset class="profile-category">
        <legend>${escapeHtml(category.label)}</legend>
    `;

    for (const field of catFields) {
      const value = profileData[field.name] ?? field.default ?? null;
      html += fieldsModule.renderFormField(field.name, field, value);
    }

    html += '</fieldset>';
  }

  // Submit button
  html += `
    <div class="form-actions">
      <button type="submit" class="btn btn-primary">Save Profile</button>
    </div>
  `;

  await hooks.trigger('profile:form:after', hookContext);

  html += '</form>';

  return html;
}

/**
 * Render profile display (read-only)
 *
 * @param {string} userId - User ID
 * @param {Object} viewer - Current user (for visibility check)
 * @returns {string} - HTML display
 */
export async function renderProfileDisplay(userId, viewer) {
  // Get profile data
  const profile = await getProfile(userId);
  if (!profile) {
    return '<p class="profile-empty">No profile data available.</p>';
  }

  const profileData = profile.data || {};

  // Get visible fields
  const visibleFields = getVisibleFields(viewer, profile);

  // Group by category
  const fieldsByCategory = {};
  for (const field of visibleFields) {
    const cat = field.category || 'about';
    if (!fieldsByCategory[cat]) {
      fieldsByCategory[cat] = [];
    }
    fieldsByCategory[cat].push(field);
  }

  // Render display
  let html = '<div class="profile-display">';

  // Trigger view hook
  const hookContext = { userId, profile, html };
  await hooks.trigger('profile:display:before', hookContext);

  // Render fields by category
  for (const [catName, catFields] of Object.entries(fieldsByCategory)) {
    const category = categories[catName] || { label: catName };

    html += `
      <section class="profile-category">
        <h3>${escapeHtml(category.label)}</h3>
        <dl class="profile-fields">
    `;

    for (const field of catFields) {
      const value = profileData[field.name];

      // Skip empty values
      if (value === null || value === undefined || value === '') {
        continue;
      }

      html += `
        <dt>${escapeHtml(field.label)}</dt>
        <dd>${formatFieldValue(field, value)}</dd>
      `;
    }

    html += '</dl></section>';
  }

  await hooks.trigger('profile:display:after', hookContext);

  html += '</div>';

  return html;
}

/**
 * Format field value for display
 *
 * @param {Object} field - Field definition
 * @param {*} value - Field value
 * @returns {string} - Formatted HTML
 */
function formatFieldValue(field, value) {
  if (value === null || value === undefined) {
    return '';
  }

  switch (field.type) {
    case 'image':
      return `<img src="${escapeHtml(value)}" alt="${escapeHtml(field.label)}" class="profile-image">`;

    case 'url':
      return `<a href="${escapeHtml(value)}" target="_blank" rel="noopener">${escapeHtml(value)}</a>`;

    case 'email':
      return `<a href="mailto:${escapeHtml(value)}">${escapeHtml(value)}</a>`;

    case 'textarea':
    case 'text':
      return escapeHtml(value).replace(/\n/g, '<br>');

    case 'boolean':
      return value ? 'Yes' : 'No';

    case 'date':
      return new Date(value).toLocaleDateString();

    case 'datetime':
      return new Date(value).toLocaleString();

    default:
      return escapeHtml(String(value));
  }
}

/**
 * Escape HTML special characters
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============================================
// CATEGORY MANAGEMENT
// ============================================

/**
 * Define a new category
 *
 * @param {string} name - Category name
 * @param {Object} config - Category configuration
 * @returns {Object} - Created category
 */
export async function defineCategory(name, config) {
  if (!name || typeof name !== 'string') {
    throw new Error('Category name must be a non-empty string');
  }

  categories[name] = {
    label: config.label || name,
    weight: config.weight !== undefined ? config.weight : 0
  };

  await saveFieldDefinitions();

  return categories[name];
}

/**
 * Get all categories
 *
 * @returns {Object} - All categories
 */
export function getCategories() {
  return { ...categories };
}

/**
 * Get a specific category
 *
 * @param {string} name - Category name
 * @returns {Object|null} - Category or null
 */
export function getCategory(name) {
  return categories[name] ? { ...categories[name] } : null;
}

/**
 * Update a category
 *
 * @param {string} name - Category name
 * @param {Object} updates - Properties to update
 * @returns {Object} - Updated category
 */
export async function updateCategory(name, updates) {
  if (!categories[name]) {
    throw new Error(`Category "${name}" does not exist`);
  }

  categories[name] = {
    ...categories[name],
    ...updates
  };

  await saveFieldDefinitions();

  return categories[name];
}

/**
 * Delete a category
 *
 * @param {string} name - Category name
 * @returns {boolean} - True if deleted
 */
export async function deleteCategory(name) {
  if (!categories[name]) {
    return false;
  }

  delete categories[name];

  await saveFieldDefinitions();

  return true;
}
