Background
You are the Lead Backend Developer tasked with upgrading a strategic project for a neighborhood SACCO, a savings and credit society. Their current system is subpar, and they need a robust solution right away. Your new assignment is to design a **payment approval module** that enforces strict multi-signatory rules before any funds can be distributed. This is a critical part of the SACCO’s governance and accountability framework.

The challenge is not only to validate who can approve, but also to handle complex real-world scenarios like approval ordering, expiry windows, and revocations. The approval stage is a mandatory gateway before transactions enter the distribution logic (distribution is a future task and not part of this module).

Objective
Your goal is to build a Python module that manages the approval of member payment transactions. This module must ensure approvals are trustworthy, enforce SACCO governance rules, and keep a secure audit trail of every action. It should be scalable, testable, and ready to integrate into a FastAPI + SQLAlchemy backend.

System Rules
1. Two-Signatory Requirement
   - A payment must be approved by **two distinct signatories**: the Secretary General and the Treasurer.
   - Duplicate approvals from the same role must not be accepted.
   - If either signatory rejects the payment, the transaction is marked as `rejected`.

2. Role Validation
   - Before approval, the system must confirm that the user holds the correct role (Treasurer or Secretary General) within the correct SACCO group.
   - A user may belong to multiple groups, and the approval must be checked against the payment’s group context.

3. Approval Window
   - Approvals must be completed within **48 hours** of the payment being created.
   - If only one approval is received and the other is missing after 48 hours, the transaction should automatically revert to `pending` or be marked `expired`.

4. Sequential Approval (Policy Setting)
   - Some groups require approvals in a strict order:
     - Treasurer must approve first, then Secretary General.
   - If an approval comes out of order, it should be ignored, and the status must remain unchanged.

5. Revocation
   - A signatory may revoke their approval **before** the second signatory has acted.
   - Once revoked, the payment status must return to `pending` and the audit trail should capture the revocation.

6. Audit Trail
   - Every approval, rejection, and revocation must be recorded with:
     - Approver ID
     - Role
     - Timestamp
     - Action (`approved`, `rejected`, `revoked`)
   - Audit trail entries must be immutable once written.

7. Finalization
   - A transaction may only be marked as `approved` if:
     - Both required signatories have approved within the 48-hour window.
     - Approvals were made in the correct order (if sequential policy is enforced).
   - Approved transactions are then eligible for the **distribution module** (to be implemented later).

Constraints
- Do not implement contribution distribution logic in this task. Your work stops at ensuring a payment is properly approved, rejected, revoked, or expired.
- The system should operate in memory (using Python dicts and lists) to simplify this stage. Later it will be backed by FastAPI + SQLAlchemy.

Deliverables
- A Python class that manages payment approval state transitions.
- Methods to:
  - Submit approval or rejection.
  - Check user role validity within a group.
  - Enforce the approval window.
  - Support revocation before finalization.
  - Generate and return an immutable audit trail.
- Unit tests covering common workflows and edge cases (duplicate approvals, wrong roles, expired approvals, out-of-order approvals, revocations).

This module will serve as the secure gateway into the SACCO’s payment distribution pipeline. Getting the rules right here is critical, because any mistakes at this stage could compromise the SACCO’s financial governance.
