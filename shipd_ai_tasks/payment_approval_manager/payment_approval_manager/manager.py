from typing import Dict, List, Optional, TypedDict
from copy import deepcopy
from datetime import datetime, timedelta, timezone


class User(TypedDict, total=False):
    id: str
    role: str  # legacy/global role if present
    roles: Dict[str, str]  # group_id -> role


class Signature(TypedDict, total=False):
    user_id: str
    role: str
    timestamp: str  # ISO timestamp of approval


class Payment(TypedDict, total=False):
    id: str
    member_id: str
    group_id: str
    status: str  # "pending" | "approved" | "rejected" | "expired"
    signatures: List[Signature]
    rejection_reason: str
    created_at: str  # ISO timestamp
    policy: Dict[str, bool]


class PaymentApprovalManager:
    def __init__(self, users: Dict[str, User], group_policies: Optional[Dict[str, Dict[str, bool]]] = None, clock: Optional[callable] = None):
        self._users: Dict[str, User] = users
        self._payments: Dict[str, Payment] = {}
        self._approvals: Dict[str, Dict[str, Signature]] = {}
        self._audit: Dict[str, List[Dict[str, str]]] = {}
        self._group_policies: Dict[str, Dict[str, bool]] = group_policies or {}
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self._id_counter: int = 0

    # Public API expected by tests
    def create_payment(self, member_id: str, group_id: str) -> Payment:
        payment_id = self._generate_payment_id()
        created_at = self._clock().isoformat()
        policy = deepcopy(self._group_policies.get(group_id, {"sequential": False}))
        payment: Payment = {
            "id": payment_id,
            "member_id": member_id,
            "group_id": group_id,
            "status": "pending",
            "signatures": [],
            "created_at": created_at,
            "policy": policy,
        }
        self._payments[payment_id] = payment
        self._approvals[payment_id] = {}
        self._audit[payment_id] = []
        return payment.copy()

    def approve(self, payment_id: str, approver_id: str) -> Payment:
        payment = self._get_payment_or_raise(payment_id)
        self._ensure_payment_actionable(payment)

        user = self._get_user_or_raise(approver_id)
        role = self._get_user_role_in_group(user, payment["group_id"])  # may raise
        if role not in {"sec_gen", "treasurer"}:
            raise PermissionError("Only Secretary General and Treasurer can approve")

        existing = self._approvals[payment_id]

        # If this exact user already signed, no-op
        if approver_id in existing:
            return payment.copy()

        # Prevent multiple signatures for the same role; keep first signature per role
        if any(sig["role"] == role for sig in existing.values()):
            # no-op: another user with same role attempted; keep status/signatures unchanged
            return payment.copy()

        # Enforce sequential policy if enabled
        if payment.get("policy", {}).get("sequential", False):
            roles_present = {sig["role"] for sig in existing.values()}
            # First must be treasurer
            if not roles_present and role != "treasurer":
                return payment.copy()
            # Second must be sec_gen
            if roles_present == {"treasurer"} and role != "sec_gen":
                return payment.copy()

        now_iso = self._clock().isoformat()
        sig: Signature = {"user_id": approver_id, "role": role, "timestamp": now_iso}
        existing[approver_id] = sig
        payment["signatures"].append(sig)
        self._append_audit(payment_id, approver_id, role, "approved")

        if self._has_required_dual_signatures(existing):
            payment["status"] = "approved"

        return payment.copy()

    def reject(self, payment_id: str, approver_id: str, reason: Optional[str] = None) -> Payment:
        payment = self._get_payment_or_raise(payment_id)
        self._ensure_payment_actionable(payment)

        user = self._get_user_or_raise(approver_id)
        role = self._get_user_role_in_group(user, payment["group_id"])  # may raise
        if role not in {"sec_gen", "treasurer"}:
            raise PermissionError("Only Secretary General and Treasurer can reject")

        payment["status"] = "rejected"
        if reason:
            payment["rejection_reason"] = reason
        self._append_audit(payment_id, approver_id, role, "rejected")
        return payment.copy()

    def revoke(self, payment_id: str, approver_id: str) -> Payment:
        payment = self._get_payment_or_raise(payment_id)
        # Only allow revoke while pending
        if payment["status"] != "pending":
            raise ValueError("Cannot revoke after finalization")

        existing = self._approvals[payment_id]
        if approver_id not in existing:
            raise ValueError("No approval by this user to revoke")

        # Only allow revoke before second signature
        if len(existing) > 1:
            raise ValueError("Cannot revoke after second approval")

        sig = existing.pop(approver_id)
        # Remove from signatures list
        payment["signatures"] = [s for s in payment["signatures"] if s["user_id"] != approver_id]
        # Ensure status remains pending
        payment["status"] = "pending"
        self._append_audit(payment_id, approver_id, sig["role"], "revoked")
        return payment.copy()

    def get_payment(self, payment_id: str) -> Payment:
        return self._get_payment_or_raise(payment_id).copy()

    def list_payments(self) -> List[Payment]:
        return [p.copy() for p in self._payments.values()]

    def get_audit_trail(self, payment_id: str) -> List[Dict[str, str]]:
        # return deep copy for immutability guarantee
        return deepcopy(self._audit.get(payment_id, []))

    def set_group_policy(self, group_id: str, sequential: bool) -> None:
        self._group_policies.setdefault(group_id, {})["sequential"] = sequential

    # Internals
    def _generate_payment_id(self) -> str:
        self._id_counter += 1
        return f"pay_{self._id_counter}"

    def _get_payment_or_raise(self, payment_id: str) -> Payment:
        if payment_id not in self._payments:
            raise KeyError(f"Payment {payment_id} not found")
        return self._payments[payment_id]

    def _get_user_or_raise(self, user_id: str) -> User:
        if user_id not in self._users:
            raise KeyError(f"User {user_id} not found")
        return self._users[user_id]

    def _get_user_role_in_group(self, user: User, group_id: str) -> str:
        # If user defines group-scoped roles, enforce presence in this group
        if "roles" in user:
            roles_map = user.get("roles", {})
            if group_id in roles_map:
                return roles_map[group_id]
            raise PermissionError("User has no role in this group")
        # Backward compatibility: use legacy global role if no roles map exists
        if "role" in user:
            return user["role"]
        raise PermissionError("User has no role in this group")

    def _ensure_payment_actionable(self, payment: Payment) -> None:
        if payment["status"] == "rejected":
            raise ValueError("Cannot act on a rejected payment")
        if payment["status"] == "approved":
            # No further changes to approved payments in this simple workflow
            raise ValueError("Payment already approved")
        if payment["status"] == "expired":
            raise ValueError("Cannot act on an expired payment")

    def enforce_approval_window(self, payment_id: str) -> Payment:
        payment = self._get_payment_or_raise(payment_id)
        if payment["status"] in {"approved", "rejected", "expired"}:
            return payment.copy()
        created = datetime.fromisoformat(payment["created_at"])
        if self._clock() - created > timedelta(hours=48):
            # If not fully approved within window, mark expired
            if len(payment.get("signatures", [])) < 2:
                payment["status"] = "expired"
        return payment.copy()

    def _has_required_dual_signatures(self, existing: Dict[str, Signature]) -> bool:
        roles = {sig["role"] for sig in existing.values()}
        return roles == {"sec_gen", "treasurer"}

    def _append_audit(self, payment_id: str, user_id: str, role: str, action: str) -> None:
        now_iso = self._clock().isoformat()
        entry = {"user_id": user_id, "role": role, "timestamp": now_iso, "action": action}
        self._audit.setdefault(payment_id, []).append(entry)


