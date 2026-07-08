/** Friendly display labels for registry action slugs — the system-triggered
 *  actions (api/action_registry.py) that aren't in the user-editable
 *  catalog. Catalog types resolve their label from EventTypeDef instead. */

export const REGISTRY_TYPE_LABELS: Record<string, string> = {
  "service.validate": "Validation",
  "gateway.validate": "Validation",
  "cell.validate": "Validation",
  "site.validate": "Validation",
  "site.status": "Site status",
  "site.fpcon": "FPCON change",
  "site.emcon": "EMCON change",
  "personnel.checkin": "Sign-in",
}
