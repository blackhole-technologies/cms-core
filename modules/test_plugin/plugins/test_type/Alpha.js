/**
 * Test plugin for Feature #7 verification.
 */

export const definition = {
  id: 'alpha',
  label: 'Alpha Plugin',
  description: 'Test plugin for PluginManager.getDefinitions()',
};

export default function create(configuration, pluginId, definition, services) {
  return {
    test() {
      return 'alpha works';
    },
  };
}
