/**
 * Default org role permissions matching frontend RolePermissionMatrix PRESET_PERMISSIONS.
 * Modules and actions aligned with zentag-frontend RolePermissionMatrix.
 */
const MODULES = [
  'Dashboard',
  'Streams / Live',
  'Clips',
  'Highlights',
  'Folders',
  'Published',
  'Assets',
  'Tags',
  'Templates',
  'Settings',
  'Teams',
  'Competitions',
  'Users',
  'Roles & Permissions',
];

const ACTIONS = ['view', 'create', 'edit', 'delete'];
const VIEW_ONLY_MODULES = ['Dashboard'];

const emptyPermissions = () => {
  const p = {};
  MODULES.forEach((mod) => {
    p[mod] = {};
    ACTIONS.forEach((a) => { p[mod][a] = false; });
  });
  return p;
};

export const PRESET_PERMISSIONS = {
  'Org Admin': (() => {
    const p = emptyPermissions();
    MODULES.forEach((m) => {
      p[m].view = true;
      if (!VIEW_ONLY_MODULES.includes(m)) {
        p[m].create = true;
        p[m].edit = true;
        p[m].delete = true;
      }
    });
    return p;
  })(),
  Manager: (() => {
    const p = emptyPermissions();
    MODULES.forEach((m) => {
      p[m].view = true;
      if (
        !VIEW_ONLY_MODULES.includes(m) &&
        m !== 'Users' &&
        m !== 'Roles & Permissions'
      ) {
        p[m].create = true;
        p[m].edit = true;
        p[m].delete = true;
      }
    });
    return p;
  })(),
  Editor: (() => {
    const p = emptyPermissions();
    const editorModules = [
      'Streams / Live',
      'Clips',
      'Highlights',
      'Folders',
      'Published',
      'Assets',
      'Tags',
      'Templates',
    ];
    MODULES.forEach((m) => {
      p[m].view = true;
      if (editorModules.includes(m)) {
        p[m].create = true;
        p[m].edit = true;
      }
    });
    return p;
  })(),
  Viewer: (() => {
    const p = emptyPermissions();
    MODULES.forEach((m) => {
      p[m].view = true;
    });
    return p;
  })(),
};

export const DEFAULT_ROLE_NAMES = ['Org Admin', 'Manager', 'Editor', 'Viewer'];
