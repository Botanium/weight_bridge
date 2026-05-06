from weight_bridge.install import ensure_roles_and_permissions, seed_master_data


def execute():
	seed_master_data()
	ensure_roles_and_permissions()
