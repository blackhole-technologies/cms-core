/**
 * CMS Core — Media Library Modal
 *
 * Provides a modal dialog for browsing, searching, and selecting media
 * from the media library. Can be triggered from image fields or the
 * TipTap editor.
 *
 * Usage:
 *   MediaModal.open({ onSelect: function(media) { ... } });
 */

(function() {
  'use strict';

  var modal = null;
  var isOpen = false;
  var callback = null;
  var currentPage = 1;

  function createModal() {
    modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'none';
    modal.innerHTML =
      '<div class="modal-content" style="max-width:720px">' +
        '<div class="modal-header">' +
          '<h3>Media Library</h3>' +
          '<button type="button" class="modal-close" aria-label="Close">&times;</button>' +
        '</div>' +
        '<div class="modal-body">' +
          '<div class="media-modal-search">' +
            '<input type="text" class="search-input" placeholder="Search media..." id="mediaModalSearch">' +
            '<select class="filter-select" id="mediaModalFilter">' +
              '<option value="">All types</option>' +
              '<option value="image">Images</option>' +
              '<option value="document">Documents</option>' +
              '<option value="video">Video</option>' +
              '<option value="audio">Audio</option>' +
            '</select>' +
          '</div>' +
          '<div class="media-modal-upload">' +
            '<div class="media-drop-zone" id="mediaDropZone">' +
              '<p>Drop files here or <label class="media-upload-label">browse<input type="file" id="mediaFileInput" accept="image/*,application/pdf,.doc,.docx" multiple hidden></label></p>' +
            '</div>' +
          '</div>' +
          '<div class="media-modal-grid" id="mediaModalGrid">' +
            '<p class="text-muted text-sm text-center">Loading media...</p>' +
          '</div>' +
        '</div>' +
        '<div class="modal-footer">' +
          '<button type="button" class="btn" id="mediaModalCancel">Cancel</button>' +
          '<button type="button" class="btn btn-primary" id="mediaModalInsert" disabled>Insert selected</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modal);

    // Event bindings
    modal.querySelector('.modal-close').addEventListener('click', close);
    modal.querySelector('#mediaModalCancel').addEventListener('click', close);
    modal.querySelector('#mediaModalInsert').addEventListener('click', insertSelected);
    modal.addEventListener('click', function(e) { if (e.target === modal) close(); });

    modal.querySelector('#mediaModalSearch').addEventListener('input', debounce(loadMedia, 300));
    modal.querySelector('#mediaModalFilter').addEventListener('change', loadMedia);

    // Drag-drop upload
    var dropZone = modal.querySelector('#mediaDropZone');
    dropZone.addEventListener('dragover', function(e) {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', function() {
      dropZone.classList.remove('drag-over');
    });
    dropZone.addEventListener('drop', function(e) {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      if (e.dataTransfer.files.length > 0) {
        uploadFiles(e.dataTransfer.files);
      }
    });

    // File input upload
    modal.querySelector('#mediaFileInput').addEventListener('change', function(e) {
      if (e.target.files.length > 0) {
        uploadFiles(e.target.files);
      }
    });
  }

  var selectedMedia = null;

  function loadMedia() {
    var grid = modal.querySelector('#mediaModalGrid');
    var search = modal.querySelector('#mediaModalSearch').value;
    var filter = modal.querySelector('#mediaModalFilter').value;

    var url = '/admin/media/library/browse?format=json&page=' + currentPage;
    if (search) url += '&search=' + encodeURIComponent(search);
    if (filter) url += '&type=' + encodeURIComponent(filter);

    fetch(url, { credentials: 'same-origin' })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        selectedMedia = null;
        modal.querySelector('#mediaModalInsert').disabled = true;

        if (!data.items || data.items.length === 0) {
          grid.innerHTML = '<p class="text-muted text-sm text-center" style="padding:2rem">No media found</p>';
          return;
        }

        var html = '';
        data.items.forEach(function(item) {
          var thumb = item.thumbnail || item.url || '';
          var isImage = /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(item.filename || '');

          html +=
            '<div class="media-grid-item" data-id="' + item.id + '" data-url="' + (item.url || '') + '" data-filename="' + (item.filename || '') + '">' +
              (isImage && thumb
                ? '<img src="' + thumb + '" alt="' + (item.alt || item.filename || '') + '" loading="lazy">'
                : '<div class="media-file-icon">&#128196;</div>') +
              '<span class="media-grid-label">' + (item.filename || item.id) + '</span>' +
            '</div>';
        });

        grid.innerHTML = html;

        // Selection handlers
        grid.querySelectorAll('.media-grid-item').forEach(function(el) {
          el.addEventListener('click', function() {
            grid.querySelectorAll('.media-grid-item').forEach(function(i) { i.classList.remove('selected'); });
            el.classList.add('selected');
            selectedMedia = {
              id: el.dataset.id,
              url: el.dataset.url,
              filename: el.dataset.filename,
            };
            modal.querySelector('#mediaModalInsert').disabled = false;
          });

          el.addEventListener('dblclick', function() {
            insertSelected();
          });
        });
      })
      .catch(function(err) {
        grid.innerHTML = '<p class="text-muted text-sm text-center">Failed to load media</p>';
        console.error('[MediaModal] Load failed:', err);
      });
  }

  function uploadFiles(files) {
    var formData = new FormData();
    for (var i = 0; i < files.length; i++) {
      formData.append('files', files[i]);
    }

    var csrfToken = document.querySelector('input[name="_csrf"]')?.value;
    if (csrfToken) formData.append('_csrf', csrfToken);

    fetch('/admin/media/upload', {
      method: 'POST',
      body: formData,
      credentials: 'same-origin',
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (typeof CMS !== 'undefined') {
        CMS.toast('Media uploaded successfully', 'success');
      }
      loadMedia();
    })
    .catch(function(err) {
      console.error('[MediaModal] Upload failed:', err);
      if (typeof CMS !== 'undefined') {
        CMS.toast('Upload failed: ' + err.message, 'error');
      }
    });
  }

  function insertSelected() {
    if (!selectedMedia) return;
    if (callback) callback(selectedMedia);
    close();
  }

  function open(options) {
    options = options || {};
    callback = options.onSelect || null;
    currentPage = 1;

    if (!modal) createModal();
    modal.style.display = 'flex';
    isOpen = true;
    loadMedia();
  }

  function close() {
    if (!modal) return;
    modal.style.display = 'none';
    isOpen = false;
    callback = null;
    selectedMedia = null;
  }

  function debounce(fn, delay) {
    var timer;
    return function() {
      clearTimeout(timer);
      timer = setTimeout(fn, delay);
    };
  }

  // Export globally
  window.MediaModal = { open: open, close: close };
})();
