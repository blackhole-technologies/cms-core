/**
 * Test module for verifying entity type registration via hook_entity_type_info
 */

/**
 * Implements hook_entity_type_info
 *
 * Registers a test entity type to verify the entity discovery system works.
 */
export function hook_entity_type_info() {
  return {
    test_node: {
      label: 'Test Node',
      label_plural: 'Test Nodes',
      base_table: 'test_nodes',
      entity_keys: {
        id: 'nid',
        uuid: 'uuid',
        label: 'title',
      },
      handlers: {
        storage: 'Drupal\\Core\\Entity\\Sql\\SqlContentEntityStorage',
      },
    },
  };
}
