# solution.py
from decimal import Decimal
from datetime import date, datetime
import uuid

# -------------------- Utilities --------------------
def _to_decimal(v):
    """Normalize to Decimal with 2 decimal places."""
    if isinstance(v, Decimal):
        return v.quantize(Decimal("0.01"))
    return Decimal(str(v)).quantize(Decimal("0.01"))

def _first_of_month(d):
    """Return first day of the month for a date-like object."""
    return date(d.year, d.month, 1)

def _add_months(dt, months):
    """Add months to a date (dt is a date) and return first-of-month."""
    y = dt.year + (dt.month - 1 + months) // 12
    m = (dt.month - 1 + months) % 12 + 1
    return date(y, m, 1)

def _months_between(start, end):
    """Return list of first-of-month dates from start to end inclusive."""
    months = []
    cur = _first_of_month(start)
    end_first = _first_of_month(end)
    while cur <= end_first:
        months.append(cur)
        cur = _add_months(cur, 1)
    return months

# -------------------- SaccoLedgerManager --------------------
class SaccoLedgerManager:
    FISCAL_YEAR_START = 9  # September
    SACCO_START_DATE = date(2024, 9, 1)
    DEFAULT_MONTHLY_CONTRIBUTION = Decimal("1500.00")
    DEFAULT_FINE_PER_MONTH = Decimal("100.00")
    FINE_GRACE_FULL_MONTHS = 3  # three full months grace, fine at 4th month start

    def __init__(self, member_id, contribution_history=None, fine_history=None):
        self.member_id = member_id
        # store lists of dict-like records (tests rely on dicts)
        self.contribution_history = list(contribution_history) if contribution_history else []
        self.fine_history = list(fine_history) if fine_history else []

    # -------------------- Validation --------------------
    def _validate_payment(self, payment_record):
        """Raise ValueError for invalid payment records (tests depend on this)."""
        if not isinstance(payment_record, dict):
            raise ValueError("Invalid payment record")
        if payment_record.get("member_id") != self.member_id:
            raise ValueError("member_id mismatch")
        if payment_record.get("status") != "approved":
            raise ValueError("payment status not approved")
        if not payment_record.get("is_lumpsum", False):
            raise ValueError("payment must be lumpsum")
        if payment_record.get("is_distributed", False):
            raise ValueError("payment already distributed")
        amt = _to_decimal(payment_record.get("amount_paid", Decimal("0.00")))
        if amt < Decimal("0.01"):
            raise ValueError("amount_paid must be positive")
        ref = payment_record.get("payment_Reference_Code")
        if ref is None:
            raise ValueError("missing payment_Reference_Code")
        # Duplicate reference check against existing contribution_history
        for rec in self.contribution_history:
            if rec.get("payment_Reference_Code") == ref:
                raise ValueError("duplicate payment reference code")
        if "contribution_date" not in payment_record or payment_record["contribution_date"] is None:
            raise ValueError("contribution_date is required")

    # -------------------- Helpers --------------------
    def _sum_paid_for_month(self, m):
        """Sum distributed monthly payments for month `m` (ignore original lumpsum records)."""
        return sum(
            _to_decimal(c.get("amount_paid", Decimal("0.00")))
            for c in self.contribution_history
            if (c.get("contribution_month") == m and not c.get("is_lumpsum", False) and c.get("is_distributed", False))
        )

    # -------------------- Public API --------------------
    def process_payment(self, payment_record):
        """
        Process a lumpsum payment and return list of created/modified records.

        Steps:
          1) Validate input
          2) Pay existing unpaid fines (chronological)
          3) Determine & create newly-accrued fine months using rule:
               start_fine_month = max(latest_fine + 1, latest_paid + grace + 1)
             where latest_paid is the last contribution_month that has ANY distributed monthly record
             (partial counts). Create fines month-by-month up to first_of_month(processing_date) inclusive.
             For each fine created, immediately apply available payment (may fully or partially pay it).
             If amount runs out, stop creating further fines in this transaction.
          4) Distribute remaining to monthly contributions (chronological backfill -> anchor -> spillover)
          5) Mark original lumpsum as distributed and append to history
        """
        self._validate_payment(payment_record)

        # normalize processing date
        proc_dt = payment_record["contribution_date"]
        processing_date = proc_dt.date() if isinstance(proc_dt, datetime) else proc_dt

        amount_remaining = _to_decimal(payment_record["amount_paid"])
        created = []

        # ------------------ 1) Apply existing unpaid fines (chronological) ------------------
        unpaid_fines = sorted(
            [f for f in self.fine_history if not f.get("is_paid", False)],
            key=lambda f: _first_of_month(f["contribution_month_covered"])
        )
        for f in unpaid_fines:
            if amount_remaining <= Decimal("0.00"):
                break
            owed = _to_decimal(f["amount"]) - _to_decimal(f.get("amount_paid", Decimal("0.00")))
            if owed <= Decimal("0.00"):
                continue
            pay = min(owed, amount_remaining)
            f["amount_paid"] = _to_decimal(_to_decimal(f.get("amount_paid", Decimal("0.00"))) + pay)
            amount_remaining -= pay
            if _to_decimal(f["amount_paid"]) >= _to_decimal(f["amount"]):
                f["is_paid"] = True
            created.append(f)  # include modified fine in results

        # ------------------ 2) Determine & CREATE newly accrued fines ------------------
        # Gather last paid months and last fine months
        paid_months_all = sorted({
            c["contribution_month"]
            for c in self.contribution_history
            if not c.get("is_lumpsum", False) and c.get("is_distributed", False)
        })
        fine_months_all = sorted({
            f["contribution_month_covered"]
            for f in self.fine_history
            if f.get("contribution_month_covered")
        })

        latest_paid = max(paid_months_all) if paid_months_all else None
        latest_fine = max(fine_months_all) if fine_months_all else None

        if latest_paid:
            candidate_grace_start = _add_months(latest_paid, self.FINE_GRACE_FULL_MONTHS + 1)
        else:
            candidate_grace_start = _add_months(self.SACCO_START_DATE, self.FINE_GRACE_FULL_MONTHS + 1)

        if latest_fine:
            # resume from the month after last created fine (ensures we don't recreate previous fines)
            latest_fine_plus1 = _add_months(latest_fine, 1)
            start_fine_month = latest_fine_plus1 if latest_fine_plus1 >= candidate_grace_start else candidate_grace_start
        else:
            start_fine_month = candidate_grace_start

        # last month to consider for accrual is the first of processing_date (inclusive)
        last_month_for_accrual = _first_of_month(processing_date)

        if start_fine_month <= last_month_for_accrual:
            candidate_new_fine_months = _months_between(start_fine_month, last_month_for_accrual)
        else:
            candidate_new_fine_months = []

        # Avoid duplicates: set of months already present in fine_history
        existing_fine_months = {f["contribution_month_covered"] for f in self.fine_history if f.get("contribution_month_covered")}

        # Create & immediately pay new fines one-by-one, stop creating when funds exhaust
        for m in candidate_new_fine_months:
            if amount_remaining <= Decimal("0.00"):
                break  # stop creating further fines in this payment if no funds remain
            if m in existing_fine_months:
                continue
            paid_amount = min(amount_remaining, self.DEFAULT_FINE_PER_MONTH)
            amount_remaining -= paid_amount
            fine_rec = {
                "charged_user": self.member_id,
                "amount": _to_decimal(self.DEFAULT_FINE_PER_MONTH),
                "amount_paid": _to_decimal(paid_amount),
                "description": f"Fine for {m.isoformat()}",
                "fine_date": processing_date,
                "is_paid": _to_decimal(paid_amount) >= _to_decimal(self.DEFAULT_FINE_PER_MONTH),
                "contribution_month_covered": m,
            }
            self.fine_history.append(fine_rec)
            created.append(fine_rec)
            existing_fine_months.add(m)

        # ------------------ 3) Distribute remaining to monthly contributions ------------------
        monthly_amt = _to_decimal(payment_record.get("monthly_contribution_amount", self.DEFAULT_MONTHLY_CONTRIBUTION))

        # Build set of months that already have any distributed monthly record (we skip creating duplicates)
        already_paid_months = {
            c["contribution_month"]
            for c in self.contribution_history
            if not c.get("is_lumpsum", False) and c.get("is_distributed", False)
        }

        # Determine anchor month if provided
        lump_month_raw = payment_record.get("contribution_month")
        lump_month_anchor = None
        if lump_month_raw:
            lump_month_anchor = _first_of_month(lump_month_raw if isinstance(lump_month_raw, date) else lump_month_raw.date())

        # Decide chronological backfill start:
        # - If there are distributed monthly records, BACKFILL from SACCO_START_DATE to ensure earlier unpaid months are included.
        # - If there are NO distributed monthly records:
        #     - if an anchor is provided -> start at anchor (new joiner)
        #     - else -> start at SACCO_START_DATE
        if paid_months_all:
            start_for_backfill = self.SACCO_START_DATE
        else:
            start_for_backfill = lump_month_anchor if lump_month_anchor else self.SACCO_START_DATE

        expected_months = _months_between(start_for_backfill, _first_of_month(processing_date))

        monthly_created = []
        for m in expected_months:
            if amount_remaining <= Decimal("0.00"):
                break
            # skip months that already have any distributed monthly record (we don't duplicate)
            if m in already_paid_months:
                continue
            # allocate chronologically oldest-first
            to_pay = min(amount_remaining, monthly_amt)
            monthly_rec = {
                "member_id": self.member_id,
                "contribution_id": f"M-{payment_record.get('contribution_id', uuid.uuid4())}-{m.isoformat()}",
                "payment_Reference_Code": payment_record["payment_Reference_Code"],
                "is_lumpsum": False,
                "is_distributed": True,
                "amount_paid": _to_decimal(to_pay),
                "monthly_contribution_amount": monthly_amt,
                "contribution_date": payment_record["contribution_date"],
                "contribution_month": m,
                "group_year": self._get_group_year(m),
            }
            self.contribution_history.append(monthly_rec)
            monthly_created.append(monthly_rec)
            created.append(monthly_rec)
            amount_remaining -= to_pay
            # mark as having a distributed record now
            already_paid_months.add(m)

        # Anchor month spillover (if still funds remain)
        if lump_month_anchor and amount_remaining > Decimal("0.00"):
            created_months_this_call = set(mr["contribution_month"] for mr in monthly_created)
            nxt = lump_month_anchor
            # Continue forward from anchor, skipping months already created in this call and months already paid
            while amount_remaining > Decimal("0.00"):
                if nxt in created_months_this_call:
                    nxt = _add_months(nxt, 1)
                    continue
                if nxt in already_paid_months:
                    nxt = _add_months(nxt, 1)
                    continue
                to_pay = min(monthly_amt, amount_remaining)
                monthly_rec = {
                    "member_id": self.member_id,
                    "contribution_id": f"M-{payment_record.get('contribution_id', uuid.uuid4())}-{nxt.isoformat()}",
                    "payment_Reference_Code": payment_record["payment_Reference_Code"],
                    "is_lumpsum": False,
                    "is_distributed": True,
                    "amount_paid": _to_decimal(to_pay),
                    "monthly_contribution_amount": monthly_amt,
                    "contribution_date": payment_record["contribution_date"],
                    "contribution_month": nxt,
                    "group_year": self._get_group_year(nxt),
                }
                self.contribution_history.append(monthly_rec)
                monthly_created.append(monthly_rec)
                created.append(monthly_rec)
                amount_remaining -= to_pay
                already_paid_months.add(nxt)
                created_months_this_call.add(nxt)
                nxt = _add_months(nxt, 1)

        # ------------------ 4) Mark original lumpsum as distributed and append ------------------
        payment_record["is_distributed"] = True
        payment_record["amount_paid"] = _to_decimal(payment_record["amount_paid"])
        payment_record["monthly_contribution_amount"] = _to_decimal(payment_record.get("monthly_contribution_amount", self.DEFAULT_MONTHLY_CONTRIBUTION))
        self.contribution_history.append(payment_record)

        return created

    # -------------------- Expected Contributions --------------------
    def calculate_expected_contributions(self, current_date):
        """Return list of expected contribution months up to first of current_date (inclusive).
           Start from earliest distributed monthly contribution if present, else SACCO_START_DATE.
        """
        if isinstance(current_date, datetime):
            current_date = current_date.date()
        current_date = _first_of_month(current_date)

        distributed_months = [
            c["contribution_month"]
            for c in self.contribution_history
            if not c.get("is_lumpsum", False) and c.get("is_distributed", False)
        ]
        first_actual = min(distributed_months) if distributed_months else self.SACCO_START_DATE
        months = _months_between(first_actual, current_date)
        return months

    # -------------------- Contribution Status --------------------
    def get_contribution_status(self, as_of_date):
        """
        Return SACCO contribution status as of a given date.

        - arrears_months: number of months with deficient payment
        - arrears_amount: total missing from required monthly contributions
        - total_arrears: alias of arrears_amount
        - total_fines: outstanding existing fines only (no pre-accrual)
        - paid_months: list of months fully paid
        - total_contribution_paid: total distributed monthly amounts (includes partials)
        """
        if isinstance(as_of_date, datetime):
            as_of_date = as_of_date.date()

        # On the 1st of a month, reflect the previous month
        if as_of_date.day == 1:
            last_expected_month = _add_months(_first_of_month(as_of_date), -1)
        else:
            last_expected_month = _first_of_month(as_of_date)

        # Determine start for expected months (earliest distributed monthly if any, else SACCO start)
        distributed_months = [
            c["contribution_month"]
            for c in self.contribution_history
            if not c.get("is_lumpsum", False) and c.get("is_distributed", False)
        ]
        start_month = min(distributed_months) if distributed_months else self.SACCO_START_DATE
        expected_months = _months_between(start_month, last_expected_month)

        paid_months_set = set()
        total_arrears_amount = Decimal("0.00")
        arrears_count = 0
        total_contribution_paid = Decimal("0.00")

        for m in expected_months:
            month_paid = self._sum_paid_for_month(m)
            total_contribution_paid += _to_decimal(month_paid)
            required = _to_decimal(self.DEFAULT_MONTHLY_CONTRIBUTION)
            if month_paid >= required:
                paid_months_set.add(m)
            else:
                # partial counts as a single arrear month
                arrears_count += 1
                total_arrears_amount += _to_decimal(required - month_paid)

        # Outstanding existing fines (unpaid portion only)
        outstanding_existing = sum(
            (_to_decimal(f["amount"]) - _to_decimal(f.get("amount_paid", Decimal("0.00"))))
            for f in self.fine_history
        )

        total_fines = _to_decimal(outstanding_existing)

        return {
            "arrears_months": arrears_count,
            "arrears_amount": _to_decimal(total_arrears_amount),
            "total_arrears": _to_decimal(total_arrears_amount),
            "total_fines": total_fines,
            "paid_months": sorted(list(paid_months_set)),
            "total_contribution_paid": _to_decimal(total_contribution_paid),
        }

    # -------------------- Helpers --------------------
    def _get_group_year(self, contrib_month_date):
        """Return fiscal year as 'YYYY/YYYY' for a contribution month."""
        m = _first_of_month(contrib_month_date)
        if m.month >= self.FISCAL_YEAR_START:
            return f"{m.year}/{m.year + 1}"
        else:
            return f"{m.year - 1}/{m.year}"
