import frappe


WEIGHT_BRIDGE_ITEM_GROUP = "Weight Bridge Cargo"
WEIGHT_BRIDGE_ITEMS = (
	("VR", "VR"),
	("Bitumen 40/50", "Bitumen 40/50"),
	("Bitumen 60/70", "Bitumen 60/70"),
)
WEIGHT_BRIDGE_ROLES = ("Weight Bridge Operator", "Weight Bridge Supervisor")
WEIGHT_BRIDGE_TICKET = "Weight Bridge Ticket"


def after_install():
	seed_master_data()
	ensure_roles_and_permissions()


def before_tests():
	seed_master_data()
	ensure_roles_and_permissions()


def seed_master_data():
	ensure_uom()
	ensure_item_group()
	for item_code, item_name in WEIGHT_BRIDGE_ITEMS:
		ensure_item(item_code, item_name)


def ensure_uom():
	if frappe.db.exists("UOM", "Kg"):
		return

	frappe.get_doc(
		{
			"doctype": "UOM",
			"uom_name": "Kg",
			"enabled": 1,
		}
	).insert(ignore_permissions=True)


def ensure_item_group():
	if frappe.db.exists("Item Group", WEIGHT_BRIDGE_ITEM_GROUP):
		return

	frappe.get_doc(
		{
			"doctype": "Item Group",
			"item_group_name": WEIGHT_BRIDGE_ITEM_GROUP,
			"parent_item_group": "All Item Groups",
			"is_group": 0,
		}
	).insert(ignore_permissions=True)


def ensure_item(item_code, item_name):
	if frappe.db.exists("Item", item_code):
		item = frappe.get_doc("Item", item_code)
		changed = False
		if item.disabled:
			item.disabled = 0
			changed = True
		if item.item_group != WEIGHT_BRIDGE_ITEM_GROUP:
			item.item_group = WEIGHT_BRIDGE_ITEM_GROUP
			changed = True
		if changed:
			item.save(ignore_permissions=True)
		return

	frappe.get_doc(
		{
			"doctype": "Item",
			"item_code": item_code,
			"item_name": item_name,
			"item_group": WEIGHT_BRIDGE_ITEM_GROUP,
			"stock_uom": "Kg",
			"is_stock_item": 1,
			"include_item_in_manufacturing": 1,
			"disabled": 0,
		}
	).insert(ignore_permissions=True)


def ensure_roles_and_permissions():
	for role in WEIGHT_BRIDGE_ROLES:
		ensure_role(role)

	if not frappe.db.exists("DocType", WEIGHT_BRIDGE_TICKET):
		return

	ensure_custom_permission(
		"Weight Bridge Operator",
		{
			"read": 1,
			"write": 1,
			"create": 1,
			"email": 1,
			"print": 1,
			"report": 1,
			"share": 1,
		},
	)
	ensure_custom_permission(
		"Weight Bridge Supervisor",
		{
			"read": 1,
			"write": 1,
			"create": 1,
			"email": 1,
			"print": 1,
			"report": 1,
			"share": 1,
			"submit": 1,
			"cancel": 1,
			"amend": 1,
		},
	)
	frappe.clear_cache(doctype=WEIGHT_BRIDGE_TICKET)


def ensure_role(role_name):
	if frappe.db.exists("Role", role_name):
		return

	frappe.get_doc(
		{
			"doctype": "Role",
			"role_name": role_name,
			"desk_access": 1,
		}
	).insert(ignore_permissions=True)


def ensure_custom_permission(role, flags):
	from frappe.permissions import setup_custom_perms

	setup_custom_perms(WEIGHT_BRIDGE_TICKET)
	name = frappe.db.get_value(
		"Custom DocPerm",
		{
			"parent": WEIGHT_BRIDGE_TICKET,
			"role": role,
			"permlevel": 0,
			"if_owner": 0,
		},
	)

	if name:
		docperm = frappe.get_doc("Custom DocPerm", name)
	else:
		docperm = frappe.get_doc(
			{
				"doctype": "Custom DocPerm",
				"parent": WEIGHT_BRIDGE_TICKET,
				"parenttype": "DocType",
				"parentfield": "permissions",
				"role": role,
				"permlevel": 0,
				"if_owner": 0,
			}
		)

	for field in (
		"read",
		"write",
		"create",
		"delete",
		"submit",
		"cancel",
		"amend",
		"report",
		"export",
		"import",
		"share",
		"print",
		"email",
	):
		docperm.set(field, flags.get(field, 0))

	if docperm.is_new():
		docperm.insert(ignore_permissions=True)
	else:
		docperm.save(ignore_permissions=True)
