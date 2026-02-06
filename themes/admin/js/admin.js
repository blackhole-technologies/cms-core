/**
 * Admin Theme JavaScript
 * @version 1.0.0
 */
(function() {
  'use strict';

  function init() {
    initVerticalTabs();
    initCollapsibleFieldsets();
    initTableSelectAll();
    initConfirmActions();
  }

  function initVerticalTabs() {
    document.querySelectorAll('.vertical-tabs').forEach(container => {
      const items = container.querySelectorAll('.vertical-tabs__menu-item');
      const panes = container.querySelectorAll('.vertical-tabs__pane');

      items.forEach((item, i) => {
        item.querySelector('a')?.addEventListener('click', e => {
          e.preventDefault();
          items.forEach(mi => mi.classList.remove('vertical-tabs__menu-item--active'));
          panes.forEach(p => p.style.display = 'none');
          item.classList.add('vertical-tabs__menu-item--active');
          if (panes[i]) panes[i].style.display = 'block';
        });
      });

      if (items[0]) items[0].querySelector('a')?.click();
    });
  }

  function initCollapsibleFieldsets() {
    document.querySelectorAll('.fieldset.collapsible').forEach(fieldset => {
      const legend = fieldset.querySelector('.fieldset__legend');
      legend?.addEventListener('click', () => fieldset.classList.toggle('collapsed'));
    });
  }

  function initTableSelectAll() {
    document.querySelectorAll('table').forEach(table => {
      const selectAll = table.querySelector('thead input[type="checkbox"].select-all');
      if (!selectAll) return;

      const checkboxes = table.querySelectorAll('tbody input[type="checkbox"]');
      selectAll.addEventListener('change', () => {
        checkboxes.forEach(cb => {
          cb.checked = selectAll.checked;
          cb.closest('tr')?.classList.toggle('selected', cb.checked);
        });
      });

      checkboxes.forEach(cb => {
        cb.addEventListener('change', () => {
          cb.closest('tr')?.classList.toggle('selected', cb.checked);
          const all = Array.from(checkboxes).every(c => c.checked);
          const some = Array.from(checkboxes).some(c => c.checked);
          selectAll.checked = all;
          selectAll.indeterminate = some && !all;
        });
      });
    });
  }

  function initConfirmActions() {
    document.querySelectorAll('[data-confirm]').forEach(el => {
      el.addEventListener('click', e => {
        if (!confirm(el.dataset.confirm || 'Are you sure?')) {
          e.preventDefault();
        }
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
