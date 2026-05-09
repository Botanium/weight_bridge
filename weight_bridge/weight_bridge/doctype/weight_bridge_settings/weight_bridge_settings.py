import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt


class WeightBridgeSettings(Document):
	def validate(self):
		for fieldname in (
			"min_first_weight_kg",
			"min_second_weight_kg",
			"min_net_weight_kg",
			"max_gross_weight_kg",
			"max_net_weight_kg",
		):
			if flt(self.get(fieldname)) < 0:
				frappe.throw(_("{0} cannot be negative.").format(self.meta.get_label(fieldname)))
