/**
 * CMS Core — TipTap WYSIWYG Editor Integration
 *
 * Automatically enhances <textarea> elements with data-editor="richtext"
 * attribute into full WYSIWYG editors.
 *
 * On form submit, the editor content (HTML) is copied back into the
 * hidden textarea so the server receives it in the normal form flow.
 */

import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';

/**
 * Toolbar button definitions — each has a label, command, and optional
 * active-state check.
 */
const toolbarButtons = [
  { label: '<b>B</b>', title: 'Bold (Ctrl+B)', command: (e) => e.chain().focus().toggleBold().run(), active: (e) => e.isActive('bold') },
  { label: '<i>I</i>', title: 'Italic (Ctrl+I)', command: (e) => e.chain().focus().toggleItalic().run(), active: (e) => e.isActive('italic') },
  { label: '<u>U</u>', title: 'Underline (Ctrl+U)', command: (e) => e.chain().focus().toggleUnderline().run(), active: (e) => e.isActive('underline') },
  { label: '~S~', title: 'Strikethrough', command: (e) => e.chain().focus().toggleStrike().run(), active: (e) => e.isActive('strike') },
  { type: 'separator' },
  { label: 'H2', title: 'Heading 2', command: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(), active: (e) => e.isActive('heading', { level: 2 }) },
  { label: 'H3', title: 'Heading 3', command: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(), active: (e) => e.isActive('heading', { level: 3 }) },
  { label: 'H4', title: 'Heading 4', command: (e) => e.chain().focus().toggleHeading({ level: 4 }).run(), active: (e) => e.isActive('heading', { level: 4 }) },
  { type: 'separator' },
  { label: '&bull; List', title: 'Bullet List', command: (e) => e.chain().focus().toggleBulletList().run(), active: (e) => e.isActive('bulletList') },
  { label: '1. List', title: 'Ordered List', command: (e) => e.chain().focus().toggleOrderedList().run(), active: (e) => e.isActive('orderedList') },
  { label: '&ldquo; Quote', title: 'Blockquote', command: (e) => e.chain().focus().toggleBlockquote().run(), active: (e) => e.isActive('blockquote') },
  { type: 'separator' },
  { label: '&#128279;', title: 'Insert Link', command: (e) => {
    const url = prompt('Enter URL:');
    if (url) {
      e.chain().focus().setLink({ href: url }).run();
    }
  }, active: (e) => e.isActive('link') },
  { label: '&#128247;', title: 'Insert Image', command: (e) => {
    const url = prompt('Enter image URL:');
    if (url) {
      e.chain().focus().setImage({ src: url }).run();
    }
  }},
  { label: '&#9638; Table', title: 'Insert Table', command: (e) => {
    e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  }},
  { type: 'separator' },
  { label: '&#8592;', title: 'Undo (Ctrl+Z)', command: (e) => e.chain().focus().undo().run() },
  { label: '&#8594;', title: 'Redo (Ctrl+Shift+Z)', command: (e) => e.chain().focus().redo().run() },
  { type: 'separator' },
  { label: '&lt;/&gt;', title: 'Code Block', command: (e) => e.chain().focus().toggleCodeBlock().run(), active: (e) => e.isActive('codeBlock') },
  { label: 'Align L', title: 'Align Left', command: (e) => e.chain().focus().setTextAlign('left').run(), active: (e) => e.isActive({ textAlign: 'left' }) },
  { label: 'Align C', title: 'Align Center', command: (e) => e.chain().focus().setTextAlign('center').run(), active: (e) => e.isActive({ textAlign: 'center' }) },
  { label: 'Align R', title: 'Align Right', command: (e) => e.chain().focus().setTextAlign('right').run(), active: (e) => e.isActive({ textAlign: 'right' }) },
];

/**
 * Build the toolbar DOM for an editor instance.
 */
function createToolbar(editor) {
  const toolbar = document.createElement('div');
  toolbar.className = 'cms-editor-toolbar';

  toolbarButtons.forEach((btn) => {
    if (btn.type === 'separator') {
      const sep = document.createElement('span');
      sep.className = 'cms-editor-separator';
      toolbar.appendChild(sep);
      return;
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cms-editor-btn';
    button.innerHTML = btn.label;
    button.title = btn.title || '';
    button.addEventListener('click', (e) => {
      e.preventDefault();
      btn.command(editor);
    });
    toolbar.appendChild(button);
  });

  // Update active states on transaction
  editor.on('transaction', () => {
    const buttons = toolbar.querySelectorAll('.cms-editor-btn');
    let btnIndex = 0;
    toolbarButtons.forEach((btn) => {
      if (btn.type === 'separator') return;
      const el = buttons[btnIndex++];
      if (el && btn.active) {
        el.classList.toggle('is-active', btn.active(editor));
      }
    });
  });

  return toolbar;
}

/**
 * Initialize a TipTap editor for a given textarea.
 */
function initEditor(textarea) {
  // Hide the original textarea
  textarea.style.display = 'none';

  // Create editor wrapper
  const wrapper = document.createElement('div');
  wrapper.className = 'cms-editor-wrapper';

  // Create editor content area
  const editorEl = document.createElement('div');
  editorEl.className = 'cms-editor-content';

  // Initialize TipTap
  const editor = new Editor({
    element: editorEl,
    extensions: [
      StarterKit,
      Underline,
      Image,
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: textarea.placeholder || 'Start writing...' }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
    ],
    content: textarea.value || '',
    editorProps: {
      attributes: {
        class: 'cms-editor-prosemirror',
      },
    },
  });

  // Build toolbar
  const toolbar = createToolbar(editor);

  // Assemble wrapper
  wrapper.appendChild(toolbar);
  wrapper.appendChild(editorEl);

  // Insert wrapper after the textarea
  textarea.parentNode.insertBefore(wrapper, textarea.nextSibling);

  // Sync editor content back to textarea on form submit
  const form = textarea.closest('form');
  if (form) {
    form.addEventListener('submit', () => {
      textarea.value = editor.getHTML();
    });
  }

  // Also sync periodically for auto-save
  editor.on('update', () => {
    textarea.value = editor.getHTML();
  });

  return editor;
}

/**
 * Auto-initialize all editor textareas on the page.
 */
function initAll() {
  const targets = document.querySelectorAll('textarea[data-editor="richtext"]');
  const editors = [];

  targets.forEach((textarea) => {
    try {
      editors.push(initEditor(textarea));
    } catch (err) {
      console.error('[CMS Editor] Failed to initialize editor:', err);
      // Graceful degradation: textarea remains visible
      textarea.style.display = '';
    }
  });

  return editors;
}

// Auto-init on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAll);
} else {
  initAll();
}

// Export for programmatic use
export { initEditor, initAll };
