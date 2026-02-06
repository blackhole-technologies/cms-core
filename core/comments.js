/**
 * Comments System
 *
 * Provides commenting functionality for content items with:
 * - Threaded replies (configurable depth)
 * - Moderation workflow (pending, approved, spam, trash)
 * - Guest and authenticated commenting
 * - Spam detection hooks
 */

import * as hooks from './hooks.js';

// Configuration
let enabled = true;
let defaultStatus = 'pending';
let autoApproveUsers = true;
let maxDepth = 3;
let requireEmail = true;

// Reference to content module (set during init)
let content = null;

// Comment content type name
const COMMENT_TYPE = 'comment';

/**
 * Initialize comments system
 * @param {object} config - Configuration
 * @param {object} contentModule - Content module reference
 */
export function init(config = {}, contentModule) {
  if (config.enabled !== undefined) enabled = config.enabled;
  if (config.defaultStatus !== undefined) defaultStatus = config.defaultStatus;
  if (config.autoApproveUsers !== undefined) autoApproveUsers = config.autoApproveUsers;
  if (config.maxDepth !== undefined) maxDepth = config.maxDepth;
  if (config.requireEmail !== undefined) requireEmail = config.requireEmail;

  content = contentModule;

  console.log(`[comments] Initialized (default: ${defaultStatus}, auto-approve users: ${autoApproveUsers}, max depth: ${maxDepth})`);
}

/**
 * Get comments configuration
 * @returns {object} Current config
 */
export function getConfig() {
  return {
    enabled,
    defaultStatus,
    autoApproveUsers,
    maxDepth,
    requireEmail,
  };
}

/**
 * Register comment content type
 * Called during boot to register the comment schema
 * @param {function} register - Content type register function
 */
export function registerContentType(register) {
  register(COMMENT_TYPE, {
    contentType: { type: 'string', required: true },
    contentId: { type: 'string', required: true },
    parentId: { type: 'string' },
    author: { type: 'string', required: true },
    authorId: { type: 'string' },
    email: { type: 'string' },
    body: { type: 'string', required: true },
    status: { type: 'string' },
    ip: { type: 'string' },
    userAgent: { type: 'string' },
  });
}

/**
 * Add a comment to content
 * @param {string} type - Content type being commented on
 * @param {string} id - Content ID being commented on
 * @param {object} commentData - Comment data
 * @param {object} options - Options { user, ip, userAgent }
 * @returns {Promise<object>} Created comment
 */
export async function addComment(type, id, commentData, options = {}) {
  if (!enabled) {
    throw new Error('Comments are disabled');
  }

  if (!content) {
    throw new Error('Comments system not initialized');
  }

  // Validate target content exists
  const targetContent = content.read(type, id);
  if (!targetContent) {
    throw new Error(`Content not found: ${type}/${id}`);
  }

  // Validate parent comment if replying
  if (commentData.parentId) {
    const parentComment = content.read(COMMENT_TYPE, commentData.parentId);
    if (!parentComment) {
      throw new Error(`Parent comment not found: ${commentData.parentId}`);
    }
    // Check max depth
    const depth = getCommentDepth(commentData.parentId);
    if (depth >= maxDepth) {
      throw new Error(`Maximum reply depth (${maxDepth}) exceeded`);
    }
  }

  // Validate email if required
  if (requireEmail && !options.user && !commentData.email) {
    throw new Error('Email is required for guest comments');
  }

  // Determine initial status
  let status = defaultStatus;
  if (options.user && autoApproveUsers) {
    status = 'approved';
  }

  // Build comment object
  const comment = {
    contentType: type,
    contentId: id,
    parentId: commentData.parentId || null,
    author: commentData.author || options.user?.username || options.user?.name || 'Anonymous',
    authorId: options.user?.id || null,
    email: commentData.email || options.user?.email || null,
    body: commentData.body,
    status,
    ip: options.ip || null,
    userAgent: options.userAgent || null,
  };

  // Fire beforeComment hook (can modify or reject)
  const hookContext = { ...comment, targetContent };
  await hooks.trigger('comments:beforeCreate', hookContext);

  // Check if hook marked as spam
  if (hookContext.status === 'spam') {
    comment.status = 'spam';
  }

  // Create the comment
  const created = await content.create(COMMENT_TYPE, comment);

  // Fire afterComment hook
  await hooks.trigger('comments:afterCreate', {
    comment: created,
    targetType: type,
    targetId: id,
  });

  return created;
}

/**
 * Get comment depth (for threading)
 * @param {string} commentId - Comment ID
 * @returns {number} Depth level (0 = top level)
 */
function getCommentDepth(commentId) {
  let depth = 0;
  let current = content.read(COMMENT_TYPE, commentId);

  while (current && current.parentId) {
    depth++;
    current = content.read(COMMENT_TYPE, current.parentId);
    if (depth > maxDepth + 1) break; // Safety limit
  }

  return depth;
}

/**
 * Get comments for content
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @param {object} options - Options
 * @returns {Array} Comments (flat or threaded)
 */
export function getComments(type, id, options = {}) {
  if (!content) return [];

  const {
    status = 'approved',
    threaded = true,
    limit = 100,
    offset = 0,
    sortBy = 'created',
    sortDir = 'asc',
  } = options;

  // Get all comments for this content
  let comments = (content.list(COMMENT_TYPE)?.items || []).filter(c =>
    c.contentType === type && c.contentId === id
  );

  // Filter by status (null = all statuses)
  if (status) {
    comments = comments.filter(c => c.status === status);
  }

  // Sort
  comments.sort((a, b) => {
    const aVal = a[sortBy] || '';
    const bVal = b[sortBy] || '';
    const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
    return sortDir === 'desc' ? -cmp : cmp;
  });

  // Build threaded structure if requested
  if (threaded) {
    comments = buildCommentTree(comments);
  }

  // Apply pagination to top-level only
  const total = comments.length;
  comments = comments.slice(offset, offset + limit);

  return {
    comments,
    total,
    offset,
    limit,
    threaded,
  };
}

/**
 * Build threaded comment tree
 * @param {Array} comments - Flat comment list
 * @returns {Array} Nested comment tree
 */
function buildCommentTree(comments) {
  const map = new Map();
  const roots = [];

  // Index all comments
  for (const comment of comments) {
    map.set(comment.id, { ...comment, replies: [] });
  }

  // Build tree
  for (const comment of comments) {
    const node = map.get(comment.id);
    if (comment.parentId && map.has(comment.parentId)) {
      map.get(comment.parentId).replies.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

/**
 * Get comment by ID
 * @param {string} id - Comment ID
 * @returns {object|null} Comment
 */
export function getComment(id) {
  if (!content) return null;
  return content.read(COMMENT_TYPE, id);
}

/**
 * Approve a comment
 * @param {string} id - Comment ID
 * @returns {Promise<object>} Updated comment
 */
export async function approveComment(id) {
  return updateCommentStatus(id, 'approved');
}

/**
 * Mark comment as spam
 * @param {string} id - Comment ID
 * @returns {Promise<object>} Updated comment
 */
export async function spamComment(id) {
  return updateCommentStatus(id, 'spam');
}

/**
 * Trash a comment
 * @param {string} id - Comment ID
 * @returns {Promise<object>} Updated comment
 */
export async function trashComment(id) {
  return updateCommentStatus(id, 'trash');
}

/**
 * Update comment status
 * @param {string} id - Comment ID
 * @param {string} status - New status
 * @returns {Promise<object>} Updated comment
 */
async function updateCommentStatus(id, status) {
  if (!content) {
    throw new Error('Comments system not initialized');
  }

  const comment = content.read(COMMENT_TYPE, id);
  if (!comment) {
    throw new Error(`Comment not found: ${id}`);
  }

  const oldStatus = comment.status;

  // Update with force to bypass locks
  const updated = await content.update(COMMENT_TYPE, id, { status }, { force: true });

  // Fire status change hook
  await hooks.trigger('comments:statusChanged', {
    comment: updated,
    oldStatus,
    newStatus: status,
  });

  return updated;
}

/**
 * Delete a comment permanently
 * @param {string} id - Comment ID
 * @returns {Promise<boolean>} Success
 */
export async function deleteComment(id) {
  if (!content) {
    throw new Error('Comments system not initialized');
  }

  // Also delete replies
  const replies = (content.list(COMMENT_TYPE)?.items || []).filter(c => c.parentId === id);
  for (const reply of replies) {
    await deleteComment(reply.id);
  }

  return content.remove(COMMENT_TYPE, id, { permanent: true });
}

/**
 * Get comment count for content
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @param {string} status - Status filter (null = all)
 * @returns {number} Count
 */
export function getCommentCount(type, id, status = null) {
  if (!content) return 0;

  let comments = (content.list(COMMENT_TYPE)?.items || []).filter(c =>
    c.contentType === type && c.contentId === id
  );

  if (status) {
    comments = comments.filter(c => c.status === status);
  }

  return comments.length;
}

/**
 * Get moderation queue (pending comments)
 * @param {object} options - Options
 * @returns {Array} Pending comments
 */
export function getModerationQueue(options = {}) {
  if (!content) return [];

  const {
    limit = 50,
    offset = 0,
    contentType = null,
  } = options;

  let comments = (content.list(COMMENT_TYPE)?.items || []).filter(c => c.status === 'pending');

  if (contentType) {
    comments = comments.filter(c => c.contentType === contentType);
  }

  // Sort by created date (oldest first for moderation)
  comments.sort((a, b) => (a.created < b.created ? -1 : 1));

  const total = comments.length;

  return {
    comments: comments.slice(offset, offset + limit),
    total,
    offset,
    limit,
  };
}

/**
 * Get all comments with filters
 * @param {object} options - Filter options
 * @returns {object} Comments and pagination
 */
export function getAllComments(options = {}) {
  if (!content) return { comments: [], total: 0 };

  const {
    status = null,
    contentType = null,
    contentId = null,
    author = null,
    limit = 50,
    offset = 0,
    sortBy = 'created',
    sortDir = 'desc',
  } = options;

  let comments = (content.list(COMMENT_TYPE)?.items || []);

  // Apply filters
  if (status) {
    comments = comments.filter(c => c.status === status);
  }
  if (contentType) {
    comments = comments.filter(c => c.contentType === contentType);
  }
  if (contentId) {
    comments = comments.filter(c => c.contentId === contentId);
  }
  if (author) {
    comments = comments.filter(c =>
      c.author.toLowerCase().includes(author.toLowerCase())
    );
  }

  // Sort
  comments.sort((a, b) => {
    const aVal = a[sortBy] || '';
    const bVal = b[sortBy] || '';
    const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
    return sortDir === 'desc' ? -cmp : cmp;
  });

  const total = comments.length;

  return {
    comments: comments.slice(offset, offset + limit),
    total,
    offset,
    limit,
  };
}

/**
 * Get comment statistics
 * @returns {object} Statistics
 */
export function getStats() {
  if (!content) {
    return { total: 0, byStatus: {}, byContentType: {}, pending: 0 };
  }

  const comments = (content.list(COMMENT_TYPE)?.items || []) || [];

  const byStatus = {};
  const byContentType = {};

  for (const comment of comments) {
    // Count by status
    byStatus[comment.status] = (byStatus[comment.status] || 0) + 1;

    // Count by content type
    byContentType[comment.contentType] = (byContentType[comment.contentType] || 0) + 1;
  }

  return {
    total: comments.length,
    byStatus,
    byContentType,
    pending: byStatus.pending || 0,
  };
}

/**
 * Bulk action on comments
 * @param {Array} ids - Comment IDs
 * @param {string} action - Action: approve, spam, trash, delete
 * @returns {Promise<object>} Results
 */
export async function bulkAction(ids, action) {
  const results = { success: 0, failed: 0, errors: [] };

  for (const id of ids) {
    try {
      switch (action) {
        case 'approve':
          await approveComment(id);
          break;
        case 'spam':
          await spamComment(id);
          break;
        case 'trash':
          await trashComment(id);
          break;
        case 'delete':
          await deleteComment(id);
          break;
        default:
          throw new Error(`Unknown action: ${action}`);
      }
      results.success++;
    } catch (error) {
      results.failed++;
      results.errors.push({ id, error: error.message });
    }
  }

  return results;
}

/**
 * Get recent comments across all content
 * @param {number} limit - Max comments
 * @returns {Array} Recent comments
 */
export function getRecentComments(limit = 10) {
  if (!content) return [];

  const comments = (content.list(COMMENT_TYPE)?.items || [])
    .filter(c => c.status === 'approved')
    .sort((a, b) => (a.created > b.created ? -1 : 1))
    .slice(0, limit);

  return comments;
}
