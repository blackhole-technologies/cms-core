/**
 * editor.js - WYSIWYG Editor Configuration & Integration
 *
 * WHY THIS EXISTS:
 * =================
 * Rich text editing is essential for content management. This module provides:
 *
 * - Editor format configurations (full, basic, minimal)
 * - Toolbar button definitions
 * - Media embed integration
 * - Text format integration
 * - Pluggable editor backends (Quill, TipTap, ContentEditable, etc.)
 *
 * DESIGN PHILOSOPHY:
 * ==================
 * Unlike Drupal's CKEditor integration which bundles a specific editor,
 * this module is BACKEND-AGNOSTIC. It provides:
 *
 * 1. Configuration management (toolbar buttons, formats, plugins)
 * 2. Server-side content processing (sanitization, media embeds)
 * 3. API for frontend editors to consume
 *
 * The frontend can use any WYSIWYG library (Quill, TipTap, ProseMirror,
 * CKEditor, TinyMCE, or even contenteditable) and this module provides
 * the configuration and processing layer.
 *
 * WHY NOT BUNDLE AN EDITOR:
 * - Keeps core lightweight
 * - Allows choice of editor (some prefer minimal, others feature-rich)
 * - Separates concerns (config vs rendering)
 * - Enables server-side rendering without JS editor
 *
 * STORAGE STRATEGY:
 * =================
 * /config
 *   /editor-formats.json   <- Format definitions
 *
 * INTEGRATION:
 * ============
 * - text-formats.js: Sanitization and processing
 * - media-library.js: Media embed handling
 * - oembed.js: Remote embed handling
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// ============================================
// TYPE DEFINITIONS
// ============================================

/** Plugin configuration within an editor format */
interface PluginConfig {
  enabled?: boolean;
  [key: string]: unknown;
}

/** An editor format definition */
interface EditorFormat {
  /** Format identifier */
  id: string;
  /** Human-readable name */
  label: string;
  /** What this format is for */
  description: string;
  /** Where this format came from ('builtin', 'custom') */
  source: string;
  /** Toolbar rows and groups (button IDs or '|' separators) */
  toolbar: string[][];
  /** Format-specific settings */
  settings: Record<string, unknown>;
  /** Text format to use for processing */
  textFormat: string;
  /** Allowed HTML tags */
  allowedHtmlTags: string[];
  /** Allowed attributes per tag (key '*' = all tags) */
  allowedHtmlAttributes: Record<string, string[]>;
  /** Enabled plugins and their config */
  plugins: Record<string, PluginConfig>;
  /** Creation timestamp */
  created?: string;
  /** Last update timestamp */
  updated?: string;
}

/** Input for registering a format (partial, pre-defaults) */
interface EditorFormatInput {
  id: string;
  label?: string;
  description?: string;
  source?: string;
  toolbar: string[][];
  settings?: Record<string, unknown>;
  textFormat?: string;
  allowedHtmlTags?: string[];
  allowedHtmlAttributes?: Record<string, string[]>;
  plugins?: Record<string, PluginConfig>;
}

/** A toolbar button definition */
interface ButtonDefinition {
  /** Button identifier */
  id: string;
  /** Button label (for accessibility) */
  label: string;
  /** Icon identifier */
  icon: string;
  /** Button category (formatting, lists, etc.) */
  category: string;
  /** Editor command to execute */
  command: string;
  /** Command options */
  options: Record<string, unknown>;
  /** Is this a toggle button */
  toggle: boolean;
  /** HTML tags this button produces */
  tags: string[];
  /** Dialog to open (e.g., 'link', 'media', 'table') */
  dialog: string | null;
  /** Keyboard shortcut (e.g., 'Ctrl+B') */
  shortcut: string | null;
}

/** Input for registering a button (partial, pre-defaults) */
interface ButtonInput {
  id: string;
  label?: string;
  icon?: string;
  category?: string;
  command?: string;
  options?: Record<string, unknown>;
  toggle?: boolean;
  tags?: string[];
  dialog?: string;
  shortcut?: string;
}

/** Configuration for the editor module */
interface EditorConfig {
  enabled: boolean;
  defaultFormat: string;
  sanitizeOnSave: boolean;
  processMediaEmbeds: boolean;
  processOembeds: boolean;
}

/** Initialization options */
interface EditorInitOptions {
  baseDir: string;
  textFormats?: TextFormatsServiceInterface;
  mediaLibrary?: MediaLibraryServiceInterface;
  oembed?: OembedServiceInterface;
  hooks?: HooksServiceInterface;
  config?: Partial<EditorConfig>;
}

/** Resolved toolbar item for frontend consumption */
interface ResolvedToolbarItem {
  type: string;
  id?: string;
  label?: string;
  icon?: string;
  category?: string;
  command?: string;
  options?: Record<string, unknown>;
  toggle?: boolean;
  tags?: string[];
  dialog?: string | null;
  shortcut?: string | null;
}

/** Frontend editor configuration */
interface FrontendEditorConfig {
  format: {
    id: string;
    label: string;
  };
  toolbar: ResolvedToolbarItem[][];
  settings: Record<string, unknown>;
  allowedHtmlTags: string[];
  allowedHtmlAttributes: Record<string, string[]>;
  plugins: Record<string, PluginConfig>;
  endpoints: {
    mediaLibrary: string;
    linkAutocomplete: string;
    oembed: string;
  };
}

// ---- Service interfaces ----

/** Media entity from the media library */
interface MediaEntity {
  mediaType: string;
  alt?: string;
  caption?: string;
  mimeType?: string;
  name?: string;
}

interface TextFormatsServiceInterface {
  process(formatId: string, html: string): Promise<string>;
}

interface MediaLibraryServiceInterface {
  get(mediaId: string): MediaEntity | null;
  getUrl(entity: MediaEntity): string;
  getEmbed(entity: MediaEntity): string;
}

interface OembedServiceInterface {
  fetch(url: string): Promise<{ html?: string } | null>;
}

interface HooksServiceInterface {
  trigger(hook: string, data: Record<string, unknown>): Promise<Record<string, unknown> | void>;
}

// ============================================
// MODULE STATE
// ============================================

let baseDir: string | null = null;
let textFormatsService: TextFormatsServiceInterface | null = null;
let mediaLibraryService: MediaLibraryServiceInterface | null = null;
let oembedService: OembedServiceInterface | null = null;
let hooksService: HooksServiceInterface | null = null;

/**
 * Editor format definitions
 * Structure: { formatId: EditorFormat, ... }
 */
const formats: Record<string, EditorFormat> = {};

/**
 * Available toolbar buttons
 * Structure: { buttonId: ButtonDefinition, ... }
 */
const buttons: Record<string, ButtonDefinition> = {};

/**
 * Configuration
 */
let config: EditorConfig = {
  enabled: true,
  defaultFormat: 'basic',
  sanitizeOnSave: true,
  processMediaEmbeds: true,
  processOembeds: true,
};

// ============================================
// INITIALIZATION
// ============================================

/**
 * Initialize the editor system
 */
export function init(options: EditorInitOptions = { baseDir: '' }): void {
  baseDir = options.baseDir;
  textFormatsService = options.textFormats || null;
  mediaLibraryService = options.mediaLibrary || null;
  oembedService = options.oembed || null;
  hooksService = options.hooks || null;

  if (options.config) {
    config = { ...config, ...options.config };
  }

  // Ensure config directory exists
  const configDir = join(baseDir, 'config');
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  // Register built-in buttons
  registerBuiltinButtons();

  // Register built-in formats
  registerBuiltinFormats();

  // Load custom formats from config
  loadFormats();

  console.log(`[editor] Initialized (${Object.keys(formats).length} formats, ${Object.keys(buttons).length} buttons)`);
}

/**
 * Load format definitions from config/editor-formats.json
 */
function loadFormats(): void {
  const formatsPath = join(baseDir!, 'config', 'editor-formats.json');

  if (existsSync(formatsPath)) {
    try {
      const data = JSON.parse(readFileSync(formatsPath, 'utf-8')) as Record<string, EditorFormat>;
      Object.assign(formats, data);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.error('[editor] Failed to load formats:', message);
    }
  }
}

/**
 * Save formats to disk
 */
function saveFormats(): void {
  const formatsPath = join(baseDir!, 'config', 'editor-formats.json');

  // Only save custom formats (not built-ins)
  const customFormats: Record<string, EditorFormat> = {};
  for (const [id, format] of Object.entries(formats)) {
    if (format.source !== 'builtin') {
      customFormats[id] = format;
    }
  }

  writeFileSync(formatsPath, JSON.stringify(customFormats, null, 2) + '\n');
}

// ============================================
// BUILT-IN BUTTONS
// ============================================

/**
 * Register all built-in toolbar buttons
 *
 * WHY DEFINE BUTTONS:
 * - Provides a catalog of available formatting options
 * - Frontend editors can use this for toolbar rendering
 * - Enables format-based filtering of allowed buttons
 */
function registerBuiltinButtons(): void {
  // ---- TEXT FORMATTING ----
  buttons.bold = {
    id: 'bold',
    label: 'Bold',
    icon: 'bold',
    category: 'formatting',
    command: 'bold',
    options: {},
    toggle: true,
    tags: ['strong', 'b'],
    dialog: null,
    shortcut: 'Ctrl+B',
  };

  buttons.italic = {
    id: 'italic',
    label: 'Italic',
    icon: 'italic',
    category: 'formatting',
    command: 'italic',
    options: {},
    toggle: true,
    tags: ['em', 'i'],
    dialog: null,
    shortcut: 'Ctrl+I',
  };

  buttons.underline = {
    id: 'underline',
    label: 'Underline',
    icon: 'underline',
    category: 'formatting',
    command: 'underline',
    options: {},
    toggle: true,
    tags: ['u'],
    dialog: null,
    shortcut: 'Ctrl+U',
  };

  buttons.strikethrough = {
    id: 'strikethrough',
    label: 'Strikethrough',
    icon: 'strikethrough',
    category: 'formatting',
    command: 'strikethrough',
    options: {},
    toggle: true,
    tags: ['s', 'del'],
    dialog: null,
    shortcut: null,
  };

  buttons.subscript = {
    id: 'subscript',
    label: 'Subscript',
    icon: 'subscript',
    category: 'formatting',
    command: 'subscript',
    options: {},
    toggle: true,
    tags: ['sub'],
    dialog: null,
    shortcut: null,
  };

  buttons.superscript = {
    id: 'superscript',
    label: 'Superscript',
    icon: 'superscript',
    category: 'formatting',
    command: 'superscript',
    options: {},
    toggle: true,
    tags: ['sup'],
    dialog: null,
    shortcut: null,
  };

  buttons.code = {
    id: 'code',
    label: 'Inline Code',
    icon: 'code',
    category: 'formatting',
    command: 'code',
    options: {},
    toggle: true,
    tags: ['code'],
    dialog: null,
    shortcut: null,
  };

  // ---- HEADINGS ----
  buttons.heading1 = {
    id: 'heading1',
    label: 'Heading 1',
    icon: 'heading-1',
    category: 'headings',
    command: 'heading',
    options: { level: 1 },
    toggle: false,
    tags: ['h1'],
    dialog: null,
    shortcut: null,
  };

  buttons.heading2 = {
    id: 'heading2',
    label: 'Heading 2',
    icon: 'heading-2',
    category: 'headings',
    command: 'heading',
    options: { level: 2 },
    toggle: false,
    tags: ['h2'],
    dialog: null,
    shortcut: null,
  };

  buttons.heading3 = {
    id: 'heading3',
    label: 'Heading 3',
    icon: 'heading-3',
    category: 'headings',
    command: 'heading',
    options: { level: 3 },
    toggle: false,
    tags: ['h3'],
    dialog: null,
    shortcut: null,
  };

  buttons.heading4 = {
    id: 'heading4',
    label: 'Heading 4',
    icon: 'heading-4',
    category: 'headings',
    command: 'heading',
    options: { level: 4 },
    toggle: false,
    tags: ['h4'],
    dialog: null,
    shortcut: null,
  };

  buttons.heading5 = {
    id: 'heading5',
    label: 'Heading 5',
    icon: 'heading-5',
    category: 'headings',
    command: 'heading',
    options: { level: 5 },
    toggle: false,
    tags: ['h5'],
    dialog: null,
    shortcut: null,
  };

  buttons.heading6 = {
    id: 'heading6',
    label: 'Heading 6',
    icon: 'heading-6',
    category: 'headings',
    command: 'heading',
    options: { level: 6 },
    toggle: false,
    tags: ['h6'],
    dialog: null,
    shortcut: null,
  };

  buttons.paragraph = {
    id: 'paragraph',
    label: 'Paragraph',
    icon: 'paragraph',
    category: 'headings',
    command: 'paragraph',
    options: {},
    toggle: false,
    tags: ['p'],
    dialog: null,
    shortcut: null,
  };

  // ---- LISTS ----
  buttons.bulletList = {
    id: 'bulletList',
    label: 'Bullet List',
    icon: 'list-ul',
    category: 'lists',
    command: 'bulletList',
    options: {},
    toggle: true,
    tags: ['ul', 'li'],
    dialog: null,
    shortcut: null,
  };

  buttons.orderedList = {
    id: 'orderedList',
    label: 'Ordered List',
    icon: 'list-ol',
    category: 'lists',
    command: 'orderedList',
    options: {},
    toggle: true,
    tags: ['ol', 'li'],
    dialog: null,
    shortcut: null,
  };

  buttons.indent = {
    id: 'indent',
    label: 'Increase Indent',
    icon: 'indent',
    category: 'lists',
    command: 'indent',
    options: {},
    toggle: false,
    tags: [],
    dialog: null,
    shortcut: null,
  };

  buttons.outdent = {
    id: 'outdent',
    label: 'Decrease Indent',
    icon: 'outdent',
    category: 'lists',
    command: 'outdent',
    options: {},
    toggle: false,
    tags: [],
    dialog: null,
    shortcut: null,
  };

  // ---- ALIGNMENT ----
  buttons.alignLeft = {
    id: 'alignLeft',
    label: 'Align Left',
    icon: 'align-left',
    category: 'alignment',
    command: 'align',
    options: { alignment: 'left' },
    toggle: false,
    tags: [],
    dialog: null,
    shortcut: null,
  };

  buttons.alignCenter = {
    id: 'alignCenter',
    label: 'Align Center',
    icon: 'align-center',
    category: 'alignment',
    command: 'align',
    options: { alignment: 'center' },
    toggle: false,
    tags: [],
    dialog: null,
    shortcut: null,
  };

  buttons.alignRight = {
    id: 'alignRight',
    label: 'Align Right',
    icon: 'align-right',
    category: 'alignment',
    command: 'align',
    options: { alignment: 'right' },
    toggle: false,
    tags: [],
    dialog: null,
    shortcut: null,
  };

  buttons.alignJustify = {
    id: 'alignJustify',
    label: 'Justify',
    icon: 'align-justify',
    category: 'alignment',
    command: 'align',
    options: { alignment: 'justify' },
    toggle: false,
    tags: [],
    dialog: null,
    shortcut: null,
  };

  // ---- LINKS & MEDIA ----
  buttons.link = {
    id: 'link',
    label: 'Insert Link',
    icon: 'link',
    category: 'insert',
    command: 'link',
    options: {},
    toggle: false,
    tags: ['a'],
    dialog: 'link',
    shortcut: 'Ctrl+K',
  };

  buttons.unlink = {
    id: 'unlink',
    label: 'Remove Link',
    icon: 'unlink',
    category: 'insert',
    command: 'unlink',
    options: {},
    toggle: false,
    tags: [],
    dialog: null,
    shortcut: null,
  };

  buttons.image = {
    id: 'image',
    label: 'Insert Image',
    icon: 'image',
    category: 'insert',
    command: 'image',
    options: {},
    toggle: false,
    tags: ['img'],
    dialog: 'media',
    shortcut: null,
  };

  buttons.media = {
    id: 'media',
    label: 'Insert Media',
    icon: 'media',
    category: 'insert',
    command: 'media',
    options: {},
    toggle: false,
    tags: [],
    dialog: 'media',
    shortcut: null,
  };

  buttons.video = {
    id: 'video',
    label: 'Insert Video',
    icon: 'video',
    category: 'insert',
    command: 'video',
    options: {},
    toggle: false,
    tags: ['video', 'iframe'],
    dialog: 'video',
    shortcut: null,
  };

  // ---- BLOCKS ----
  buttons.blockquote = {
    id: 'blockquote',
    label: 'Block Quote',
    icon: 'quote',
    category: 'blocks',
    command: 'blockquote',
    options: {},
    toggle: true,
    tags: ['blockquote'],
    dialog: null,
    shortcut: null,
  };

  buttons.codeBlock = {
    id: 'codeBlock',
    label: 'Code Block',
    icon: 'code-block',
    category: 'blocks',
    command: 'codeBlock',
    options: {},
    toggle: true,
    tags: ['pre', 'code'],
    dialog: null,
    shortcut: null,
  };

  buttons.horizontalRule = {
    id: 'horizontalRule',
    label: 'Horizontal Rule',
    icon: 'horizontal-rule',
    category: 'blocks',
    command: 'horizontalRule',
    options: {},
    toggle: false,
    tags: ['hr'],
    dialog: null,
    shortcut: null,
  };

  // ---- TABLES ----
  buttons.table = {
    id: 'table',
    label: 'Insert Table',
    icon: 'table',
    category: 'tables',
    command: 'table',
    options: {},
    toggle: false,
    tags: ['table', 'thead', 'tbody', 'tr', 'th', 'td'],
    dialog: 'table',
    shortcut: null,
  };

  buttons.tableAddRowBefore = {
    id: 'tableAddRowBefore',
    label: 'Add Row Above',
    icon: 'table-row-add-before',
    category: 'tables',
    command: 'tableAddRowBefore',
    options: {},
    toggle: false,
    tags: [],
    dialog: null,
    shortcut: null,
  };

  buttons.tableAddRowAfter = {
    id: 'tableAddRowAfter',
    label: 'Add Row Below',
    icon: 'table-row-add-after',
    category: 'tables',
    command: 'tableAddRowAfter',
    options: {},
    toggle: false,
    tags: [],
    dialog: null,
    shortcut: null,
  };

  buttons.tableAddColumnBefore = {
    id: 'tableAddColumnBefore',
    label: 'Add Column Left',
    icon: 'table-column-add-before',
    category: 'tables',
    command: 'tableAddColumnBefore',
    options: {},
    toggle: false,
    tags: [],
    dialog: null,
    shortcut: null,
  };

  buttons.tableAddColumnAfter = {
    id: 'tableAddColumnAfter',
    label: 'Add Column Right',
    icon: 'table-column-add-after',
    category: 'tables',
    command: 'tableAddColumnAfter',
    options: {},
    toggle: false,
    tags: [],
    dialog: null,
    shortcut: null,
  };

  buttons.tableDeleteRow = {
    id: 'tableDeleteRow',
    label: 'Delete Row',
    icon: 'table-row-delete',
    category: 'tables',
    command: 'tableDeleteRow',
    options: {},
    toggle: false,
    tags: [],
    dialog: null,
    shortcut: null,
  };

  buttons.tableDeleteColumn = {
    id: 'tableDeleteColumn',
    label: 'Delete Column',
    icon: 'table-column-delete',
    category: 'tables',
    command: 'tableDeleteColumn',
    options: {},
    toggle: false,
    tags: [],
    dialog: null,
    shortcut: null,
  };

  buttons.tableDelete = {
    id: 'tableDelete',
    label: 'Delete Table',
    icon: 'table-delete',
    category: 'tables',
    command: 'tableDelete',
    options: {},
    toggle: false,
    tags: [],
    dialog: null,
    shortcut: null,
  };

  // ---- HISTORY ----
  buttons.undo = {
    id: 'undo',
    label: 'Undo',
    icon: 'undo',
    category: 'history',
    command: 'undo',
    options: {},
    toggle: false,
    tags: [],
    dialog: null,
    shortcut: 'Ctrl+Z',
  };

  buttons.redo = {
    id: 'redo',
    label: 'Redo',
    icon: 'redo',
    category: 'history',
    command: 'redo',
    options: {},
    toggle: false,
    tags: [],
    dialog: null,
    shortcut: 'Ctrl+Y',
  };

  // ---- UTILITIES ----
  buttons.clearFormatting = {
    id: 'clearFormatting',
    label: 'Clear Formatting',
    icon: 'clear-formatting',
    category: 'utilities',
    command: 'clearFormatting',
    options: {},
    toggle: false,
    tags: [],
    dialog: null,
    shortcut: null,
  };

  buttons.source = {
    id: 'source',
    label: 'Source Code',
    icon: 'source',
    category: 'utilities',
    command: 'source',
    options: {},
    toggle: true,
    tags: [],
    dialog: null,
    shortcut: null,
  };

  buttons.fullscreen = {
    id: 'fullscreen',
    label: 'Fullscreen',
    icon: 'fullscreen',
    category: 'utilities',
    command: 'fullscreen',
    options: {},
    toggle: true,
    tags: [],
    dialog: null,
    shortcut: null,
  };

  buttons.specialCharacters = {
    id: 'specialCharacters',
    label: 'Special Characters',
    icon: 'omega',
    category: 'utilities',
    command: 'specialCharacters',
    options: {},
    toggle: false,
    tags: [],
    dialog: 'specialCharacters',
    shortcut: null,
  };
}

// ============================================
// BUILT-IN FORMATS
// ============================================

/**
 * Register built-in editor formats
 */
function registerBuiltinFormats(): void {
  // Minimal format - for simple text fields
  formats.minimal = {
    id: 'minimal',
    label: 'Minimal',
    description: 'Basic formatting only (bold, italic, links)',
    source: 'builtin',
    toolbar: [
      ['bold', 'italic', 'link', 'unlink'],
    ],
    settings: {
      enterMode: 'br',
      autoParagraph: false,
    },
    textFormat: 'plain',
    allowedHtmlTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'a'],
    allowedHtmlAttributes: {
      a: ['href', 'target', 'rel'],
    },
    plugins: {},
  };

  // Basic format - for most content
  formats.basic = {
    id: 'basic',
    label: 'Basic',
    description: 'Standard formatting for most content',
    source: 'builtin',
    toolbar: [
      ['bold', 'italic', 'underline', '|', 'link', 'unlink'],
      ['heading2', 'heading3', 'paragraph', '|', 'bulletList', 'orderedList'],
      ['blockquote', '|', 'undo', 'redo'],
    ],
    settings: {
      enterMode: 'p',
      autoParagraph: true,
    },
    textFormat: 'basic_html',
    allowedHtmlTags: [
      'p', 'br', 'h2', 'h3', 'h4',
      'strong', 'b', 'em', 'i', 'u',
      'a', 'ul', 'ol', 'li',
      'blockquote',
    ],
    allowedHtmlAttributes: {
      a: ['href', 'target', 'rel', 'title'],
    },
    plugins: {},
  };

  // Full format - for power users
  formats.full = {
    id: 'full',
    label: 'Full',
    description: 'Full-featured editor with all formatting options',
    source: 'builtin',
    toolbar: [
      ['bold', 'italic', 'underline', 'strikethrough', '|', 'subscript', 'superscript', '|', 'clearFormatting'],
      ['heading1', 'heading2', 'heading3', 'heading4', 'paragraph', '|', 'bulletList', 'orderedList', 'indent', 'outdent'],
      ['alignLeft', 'alignCenter', 'alignRight', 'alignJustify'],
      ['link', 'unlink', '|', 'image', 'media', 'video', '|', 'table'],
      ['blockquote', 'codeBlock', 'code', 'horizontalRule'],
      ['undo', 'redo', '|', 'source', 'fullscreen'],
    ],
    settings: {
      enterMode: 'p',
      autoParagraph: true,
      allowSourceEditing: true,
    },
    textFormat: 'full_html',
    allowedHtmlTags: [
      'p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'strong', 'b', 'em', 'i', 'u', 's', 'del', 'sub', 'sup', 'code',
      'a', 'ul', 'ol', 'li',
      'blockquote', 'pre', 'hr',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'img', 'figure', 'figcaption',
      'video', 'audio', 'source', 'iframe',
      'div', 'span',
    ],
    allowedHtmlAttributes: {
      '*': ['class', 'id', 'style'],
      a: ['href', 'target', 'rel', 'title'],
      img: ['src', 'alt', 'width', 'height', 'loading'],
      video: ['src', 'width', 'height', 'controls', 'autoplay', 'muted', 'loop'],
      audio: ['src', 'controls'],
      source: ['src', 'type'],
      iframe: ['src', 'width', 'height', 'frameborder', 'allowfullscreen'],
      table: ['border', 'cellpadding', 'cellspacing'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan', 'scope'],
    },
    plugins: {
      table: { enabled: true },
      media: { enabled: true },
      image: { enabled: true },
    },
  };

  // Code format - for developers
  formats.code = {
    id: 'code',
    label: 'Code',
    description: 'Optimized for code and technical content',
    source: 'builtin',
    toolbar: [
      ['bold', 'italic', '|', 'code', 'codeBlock'],
      ['heading2', 'heading3', '|', 'bulletList', 'orderedList'],
      ['link', '|', 'undo', 'redo', '|', 'source'],
    ],
    settings: {
      enterMode: 'p',
      autoParagraph: true,
      tabSize: 2,
    },
    textFormat: 'code_html',
    allowedHtmlTags: [
      'p', 'br', 'h2', 'h3', 'h4',
      'strong', 'em', 'code', 'pre',
      'a', 'ul', 'ol', 'li',
      'blockquote',
    ],
    allowedHtmlAttributes: {
      a: ['href', 'target', 'rel'],
      pre: ['class', 'data-language'],
      code: ['class'],
    },
    plugins: {
      syntaxHighlight: { enabled: true },
    },
  };
}

// ============================================
// FORMAT MANAGEMENT
// ============================================

/**
 * Register a custom editor format
 */
export async function registerFormat(format: EditorFormatInput): Promise<EditorFormat> {
  if (!format.id) {
    throw new Error('Format ID is required');
  }

  // Don't allow overwriting built-ins
  if (formats[format.id]?.source === 'builtin') {
    throw new Error(`Cannot overwrite built-in format: ${format.id}`);
  }

  // Validate toolbar buttons exist
  const flatToolbar = format.toolbar.flat().filter(b => b !== '|');
  for (const buttonId of flatToolbar) {
    if (!buttons[buttonId]) {
      throw new Error(`Unknown toolbar button: ${buttonId}`);
    }
  }

  // Fire hook
  if (hooksService) {
    await hooksService.trigger('editor:beforeRegisterFormat', { format });
  }

  formats[format.id] = {
    id: format.id,
    label: format.label || format.id,
    description: format.description || '',
    source: 'custom',
    toolbar: format.toolbar,
    settings: format.settings || {},
    textFormat: format.textFormat || 'basic_html',
    allowedHtmlTags: format.allowedHtmlTags || [],
    allowedHtmlAttributes: format.allowedHtmlAttributes || {},
    plugins: format.plugins || {},
    created: new Date().toISOString(),
  };

  saveFormats();

  // Fire hook
  if (hooksService) {
    await hooksService.trigger('editor:afterRegisterFormat', { format: formats[format.id]! });
  }

  return formats[format.id]!;
}

/**
 * Get a format definition
 */
export function getFormat(id: string): EditorFormat | null {
  return formats[id] || null;
}

/**
 * List all formats
 */
export function listFormats(): EditorFormat[] {
  return Object.values(formats);
}

/**
 * Update a custom format
 */
export async function updateFormat(id: string, updates: Partial<EditorFormat>): Promise<EditorFormat> {
  const format = formats[id];
  if (!format) {
    throw new Error(`Format "${id}" not found`);
  }

  if (format.source === 'builtin') {
    throw new Error(`Cannot modify built-in format: ${id}`);
  }

  // Fire hook
  if (hooksService) {
    await hooksService.trigger('editor:beforeUpdateFormat', { format, updates });
  }

  Object.assign(format, updates, { updated: new Date().toISOString() });
  saveFormats();

  // Fire hook
  if (hooksService) {
    await hooksService.trigger('editor:afterUpdateFormat', { format });
  }

  return format;
}

/**
 * Delete a custom format
 */
export async function deleteFormat(id: string): Promise<boolean> {
  const format = formats[id];
  if (!format) {
    throw new Error(`Format "${id}" not found`);
  }

  if (format.source === 'builtin') {
    throw new Error(`Cannot delete built-in format: ${id}`);
  }

  // Fire hook
  if (hooksService) {
    await hooksService.trigger('editor:beforeDeleteFormat', { format });
  }

  delete formats[id];
  saveFormats();

  // Fire hook
  if (hooksService) {
    await hooksService.trigger('editor:afterDeleteFormat', { id });
  }

  return true;
}

// ============================================
// BUTTON MANAGEMENT
// ============================================

/**
 * Register a custom button
 */
export function registerButton(button: ButtonInput): ButtonDefinition {
  if (!button.id) {
    throw new Error('Button ID is required');
  }

  buttons[button.id] = {
    id: button.id,
    label: button.label || button.id,
    icon: button.icon || 'default',
    category: button.category || 'custom',
    command: button.command || button.id,
    options: button.options || {},
    toggle: button.toggle || false,
    tags: button.tags || [],
    dialog: button.dialog || null,
    shortcut: button.shortcut || null,
  };

  return buttons[button.id]!;
}

/**
 * Get a button definition
 */
export function getButton(id: string): ButtonDefinition | null {
  return buttons[id] || null;
}

/**
 * List all buttons
 */
export function listButtons(category: string | null = null): ButtonDefinition[] {
  const allButtons = Object.values(buttons);

  if (category) {
    return allButtons.filter(b => b.category === category);
  }

  return allButtons;
}

/**
 * List button categories
 */
export function listButtonCategories(): string[] {
  const categories = new Set<string>();
  for (const button of Object.values(buttons)) {
    categories.add(button.category);
  }
  return Array.from(categories).sort();
}

// ============================================
// CONTENT PROCESSING
// ============================================

/**
 * Process content before saving
 */
export async function processContent(html: string, formatId: string): Promise<string> {
  const format = getFormat(formatId) || getFormat(config.defaultFormat);
  if (!format) {
    throw new Error(`Editor format not found: ${formatId}`);
  }

  let processed = html;

  // Fire before hook
  if (hooksService) {
    const result = await hooksService.trigger('editor:beforeProcess', { html, format });
    processed = (result as Record<string, unknown> | undefined)?.html as string ?? processed;
  }

  // Process media embeds
  if (config.processMediaEmbeds && mediaLibraryService) {
    processed = await processMediaEmbeds(processed);
  }

  // Process oembeds
  if (config.processOembeds && oembedService) {
    processed = await processOembeds(processed);
  }

  // Sanitize using text formats service
  if (config.sanitizeOnSave && textFormatsService) {
    processed = await textFormatsService.process(format.textFormat, processed);
  }

  // Fire after hook
  if (hooksService) {
    const result = await hooksService.trigger('editor:afterProcess', { html: processed, format });
    processed = (result as Record<string, unknown> | undefined)?.html as string ?? processed;
  }

  return processed;
}

/**
 * Process media embed placeholders
 */
async function processMediaEmbeds(html: string): Promise<string> {
  // Replace media placeholders with actual embeds
  // Format: <media-embed data-media-id="xxx" />
  const mediaPattern = /<media-embed\s+data-media-id="([^"]+)"[^>]*><\/media-embed>/g;

  let result = html;
  let match: RegExpExecArray | null;

  while ((match = mediaPattern.exec(html)) !== null) {
    const mediaId = match[1]!;
    const entity = mediaLibraryService!.get(mediaId);

    if (entity) {
      let embed = '';

      switch (entity.mediaType) {
        case 'image':
          embed = `<figure class="media-embed media-image">
            <img src="${mediaLibraryService!.getUrl(entity)}" alt="${escapeHtml(entity.alt || '')}" />
            ${entity.caption ? `<figcaption>${escapeHtml(entity.caption)}</figcaption>` : ''}
          </figure>`;
          break;

        case 'video':
          embed = `<figure class="media-embed media-video">
            <video controls>
              <source src="${mediaLibraryService!.getUrl(entity)}" type="${entity.mimeType}" />
            </video>
          </figure>`;
          break;

        case 'remote_video':
          embed = `<figure class="media-embed media-remote-video">
            ${mediaLibraryService!.getEmbed(entity)}
          </figure>`;
          break;

        case 'audio':
          embed = `<figure class="media-embed media-audio">
            <audio controls>
              <source src="${mediaLibraryService!.getUrl(entity)}" type="${entity.mimeType}" />
            </audio>
          </figure>`;
          break;

        default:
          embed = `<a href="${mediaLibraryService!.getUrl(entity)}" class="media-embed media-document">${escapeHtml(entity.name || '')}</a>`;
      }

      result = result.replace(match[0], embed);
    }
  }

  return result;
}

/**
 * Process oembed URLs
 */
async function processOembeds(html: string): Promise<string> {
  // Replace oembed placeholders with actual embeds
  // Format: <oembed url="https://..." />
  const oembedPattern = /<oembed\s+url="([^"]+)"[^>]*><\/oembed>/g;

  let result = html;
  let match: RegExpExecArray | null;

  while ((match = oembedPattern.exec(html)) !== null) {
    const url = match[1]!;

    try {
      const embedData = await oembedService!.fetch(url);
      if (embedData && embedData.html) {
        result = result.replace(match[0], `<div class="oembed">${embedData.html}</div>`);
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn(`[editor] Failed to fetch oembed for ${url}:`, message);
    }
  }

  return result;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(str: string): string {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================
// API FOR FRONTEND EDITORS
// ============================================

/**
 * Get editor configuration for frontend
 */
export function getEditorConfig(formatId: string): FrontendEditorConfig {
  const format = getFormat(formatId) || getFormat(config.defaultFormat);
  if (!format) {
    throw new Error(`Editor format not found: ${formatId}`);
  }

  // Resolve toolbar buttons
  const resolvedToolbar: ResolvedToolbarItem[][] = format.toolbar.map(row =>
    row.map(item => {
      if (item === '|') return { type: 'separator' };
      const button = getButton(item);
      return button ? { type: 'button', ...button } : null;
    }).filter((item): item is ResolvedToolbarItem => item !== null)
  );

  return {
    format: {
      id: format.id,
      label: format.label,
    },
    toolbar: resolvedToolbar,
    settings: format.settings,
    allowedHtmlTags: format.allowedHtmlTags,
    allowedHtmlAttributes: format.allowedHtmlAttributes,
    plugins: format.plugins,
    endpoints: {
      mediaLibrary: '/admin/media/library/browse',
      linkAutocomplete: '/api/content/search',
      oembed: '/api/oembed',
    },
  };
}

// ============================================
// CONFIGURATION
// ============================================

/**
 * Get configuration
 */
export function getConfig(): EditorConfig {
  return { ...config };
}

/**
 * Check if editor is enabled
 */
export function isEnabled(): boolean {
  return config.enabled;
}
