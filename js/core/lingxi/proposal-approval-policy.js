const MAX_AUTOMATIC_DIFFS = 2;
const AUTOMATIC_DIFF_OPERATIONS = new Set(['add', 'replace']);

const SIMPLE_TOOLS = new Set([
  'apply_variable_patch',
  'apply_ui_settings',
  'apply_story_direction'
]);

const SAFE_WORLDBOOK_ACTIONS = new Set([
  'upsert',
  'enable',
  'disable',
  'enable_all',
  'disable_all'
]);

const SAFE_IMAGE_LIBRARY_ACTIONS = new Set(['select', 'detach', 'protect', 'unprotect']);
const SAFE_EQUIPMENT_ACTIONS = new Set(['equip', 'unequip']);

function decision(mode, reason, diffCount) {
  return Object.freeze({ mode, reason, diffCount });
}

export function classifyProposalApproval(proposal = {}) {
  const diff = Array.isArray(proposal?.diff) ? proposal.diff : [];
  if (diff.length < 1 || diff.length > MAX_AUTOMATIC_DIFFS) {
    return decision('confirm', 'change-count', diff.length);
  }
  if (diff.some(entry => (
    !entry
    || typeof entry.path !== 'string'
    || !entry.path.startsWith('/')
    || !AUTOMATIC_DIFF_OPERATIONS.has(String(entry.operation || ''))
  ))) {
    return decision('confirm', 'destructive-or-unknown-diff', diff.length);
  }

  const tool = String(proposal?.tool || '');
  const params = proposal?.params && typeof proposal.params === 'object' ? proposal.params : {};
  if (SIMPLE_TOOLS.has(tool)) return decision('automatic', 'small-reversible-change', diff.length);
  if (tool === 'save_or_start_opening') {
    return params.mode === 'save'
      ? decision('automatic', 'save-opening-draft', diff.length)
      : decision('confirm', 'start-opening', diff.length);
  }
  if (tool === 'upsert_worldbook_entry') {
    return SAFE_WORLDBOOK_ACTIONS.has(String(params.action || ''))
      ? decision('automatic', 'small-worldbook-change', diff.length)
      : decision('confirm', 'destructive-worldbook-change', diff.length);
  }
  if (tool === 'manage_image_library') {
    return SAFE_IMAGE_LIBRARY_ACTIONS.has(String(params.action || ''))
      ? decision('automatic', 'reversible-image-selection', diff.length)
      : decision('confirm', 'external-or-destructive-image-action', diff.length);
  }
  if (tool === 'perform_equipment_action') {
    return SAFE_EQUIPMENT_ACTIONS.has(String(params.action || ''))
      ? decision('automatic', 'reversible-equipment-change', diff.length)
      : decision('confirm', 'consumptive-equipment-action', diff.length);
  }
  return decision('confirm', 'tool-requires-confirmation', diff.length);
}

export function canApplyProposalAutomatically(proposal) {
  return classifyProposalApproval(proposal).mode === 'automatic';
}

export default classifyProposalApproval;
