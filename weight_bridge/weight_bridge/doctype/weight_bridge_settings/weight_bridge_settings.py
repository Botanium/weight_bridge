import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, flt


class WeightBridgeSettings(Document):
	def validate(self):
		for fieldname in (
			"min_first_weight_kg",
			"min_second_weight_kg",
			"min_net_weight_kg",
			"max_gross_weight_kg",
			"max_net_weight_kg",
			"stability_tolerance_kg",
		):
			if flt(self.get(fieldname)) < 0:
				frappe.throw(_("{0} cannot be negative.").format(self.meta.get_label(fieldname)))

		if cint(self.serial_baud_rate) <= 0:
			frappe.throw(_("Serial Baud Rate must be greater than zero."))

		if cint(self.stable_reading_count) <= 0:
			frappe.throw(_("Stable Reading Count must be greater than zero."))

		if self.stable_status_codes:
			codes = [code.strip().upper() for code in self.stable_status_codes.replace(",", " ").split() if code.strip()]
			self.stable_status_codes = " ".join(codes)
