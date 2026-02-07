# Drupal Deep Dive

Comprehensive analysis of Drupal's architecture for CMS Core development.
**Last Updated:** 2026-02-07

---

## 1. Entity System Architecture

### 1.1 ContentEntityBase - The Foundation

From `core/lib/Drupal/Core/Entity/ContentEntityBase.php`:

```php
abstract class ContentEntityBase extends EntityBase 
  implements \IteratorAggregate, ContentEntityInterface, TranslationStatusInterface {

  // Raw field values, keyed by language code
  protected $values = [];
  
  // Instantiated field objects (lazy-loaded)
  protected $fields = [];
  
  // Cached field definitions
  protected $fieldDefinitions;
  
  // Translation tracking
  protected $translations = [];
  protected $activeLangcode = LanguageInterface::LANGCODE_DEFAULT;
  
  // Revision tracking
  protected $newRevision = FALSE;
  protected $isDefaultRevision = TRUE;
  protected $loadedRevisionId;
  
  // Entity keys cache
  protected $entityKeys = [];
  protected $translatableEntityKeys = [];
  
  // Validation state
  protected $validated = FALSE;
  protected $validationRequired = FALSE;
}
```

**Key Architecture Decisions:**

1. **Lazy Field Loading**: Fields are objects, but only instantiated when accessed
   ```php
   public function get($field_name) {
     if (!isset($this->fields[$field_name][$this->activeLangcode])) {
       return $this->getTranslatedField($field_name, $this->activeLangcode);
     }
     return $this->fields[$field_name][$this->activeLangcode];
   }
   ```

2. **Translation as Language-Keyed Arrays**: Values stored per-language
   ```php
   $this->values[$field_name][$langcode] = $value;
   ```

3. **Entity Keys for Performance**: Common fields (id, uuid, bundle) cached for fast access
   ```php
   protected $entityKeys = [];  // id, bundle, revision
   protected $translatableEntityKeys = [];  // label, langcode
   ```

4. **Revision Tracking Built-In**:
   ```php
   public function setNewRevision($value = TRUE) {
     if ($value && !$this->newRevision) {
       $this->set($this->getEntityType()->getKey('revision'), NULL);
     }
     $this->newRevision = $value;
   }
   ```

### 1.2 Field Storage Configuration

From `core/modules/field/src/Entity/FieldStorageConfig.php`:

```php
#[ConfigEntityType(
  id: 'field_storage_config',
  config_prefix: 'storage',
  entity_keys: ['id' => 'id', 'label' => 'id'],
  config_export: [
    'id',
    'field_name',
    'entity_type',
    'type',
    'settings',
    'module',
    'locked',
    'cardinality',
    'translatable',
    'indexes',
    'persist_with_no_fields',
    'custom_storage',
  ],
)]
class FieldStorageConfig extends ConfigEntityBase {
  
  const NAME_MAX_LENGTH = 32;
  
  protected $id;              // "node.body" (entity_type.field_name)
  protected $field_name;      // "body"
  protected $entity_type;     // "node"
  protected $type;            // "text_with_summary"
  protected $module;          // "text"
  protected $settings = [];
  protected $cardinality = 1; // 1, n, or CARDINALITY_UNLIMITED (-1)
  protected $translatable = TRUE;
  protected $locked = FALSE;
  protected $indexes = [];
  protected $deleted = FALSE;
  protected $schema;
}
```

**Two-Level Field System:**

```
FieldStorageConfig (global)
├── Defines: type, cardinality, storage settings
├── Can be shared across bundles
└── ID format: {entity_type}.{field_name}

FieldConfig (per-bundle)
├── References: FieldStorageConfig
├── Defines: label, required, default, display settings
└── ID format: {entity_type}.{bundle}.{field_name}
```

**Why Two Levels?**
- Reuse field storage across content types (e.g., "body" field on articles and pages)
- Separate storage concerns from display/validation concerns
- Allow per-bundle customization (required on articles, optional on pages)

### 1.3 Field Schema Generation

```php
public function getSchema() {
  if (!isset($this->schema)) {
    $class = $this->getFieldItemClass();
    $schema = $class::schema($this);  // Field type defines its schema
    $schema += [
      'columns' => [],
      'unique keys' => [],
      'indexes' => [],
      'foreign keys' => [],
    ];
    // Merge custom indexes with field type defaults
    $schema['indexes'] = $this->indexes + $schema['indexes'];
    $this->schema = $schema;
  }
  return $this->schema;
}
```

---

## 2. Views System - Query Building

### 2.1 ViewExecutable Core

From `core/modules/views/src/ViewExecutable.php`:

```php
class ViewExecutable {
  
  // Core state
  public $storage;           // View config entity
  public $built = FALSE;
  public $executed = FALSE;
  public $args = [];
  public $result = [];       // ResultRow[] with numeric index
  
  // Pagination
  protected $current_page = NULL;
  protected $items_per_page = NULL;
  protected $offset = NULL;
  public $total_rows = NULL;
  
  // Display system
  public $current_display;
  public $display_handler;   // Current DisplayPluginBase
  public $displayHandlers;   // DisplayPluginCollection
  
  // Style/presentation
  public $style_plugin;
  public $rowPlugin;
  
  // Handler types (the query components)
  public $field;             // FieldPluginBase[]
  public $argument;          // ArgumentPluginBase[]
  public $sort;              // SortPluginBase[]
  public $filter;            // FilterPluginBase[]
  public $relationship;      // RelationshipPluginBase[]
  public $header;            // AreaPluginBase[]
  public $footer;            // AreaPluginBase[]
  public $empty;             // AreaPluginBase[]
  
  // Query
  public ?QueryPluginBase $query = NULL;
  public $pager = NULL;
}
```

**Handler Type Registry:**
```php
public static function getHandlerTypes() {
  return [
    'field'        => ['type' => 'field',        'plural' => 'fields'],
    'argument'     => ['type' => 'argument',     'plural' => 'arguments'],
    'sort'         => ['type' => 'sort',         'plural' => 'sorts'],
    'filter'       => ['type' => 'filter',       'plural' => 'filters'],
    'relationship' => ['type' => 'relationship', 'plural' => 'relationships'],
    'header'       => ['type' => 'area',         'plural' => 'header'],
    'footer'       => ['type' => 'area',         'plural' => 'footer'],
    'empty'        => ['type' => 'area',         'plural' => 'empty'],
  ];
}
```

### 2.2 View Execution Flow

```php
// 1. Initialize display
public function initDisplay() {
  $this->displayHandlers = new DisplayPluginCollection($this, $this->displayPluginManager);
  $this->current_display = 'default';
  $this->display_handler = $this->displayHandlers->get('default');
}

// 2. Initialize handlers
public function initHandlers() {
  if (empty($this->inited)) {
    foreach ($this::getHandlerTypes() as $key => $info) {
      $this->_initHandler($key, $info);  // Load from display, check access
    }
    $this->inited = TRUE;
  }
}

// 3. Build query
protected function _preQuery() {
  foreach ($this::getHandlerTypes() as $key => $info) {
    foreach ($this->$key as $id => $handler) {
      $handlers[$id]->preQuery();  // Each handler adds to query
    }
  }
}

// 4. Execute
protected function _postExecute() {
  foreach ($this::getHandlerTypes() as $key => $info) {
    foreach ($this->$key as $id => $handler) {
      $handlers[$id]->postExecute($this->result);  // Post-process results
    }
  }
}
```

### 2.3 Exposed Filters

```php
public function getExposedInput() {
  if (empty($this->exposed_input)) {
    $this->initDisplay();
    $this->exposed_input = $this->request->query->all();
    
    // Remove non-filter params
    foreach (['page', 'q'] as $key) {
      unset($this->exposed_input[$key]);
    }
    
    // Check session for "remember" settings
    if (empty($this->exposed_input)) {
      $session = $this->request->getSession();
      $display_id = $this->display_handler->isDefaulted('filters') 
        ? 'default' 
        : $this->current_display;
      if ($remembered = $session->get('views')[$this->storage->id()][$display_id]) {
        $this->exposed_input = $remembered;
      }
    }
  }
  return $this->exposed_input;
}
```

---

## 3. Layout Builder Architecture

### 3.1 Section Domain Object

From `core/modules/layout_builder/src/Section.php`:

```php
class Section implements ThirdPartySettingsInterface {
  
  protected $layoutId;              // "layout_twocol_section"
  protected $layoutSettings = [];   // Column widths, etc.
  protected $components = [];       // SectionComponent[], keyed by UUID
  protected $thirdPartySettings = [];
  
  public function __construct($layout_id, array $layout_settings = [], 
                              array $components = [], array $third_party_settings = []) {
    $this->layoutId = $layout_id;
    $this->layoutSettings = $layout_settings;
    foreach ($components as $component) {
      $this->setComponent($component);
    }
    $this->thirdPartySettings = $third_party_settings;
  }
}
```

### 3.2 Section Rendering

```php
public function toRenderArray(array $contexts = [], $in_preview = FALSE) {
  // Collect components into regions
  $regions = [];
  foreach ($this->getComponents() as $component) {
    if ($output = $component->toRenderArray($contexts, $in_preview)) {
      $regions[$component->getRegion()][$component->getUuid()] = $output;
    }
  }
  
  // Get layout plugin and set preview mode
  $layout = $this->getLayout($contexts);
  if ($layout instanceof PreviewAwarePluginInterface) {
    $layout->setInPreview($in_preview);
  }
  
  // Build the layout with populated regions
  $build = $layout->build($regions);
  
  // Attach entity context for theme layer
  if (!Element::isEmpty($build) && isset($contexts['layout_builder.entity'])) {
    $build['#entity'] = $contexts['layout_builder.entity']->getContextValue();
  }
  
  return $build;
}
```

### 3.3 Component Management

```php
// Get components in a region, sorted by weight
public function getComponentsByRegion($region) {
  $components = array_filter($this->getComponents(), function ($component) use ($region) {
    return $component->getRegion() === $region;
  });
  uasort($components, function ($a, $b) {
    return $a->getWeight() <=> $b->getWeight();
  });
  return $components;
}

// Insert after a specific component
public function insertAfterComponent($preceding_uuid, SectionComponent $component) {
  $uuids = array_keys($this->getComponentsByRegion($component->getRegion()));
  $delta = array_search($preceding_uuid, $uuids, TRUE);
  if ($delta === FALSE) {
    throw new \InvalidArgumentException("Invalid preceding UUID");
  }
  return $this->insertComponent($delta + 1, $component);
}

// Insert at specific position, reweighting subsequent components
public function insertComponent($delta, SectionComponent $new_component) {
  $components = $this->getComponentsByRegion($new_component->getRegion());
  if ($delta === count($components)) {
    return $this->appendComponent($new_component);
  }
  
  $weight = array_values($components)[$delta]->getWeight();
  $this->setComponent($new_component->setWeight($weight++));
  
  foreach (array_slice($components, $delta) as $component) {
    $component->setWeight($weight++);
  }
  return $this;
}
```

### 3.4 Serialization for Storage

```php
public function toArray() {
  return [
    'layout_id' => $this->getLayoutId(),
    'layout_settings' => $this->getLayoutSettings(),
    'components' => array_map(function (SectionComponent $component) {
      return $component->toArray();
    }, $this->getComponents()),
    'third_party_settings' => $this->thirdPartySettings,
  ];
}

public static function fromArray(array $section) {
  $section += [
    'layout_id' => '',
    'layout_settings' => [],
    'components' => [],
    'third_party_settings' => [],
  ];
  return new static(
    $section['layout_id'],
    $section['layout_settings'],
    array_map([SectionComponent::class, 'fromArray'], $section['components']),
    $section['third_party_settings']
  );
}
```

---

## 4. Form API Architecture

### 4.1 FormBuilder Core

From `core/lib/Drupal/Core/Form/FormBuilder.php`:

```php
class FormBuilder implements FormBuilderInterface, FormValidatorInterface, 
                            FormSubmitterInterface, FormCacheInterface {
  
  protected $moduleHandler;
  protected $eventDispatcher;
  protected $requestStack;
  protected $elementInfo;
  protected $csrfToken;
  protected $classResolver;
  protected $themeManager;
  protected $formValidator;
  protected $formSubmitter;
  protected $formCache;
}
```

### 4.2 Form Building Flow

```php
public function buildForm($form_arg, FormStateInterface &$form_state) {
  // 1. Get form ID and initialize form object
  $form_id = $this->getFormId($form_arg, $form_state);
  $request = $this->requestStack->getCurrentRequest();
  
  // 2. Set up user input
  $input = $form_state->getUserInput();
  if (!isset($input)) {
    $input = $form_state->isMethodType('get') 
      ? $request->query->all() 
      : $request->request->all();
    $form_state->setUserInput($input);
  }
  
  // 3. Check cache for existing form
  $check_cache = isset($input['form_id']) && $input['form_id'] == $form_id 
              && !empty($input['form_build_id']);
  if ($check_cache) {
    $form = $this->getCache($input['form_build_id'], $form_state);
  }
  
  // 4. If not cached, build fresh
  if (!isset($form)) {
    $form = $this->retrieveForm($form_id, $form_state);
    $this->prepareForm($form_id, $form, $form_state);
  }
  
  // 5. Process form (handle input, validate, submit)
  $response = $this->processForm($form_id, $form, $form_state);
  
  // 6. Handle AJAX
  if ($ajax_form_request && $form_state->isProcessingInput()) {
    throw new FormAjaxException($form, $form_state);
  }
  
  // 7. Handle response redirects
  if ($response instanceof Response) {
    throw new EnforcedResponseException($response);
  }
  
  return $form;
}
```

### 4.3 Form Retrieval

```php
public function retrieveForm($form_id, FormStateInterface &$form_state) {
  $form_state->addBuildInfo('form_id', $form_id);
  $args = $form_state->getBuildInfo()['args'];
  
  // Call the form object's buildForm method
  $callback = [$form_state->getFormObject(), 'buildForm'];
  
  $form = [];
  // Add default CSS class
  $form['#attributes']['class'][] = Html::getClass($form_id);
  
  // Build form
  $args = array_merge([$form, &$form_state], $args);
  $form = call_user_func_array($callback, $args);
  
  $form['#form_id'] = $form_id;
  return $form;
}
```

### 4.4 Form State Caching (Multi-Step)

```php
public function rebuildForm($form_id, FormStateInterface &$form_state, $old_form = NULL) {
  $form = $this->retrieveForm($form_id, $form_state);
  
  // POST forms use caching for multi-step
  if ($form_state->isMethodType('POST')) {
    $form_state->setCached();
  }
  
  // Preserve build ID for AJAX/partial rebuilds
  $rebuild_info = $form_state->getRebuildInfo();
  if (isset($old_form['#build_id']) && !empty($rebuild_info['copy']['#build_id'])) {
    $form['#build_id'] = $old_form['#build_id'];
  } else {
    if (isset($old_form['#build_id'])) {
      $form['#build_id_old'] = $old_form['#build_id'];
    }
    $form['#build_id'] = 'form-' . Crypt::randomBytesBase64();
  }
  
  $this->prepareForm($form_id, $form, $form_state);
  
  // Cache unprocessed form
  $unprocessed_form = $form;
  $form = $this->doBuildForm($form_id, $form, $form_state);
  
  if ($form_state->isCached()) {
    $this->setCache($form['#build_id'], $unprocessed_form, $form_state);
  }
  
  return $form;
}
```

---

## 5. Plugin System

### 5.1 DefaultPluginManager

From `core/lib/Drupal/Core/Plugin/DefaultPluginManager.php`:

```php
class DefaultPluginManager extends PluginManagerBase 
  implements PluginManagerInterface, CachedDiscoveryInterface, CacheableDependencyInterface {
  
  protected $alterHook;              // Hook name for alterations
  protected $cacheKey;               // Cache key for definitions
  protected $cacheTags = [];         // Cache tags
  protected $defaults = [];          // Default values for plugins
  protected $moduleHandler;          // For invoking hooks
  protected $namespaces;             // PSR-4 namespaces to scan
  protected $pluginDefinitionAttributeName;  // PHP 8 attribute class
  protected $pluginInterface;        // Required interface
  protected $subdir;                 // Subdirectory (e.g., "Plugin/Block")
}
```

### 5.2 Plugin Discovery

```php
protected function findDefinitions() {
  // Discover plugins in subdirectories
  $definitions = $this->getDiscovery()->getDefinitions();
  
  foreach ($definitions as $plugin_id => &$definition) {
    // Process each definition
    $this->processDefinition($definition, $plugin_id);
  }
  
  // Let modules alter the definitions
  $this->alterDefinitions($definitions);
  
  // Filter out plugins from missing providers
  return $this->providerFilterDecorator->getDefinitions();
}

protected function alterDefinitions(&$definitions) {
  if ($this->alterHook) {
    // Invokes hook_TYPE_alter() for all modules
    $this->moduleHandler->alterDeprecated(
      $this->alterHook . '_info',
      [$this->alterHook, $definitions]
    );
  }
}
```

### 5.3 Plugin Instantiation

```php
public function createInstance($plugin_id, array $configuration = []) {
  $plugin_definition = $this->getDefinition($plugin_id);
  $plugin_class = $plugin_definition['class'];
  
  // Use container-aware factory for dependency injection
  return $this->factory->createInstance($plugin_id, $configuration);
}
```

---

## 6. Patterns for CMS Core

### 6.1 Entity Architecture

**Current CMS Core:**
```js
// Single-level content types
content.registerType('article', {
  title: { type: 'string', required: true },
  body: { type: 'text' },
});
```

**Drupal-Inspired Improvement:**
```js
// Two-level: Entity Types + Bundles
const entityTypes = {
  node: {
    entityKeys: { id: 'id', uuid: 'uuid', bundle: 'type', label: 'title' },
    revisionable: true,
    translatable: true,
    baseFields: {
      title: { type: 'string', required: true },
      status: { type: 'boolean', default: true },
      created: { type: 'timestamp', computed: true },
      changed: { type: 'timestamp', computed: true },
    },
  },
  user: {
    entityKeys: { id: 'id', uuid: 'uuid', label: 'name' },
    baseFields: {
      name: { type: 'string', required: true },
      email: { type: 'email', required: true },
    },
  },
};

// Bundles add fields to entity types
const bundles = {
  'node.article': {
    entityType: 'node',
    fields: {
      body: { type: 'text_formatted' },
      tags: { type: 'entity_reference', target: 'taxonomy_term' },
    },
  },
};
```

### 6.2 Field Storage Separation

**Current:**
```js
// Fields defined inline with content type
{
  body: { type: 'text', required: false }
}
```

**Drupal-Inspired:**
```js
// Field Storage (global, reusable)
const fieldStorages = {
  'field_body': {
    type: 'text_with_summary',
    cardinality: 1,
    translatable: true,
  },
  'field_image': {
    type: 'image',
    cardinality: -1,  // Unlimited
    settings: { target_type: 'file' },
  },
};

// Field Instances (per-bundle)
const fieldInstances = {
  'node.article.field_body': {
    storage: 'field_body',
    label: 'Body',
    required: false,
    default: '',
  },
  'node.page.field_body': {
    storage: 'field_body',
    label: 'Content',
    required: true,
  },
};
```

### 6.3 Views-Like Query Builder

**Current:**
```js
content.list('article', { status: 'published' });
```

**Drupal-Inspired:**
```js
const view = createView({
  baseTable: 'node',
  bundle: 'article',
  
  fields: [
    { field: 'title', label: 'Title' },
    { field: 'created', label: 'Date', format: 'short' },
    { field: 'field_image', label: 'Image', format: 'thumbnail' },
  ],
  
  filters: [
    { field: 'status', value: true },
    { field: 'type', value: 'article' },
  ],
  
  sorts: [
    { field: 'created', direction: 'DESC' },
  ],
  
  pager: { type: 'mini', itemsPerPage: 10 },
  
  displays: {
    page: { path: '/articles', title: 'Articles' },
    block: { name: 'Recent Articles', limit: 5 },
    feed: { path: '/articles.rss', format: 'rss' },
  },
});
```

### 6.4 Layout Builder Integration

**Current:**
```js
// Simple region-based layouts
const layout = { header: [], content: [], sidebar: [] };
```

**Drupal-Inspired:**
```js
const layout = {
  sections: [
    {
      layoutId: 'two_column',
      layoutSettings: { columnWidths: '67-33' },
      components: [
        {
          uuid: 'abc123',
          region: 'first',
          weight: 0,
          configuration: {
            pluginId: 'field_block:node:article:body',
            label: 'Body',
            labelDisplay: 'visible',
          },
        },
        {
          uuid: 'def456',
          region: 'second',
          weight: 0,
          configuration: {
            pluginId: 'views_block:related_articles',
            itemsPerPage: 3,
          },
        },
      ],
    },
  ],
};
```

### 6.5 Form API Simplification

**Drupal (PHP arrays):**
```php
$form['title'] = [
  '#type' => 'textfield',
  '#title' => $this->t('Title'),
  '#required' => TRUE,
];
```

**CMS Core (keep simple, add structure):**
```js
const form = defineForm({
  id: 'article_form',
  
  elements: {
    title: {
      type: 'textfield',
      label: 'Title',
      required: true,
      validation: ['notEmpty', 'maxLength:255'],
    },
    body: {
      type: 'textarea',
      label: 'Body',
      format: 'full_html',
    },
    actions: {
      type: 'actions',
      children: {
        submit: { type: 'submit', label: 'Save' },
        preview: { type: 'submit', label: 'Preview', validate: false },
      },
    },
  },
  
  handlers: {
    validate: (values, form) => { ... },
    submit: async (values, form) => { ... },
  },
});
```

---

## 7. Implementation Priorities

### High Priority (Architecture)
1. **Entity/Bundle Separation** - Foundation for everything else
2. **Two-Level Fields** - Enables field reuse and cleaner storage
3. **Display Modes** - full, teaser, card, search_result

### Medium Priority (Features)
4. **Views-Style Query Builder** - Declarative content queries
5. **Config Export/Import** - YAML-based deployment workflow
6. **Plugin Discovery** - Directory-based with manifests

### Lower Priority (Polish)
7. **Layout Builder Sections** - Already have regions, enhance
8. **Form State Machine** - Multi-step form support
9. **Revision UI** - Already have revisions, add comparison

---

## Session Log
- 2026-02-07 11:51: Fetched ContentEntityBase.php (25KB)
- 2026-02-07 11:51: Fetched FieldStorageConfig.php (20KB)
- 2026-02-07 11:52: Fetched ViewExecutable.php (30KB)
- 2026-02-07 11:52: Fetched Section.php (12KB)
- 2026-02-07 11:52: Fetched FormBuilder.php (25KB)
- 2026-02-07 11:53: Compiled analysis with code examples
