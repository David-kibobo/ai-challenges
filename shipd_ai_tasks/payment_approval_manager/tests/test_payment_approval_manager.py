import unittest


# Tests target the public API of PaymentApprovalManager in `payment_approval_manager/manager.py`.

from payment_approval_manager.manager import PaymentApprovalManager
from datetime import datetime, timedelta, timezone

class TestPaymentApprovalManager(unittest.TestCase):
    def setUp(self):
        # Group-aware roles; also keep legacy top-level 'role' to remain compatible
        self.group_id = "group_1"
        self.users = {
            "member_1": {"id": "member_1", "role": "member", "roles": {self.group_id: "member"}},
            "member_2": {"id": "member_2", "role": "member", "roles": {self.group_id: "member"}},
            "sec_gen": {"id": "sec_gen", "role": "sec_gen", "roles": {self.group_id: "sec_gen"}},
            "treasurer": {"id": "treasurer", "role": "treasurer", "roles": {self.group_id: "treasurer"}},
        }

        # Controllable clock for tests
        self.now = datetime(2025, 1, 1, 12, 0, 0, tzinfo=timezone.utc)

        def clock():
            return self.now

        self.policies = {self.group_id: {"sequential": False}}
        self.manager = PaymentApprovalManager(users=self.users, group_policies=self.policies, clock=clock)

    def _create_pending_payment(self):
        return self.manager.create_payment(member_id="member_1", group_id=self.group_id)

    def test_new_payment_starts_pending(self):
        pending_payment = self._create_pending_payment()
        self.assertEqual(pending_payment["status"], "pending")
        self.assertEqual(pending_payment["signatures"], [])

    def test_approval_flow_treasurer_then_sec_gen(self):
        pending_payment = self._create_pending_payment()
        pid = pending_payment["id"]

        updated = self.manager.approve(payment_id=pid, approver_id="treasurer")
        self.assertEqual(updated["status"], "pending")
        self.assertEqual({sig["role"] for sig in updated["signatures"]}, {"treasurer"})

        updated = self.manager.approve(payment_id=pid, approver_id="sec_gen")
        self.assertEqual(updated["status"], "approved")
        self.assertEqual({sig["role"] for sig in updated["signatures"]}, {"treasurer", "sec_gen"})

    def test_approval_flow_sec_gen_then_treasurer(self):
        pending_payment = self._create_pending_payment()
        pid = pending_payment["id"]

        updated = self.manager.approve(payment_id=pid, approver_id="sec_gen")
        self.assertEqual(updated["status"], "pending")
        self.assertEqual({sig["role"] for sig in updated["signatures"]}, {"sec_gen"})

        updated = self.manager.approve(payment_id=pid, approver_id="treasurer")
        self.assertEqual(updated["status"], "approved")
        self.assertEqual({sig["role"] for sig in updated["signatures"]}, {"treasurer", "sec_gen"})

    def test_duplicate_approval_has_no_effect(self):
        pending_payment = self._create_pending_payment()
        pid = pending_payment["id"]

        self.manager.approve(payment_id=pid, approver_id="treasurer")
        updated = self.manager.approve(payment_id=pid, approver_id="treasurer")
        self.assertEqual(updated["status"], "pending")
        roles = [sig["role"] for sig in updated["signatures"]]
        self.assertEqual(roles.count("treasurer"), 1)

    def test_two_of_same_role_does_not_approve(self):
        pending_payment = self._create_pending_payment()
        pid = pending_payment["id"]

        self.manager.approve(payment_id=pid, approver_id="treasurer")

        another_treasurer = {"id": "treasurer_2", "role": "treasurer"}
        self.users[another_treasurer["id"]] = {**another_treasurer, "roles": {self.group_id: "treasurer"}}

        updated = self.manager.approve(payment_id=pid, approver_id="treasurer_2")
        self.assertEqual(updated["status"], "pending")
        roles = [sig["role"] for sig in updated["signatures"]]
        self.assertEqual(roles.count("treasurer"), 1)

    def test_unauthorized_user_cannot_approve(self):
        pending_payment = self._create_pending_payment()
        pid = pending_payment["id"]
        with self.assertRaises(PermissionError):
            self.manager.approve(payment_id=pid, approver_id="member_1")

    def test_reject_by_treasurer_moves_to_rejected(self):
        pending_payment = self._create_pending_payment()
        pid = pending_payment["id"]
        reason = "Suspicious deposit"
        updated = self.manager.reject(payment_id=pid, approver_id="treasurer", reason=reason)
        self.assertEqual(updated["status"], "rejected")
        self.assertEqual(updated.get("rejection_reason"), reason)

    def test_reject_by_sec_gen_moves_to_rejected(self):
        pending_payment = self._create_pending_payment()
        pid = pending_payment["id"]
        reason = "Documentation missing"
        updated = self.manager.reject(payment_id=pid, approver_id="sec_gen", reason=reason)
        self.assertEqual(updated["status"], "rejected")
        self.assertEqual(updated.get("rejection_reason"), reason)

    def test_cannot_approve_after_rejected(self):
        pending_payment = self._create_pending_payment()
        pid = pending_payment["id"]
        self.manager.reject(payment_id=pid, approver_id="treasurer", reason="Invalid")
        with self.assertRaises(ValueError):
            self.manager.approve(payment_id=pid, approver_id="sec_gen")

    def test_signatures_tracked_with_user_and_role(self):
        pending_payment = self._create_pending_payment()
        pid = pending_payment["id"]
        updated = self.manager.approve(payment_id=pid, approver_id="sec_gen")
        self.assertEqual(updated["signatures"][0]["user_id"], "sec_gen")
        self.assertEqual(updated["signatures"][0]["role"], "sec_gen")

    def test_get_payment_and_list_payments(self):
        pending_payment = self._create_pending_payment()
        pid = pending_payment["id"]
        fetched = self.manager.get_payment(payment_id=pid)
        self.assertEqual(fetched["id"], pid)
        all_payments = self.manager.list_payments()
        self.assertTrue(any(p["id"] == pid for p in all_payments))

    def test_role_validation_is_group_scoped(self):
        pending_payment = self.manager.create_payment(member_id="member_1", group_id="other_group")
        pid = pending_payment["id"]
        with self.assertRaises(PermissionError):
            self.manager.approve(payment_id=pid, approver_id="treasurer")

    def test_approval_window_expiration_marks_expired(self):
        p = self._create_pending_payment()
        pid = p["id"]
        self.manager.approve(payment_id=pid, approver_id="treasurer")

        # Advance time beyond 48h
        self.now += timedelta(hours=49)
        updated = self.manager.enforce_approval_window(payment_id=pid)
        self.assertEqual(updated["status"], "expired")

    def test_sequential_policy_enforces_order(self):
        # Enable sequential: treasurer must approve first
        self.manager.set_group_policy(self.group_id, sequential=True)
        p = self._create_pending_payment()
        pid = p["id"]

        # Out-of-order: sec_gen first should be ignored
        updated = self.manager.approve(payment_id=pid, approver_id="sec_gen")
        self.assertEqual(updated["status"], "pending")
        self.assertEqual(len(updated["signatures"]), 0)

        # Now treasurer approves then sec_gen
        self.manager.approve(payment_id=pid, approver_id="treasurer")
        updated = self.manager.approve(payment_id=pid, approver_id="sec_gen")
        self.assertEqual(updated["status"], "approved")

    def test_revocation_before_second_signature(self):
        p = self._create_pending_payment()
        pid = p["id"]
        self.manager.approve(payment_id=pid, approver_id="treasurer")

        # Treasurer revokes before second signature
        updated = self.manager.revoke(payment_id=pid, approver_id="treasurer")
        self.assertEqual(updated["status"], "pending")
        self.assertEqual(len(updated["signatures"]), 0)

    def test_cannot_revoke_after_finalization(self):
        p = self._create_pending_payment()
        pid = p["id"]
        self.manager.approve(payment_id=pid, approver_id="treasurer")
        self.manager.approve(payment_id=pid, approver_id="sec_gen")
        with self.assertRaises(ValueError):
            self.manager.revoke(payment_id=pid, approver_id="treasurer")

        # Reject path
        p = self._create_pending_payment()
        pid = p["id"]
        self.manager.reject(payment_id=pid, approver_id="treasurer", reason="x")
        with self.assertRaises(ValueError):
            self.manager.revoke(payment_id=pid, approver_id="treasurer")

    def test_audit_trail_records_actions_and_is_immutable(self):
        p = self._create_pending_payment()
        pid = p["id"]
        self.manager.approve(payment_id=pid, approver_id="treasurer")
        self.manager.reject(payment_id=pid, approver_id="sec_gen", reason="bad")
        trail = self.manager.get_audit_trail(payment_id=pid)
        self.assertGreaterEqual(len(trail), 2)
        # Attempt to mutate returned trail must not affect internal state
        trail[0]["action"] = "tampered"
        trail2 = self.manager.get_audit_trail(payment_id=pid)
        self.assertNotEqual(trail2[0]["action"], "tampered")

    def test_errors_for_unknown_payment_and_user(self):
        with self.assertRaises(KeyError):
            self.manager.get_payment(payment_id="missing")
        p = self._create_pending_payment()
        pid = p["id"]
        with self.assertRaises(KeyError):
            self.manager.approve(payment_id=pid, approver_id="unknown_user")

    def test_enforce_window_no_change_within_48h_and_on_final_states(self):
        p = self._create_pending_payment()
        pid = p["id"]
        # within window: no change
        self.now += timedelta(hours=12)
        updated = self.manager.enforce_approval_window(payment_id=pid)
        self.assertEqual(updated["status"], "pending")

        # Approved payments unaffected
        self.manager.approve(payment_id=pid, approver_id="treasurer")
        self.manager.approve(payment_id=pid, approver_id="sec_gen")
        self.now += timedelta(hours=100)
        updated = self.manager.enforce_approval_window(payment_id=pid)
        self.assertEqual(updated["status"], "approved")

        # Rejected payments unaffected
        p = self._create_pending_payment()
        pid = p["id"]
        self.manager.reject(payment_id=pid, approver_id="treasurer", reason="x")
        self.now += timedelta(hours=100)
        updated = self.manager.enforce_approval_window(payment_id=pid)
        self.assertEqual(updated["status"], "rejected")

    def test_revoke_errors_when_no_prior_approval(self):
        p = self._create_pending_payment()
        pid = p["id"]
        with self.assertRaises(ValueError):
            self.manager.revoke(payment_id=pid, approver_id="treasurer")

    def test_actions_disallowed_after_expired(self):
        p = self._create_pending_payment()
        pid = p["id"]
        self.manager.approve(payment_id=pid, approver_id="treasurer")
        self.now += timedelta(hours=49)
        self.manager.enforce_approval_window(payment_id=pid)
        with self.assertRaises(ValueError):
            self.manager.approve(payment_id=pid, approver_id="sec_gen")
        with self.assertRaises(ValueError):
            self.manager.reject(payment_id=pid, approver_id="sec_gen", reason="late")
        with self.assertRaises(ValueError):
            self.manager.revoke(payment_id=pid, approver_id="treasurer")


if __name__ == "__main__":
    unittest.main()


