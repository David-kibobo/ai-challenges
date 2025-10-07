# -*- coding: utf-8 -*-
import unittest
from decimal import Decimal
from datetime import date, datetime
import uuid

# QUick Command to remove non-Ascci characters. grep --color='auto' -P -n "[^\x00-\x7F]" tests_file.py
# Assuming the SaccoLedgerManager class is available in a sibling file named 'solution.py'
from solution import SaccoLedgerManager


def make_lumpsum(
    member_id,
    amount,
    ref=None,
    contrib_date=None,
    contrib_month=None,
    status="approved",
    is_lumpsum=True,
    is_distributed=False,
    monthly_amount="1500.00",
):
    """Create a deterministic Lumpsum Contribution record for testing."""
    return {
        "member_id": member_id,
        "contribution_id": str(uuid.uuid4()),
        "payment_Reference_Code": ref or str(uuid.uuid4()),
        "status": status,
        "is_lumpsum": is_lumpsum,
        "is_distributed": is_distributed,
        "amount_paid": Decimal(amount),
        "monthly_contribution_amount": Decimal(monthly_amount),
        # Ensure contrib_date is a datetime, using a default if none provided
        "contribution_date": contrib_date or datetime(2024, 9, 1, 10, 0, 0),
        "contribution_month": contrib_month or date(2024, 9, 1),
        "group_year": "2024/2025",
    }


def make_monthly_record(
    member_id,
    amount_paid,
    contrib_month,
    ref=None,
    monthly_amount="1500.00",
):
    """Helper to craft an existing Monthly Contribution record for pre-populated history."""
    return {
        "member_id": member_id,
        "contribution_id": str(uuid.uuid4()),
        "payment_Reference_Code": ref or str(uuid.uuid4()),
        "is_lumpsum": False,
        "is_distributed": True,
        "amount_paid": Decimal(amount_paid),
        "monthly_contribution_amount": Decimal(monthly_amount),
        "contribution_date": datetime(
            contrib_month.year, contrib_month.month, 1, 10, 0, 0
        ),
        "contribution_month": contrib_month,
        "group_year": None,
    }


def make_fine_record(
    member_id,
    amount,
    amount_paid,
    contribution_month_covered,
    fine_date=None,
    description="",
    is_paid=False,
):
    return {
        "charged_user": member_id,
        "amount": Decimal(amount),
        "amount_paid": Decimal(amount_paid),
        "description": description,
        "fine_date": fine_date or date(2024, 9, 1),
        "is_paid": is_paid,
        "contribution_month_covered": contribution_month_covered,
    }


def expected_group_year_for_month(m):
    """Helper to compute expected group year string for a contribution-month date."""
    if m.month >= 9:  # Sept or later -> fiscal year starts same calendar year
        return f"{m.year}/{m.year + 1}"
    else:
        return f"{m.year - 1}/{m.year}"


class TestSaccoLedgerManagerFinalized(unittest.TestCase):
    def setUp(self):
        self.member_id = str(uuid.uuid4())
        # Default ledger assumes a base monthly contribution of 1500.00
        self.ledger = SaccoLedgerManager(member_id=self.member_id)

    # --- NEW TESTS FOR GROUP YEAR, IMMUTABILITY, AND ARREARS EXCLUSION ---

    def test_group_year_calculation_fiscal_rollover(self):
        # The SACCO fiscal year starts in September.

        # 1. Payment for August 2025 (before Sept rollover). Should fall into the 2024/2025 group year.
        lump_aug = make_lumpsum(
            self.member_id,
            "1500.00",
            contrib_month=date(2025, 8, 1),
            contrib_date=datetime(2025, 8, 15),
        )
        result_aug = self.ledger.process_payment(lump_aug)
        # Find the monthly record corresponding to Aug 2025 (don't rely on ordering)
        aug_monthly = [
            r for r in result_aug if r.get("contribution_month") == date(2025, 8, 1)
        ]
        self.assertTrue(
            aug_monthly,
            "Expected a monthly record for Aug 2025 in the process_payment result.",
        )
        self.assertEqual(
            aug_monthly[0]["group_year"],
            "2024/2025",
            "August 2025 contribution should belong to 2024/2025 fiscal year.",
        )

        # 2. Payment for September 2025 (at or after Sept rollover).
        # NOTE: business logic may backfill earlier months first  so don't require a Sep-2025 monthly record specifically.
        # Instead assert each monthly record returned has the correct group_year for its own contribution_month.
        lump_sep = make_lumpsum(
            self.member_id,
            "1500.00",
            contrib_month=date(2025, 9, 1),
            contrib_date=datetime(2025, 9, 15),
        )
        result_sep = self.ledger.process_payment(lump_sep)
        sep_monthly_records = [
            r for r in result_sep if r.get("contribution_month") is not None
        ]
        # there should be at least one monthly record (otherwise something else is wrong)
        self.assertTrue(
            len(sep_monthly_records) >= 1,
            "Expected at least one monthly allocation record on processing.",
        )
        # verify group_year correctness for each created monthly record
        for r in sep_monthly_records:
            m = r["contribution_month"]
            expected = expected_group_year_for_month(m)
            self.assertEqual(
                r["group_year"], expected, f"Group year for {m} should be {expected}."
            )

    def test_monetary_immutability_after_fee_change(self):
        # Test that historical records retain their original fee, even if the base fee changes later.
        original_fee = Decimal("1500.00")
        new_fee = Decimal("2000.00")

        # 1. Process payment 1 using the original fee ($1500) for Sep 2024
        p1_month = date(2024, 9, 1)
        p1 = make_lumpsum(
            self.member_id,
            "1500.00",
            contrib_month=p1_month,
            contrib_date=datetime(2024, 9, 15),
            monthly_amount=str(original_fee),
        )
        self.ledger.process_payment(p1)

        # 2. Process payment 2 using the new fee ($2000) for Oct 2024
        p2_month = date(2024, 10, 1)
        p2 = make_lumpsum(
            self.member_id,
            "2000.00",
            contrib_month=p2_month,
            contrib_date=datetime(2024, 10, 15),
            # This dictates the fee used in the resulting monthly record
            monthly_amount=str(new_fee),
        )
        self.ledger.process_payment(p2)

        # 3. Assert immutability: check historical records retain old fee
        sep_record = next(
            c
            for c in self.ledger.contribution_history
            if c["contribution_month"] == p1_month and c["is_lumpsum"] is False
        )
        oct_record = next(
            c
            for c in self.ledger.contribution_history
            if c["contribution_month"] == p2_month and c["is_lumpsum"] is False
        )

        self.assertEqual(
            sep_record["monthly_contribution_amount"],
            original_fee,
            "Old record must retain original contribution fee of $1500.00.",
        )
        self.assertEqual(
            oct_record["monthly_contribution_amount"],
            new_fee,
            "New record must reflect the updated contribution fee of $2000.00.",
        )

    def test_undistributed_lumpsum_ignored_in_arrears(self):
        # State: Member has 3 months arrears (Sep, Oct, Nov)
        # And an undistributed payment (1500.00) in history

        # 1. Create an undistributed lumpsum for Sep 2024
        # Since 'process_payment' would distribute it, we manually add it to the history.
        undistributed_lump = make_lumpsum(
            self.member_id,
            "1500.00",
            contrib_month=date(2024, 9, 1),
            contrib_date=datetime(2024, 9, 15),
            is_distributed=False,  # KEY FLAG: Must be false for the test scenario
        )
        self.ledger.contribution_history.append(undistributed_lump)

        # 2. Check status up to Nov 2024 (expected arrears: Sep, Oct, Nov)
        status_nov = self.ledger.get_contribution_status(date(2024, 11, 15))

        # Expected: The undistributed lump should be IGNORED, resulting in 3 months arrears (3 * 1500)
        self.assertEqual(
            status_nov["arrears_months"],
            3,
            "Undistributed lumpsum should not reduce the number of arrears months.",
        )
        # precise key name expected by spec/tests: arrears_amount
        self.assertEqual(
            status_nov["arrears_amount"],
            Decimal("4500.00"),
            "Undistributed lumpsum should be ignored in total arrears calculation.",
        )

    # ---------- Initialization with existing histories ----------

    def test_init_with_existing_contribution_and_fine_history(self):
        sep = make_monthly_record(
            self.member_id, "1500.00", date(2024, 9, 1), ref="r-sep"
        )
        octo = make_monthly_record(
            self.member_id, "1500.00", date(2024, 10, 1), ref="r-oct"
        )
        jan_fine = make_fine_record(
            self.member_id,
            "100.00",
            "0.00",
            date(2025, 1, 1),
            fine_date=date(2025, 1, 2),
            is_paid=False,
        )
        ledger = SaccoLedgerManager(
            member_id=self.member_id,
            contribution_history=[sep, octo],
            fine_history=[jan_fine],
        )
        # <-- changed the check date to mid-month so the expected "Nov" month is included
        status_nov = ledger.get_contribution_status(date(2024, 11, 15))
        self.assertEqual(status_nov["arrears_months"], 1)
        self.assertEqual(status_nov["arrears_amount"], Decimal("1500.00"))
        self.assertEqual(len(ledger.fine_history), 1)
        self.assertEqual(
            ledger.fine_history[0]["contribution_month_covered"], date(2025, 1, 1)
        )

    # --- NEW TESTS FOR GET_CONTRIBUTION_STATUS ARREARS LOGIC ---

    def test_status_with_partial_payment(self):
        """
        Test contribution status for a member who paid partially:
        Payments:
        - Sep 2024: full
        - Oct 2024: full
        -NOV 2024: none
        - Dec 2024: partial
        - Jan-Feb 2025: full
        - Mar 2025: partial
        Check as of Apr 15, 2025.
        """
        # Payments
        self.ledger.process_payment(make_lumpsum(self.member_id, "1500.00",
                                                contrib_month=date(2024, 9, 1),
                                                contrib_date=datetime(2024, 9, 15)))
        self.ledger.process_payment(make_lumpsum(self.member_id, "1500.00",
                                                contrib_month=date(2024, 10, 1),
                                                contrib_date=datetime(2024, 10, 15)))
        self.ledger.process_payment(make_lumpsum(self.member_id, "100.00",
                                                contrib_month=date(2024, 12, 1),
                                                contrib_date=datetime(2024, 12, 15)))
        self.ledger.process_payment(make_lumpsum(self.member_id, "1500.00",
                                                contrib_month=date(2025, 1, 1),
                                                contrib_date=datetime(2025, 1, 15)))
        self.ledger.process_payment(make_lumpsum(self.member_id, "1500.00",
                                                contrib_month=date(2025, 2, 1),
                                                contrib_date=datetime(2025, 2, 15)))
        self.ledger.process_payment(make_lumpsum(self.member_id, "500.00",
                                                contrib_month=date(2025, 3, 1),
                                                contrib_date=datetime(2025, 3, 15)))

        status = self.ledger.get_contribution_status(date(2025, 4, 15))
        print("Status as of 2025-04-15:", status)

        # Correct expectations
        expected_arrears_months = 4  #  Nov, Dec, Mar, Apr
        expected_arrears_amount = Decimal( "5400.00")  # sum of missing amounts

        expected_total_paid = Decimal("6600.00")

        assert status["arrears_months"] == expected_arrears_months
        assert status["arrears_amount"] == expected_arrears_amount
        assert status["total_contribution_paid"] == expected_total_paid

    def test_status_ignores_distributed_lumpsums(self):
        """
        Tests that get_contribution_status correctly ignores an original lumpsum
        record that has already been distributed (is_distributed=True) to prevent double counting.
        """
        # 1. Manually add distributed monthly records for Jan, Feb, Mar (4500 total paid)
        self.ledger.contribution_history.append(
            make_monthly_record(self.member_id, "1500.00", date(2025, 1, 1))
        )
        self.ledger.contribution_history.append(
            make_monthly_record(self.member_id, "1500.00", date(2025, 2, 1))
        )
        self.ledger.contribution_history.append(
            make_monthly_record(self.member_id, "1500.00", date(2025, 3, 1))
        )

        # 2. Manually add the original, distributed lumpsum record (4500)
        processed_lumpsum = make_lumpsum(
            self.member_id,
            "4500.00",
            contrib_month=date(2025, 3, 1),
            contrib_date=datetime(2025, 3, 15),
            is_distributed=True,  # KEY FLAG: Should be ignored by arrears calculation
        )
        self.ledger.contribution_history.append(processed_lumpsum)

        # Check status as of April 1, 2025.
        status = self.ledger.get_contribution_status(date(2025, 4, 1))

        # Expected: Arrears must be 0 because Jan, Feb, Mar are covered by the monthly records.
        self.assertEqual(status["arrears_months"], 0, "Arrears months should be 0.")
        self.assertEqual(
            status["arrears_amount"], Decimal("0.00"), "Arrears amount should be 0.00."
        )

    # ---------- Fine is_paid toggle ----------
    def test_fine_is_paid_toggles_after_two_payments(self):
        initial_fine = make_fine_record(
            self.member_id,
            "100.00",
            "0.00",
            date(2025, 1, 1),
            fine_date=date(2025, 1, 2),
            is_paid=False,
        )
        ledger = SaccoLedgerManager(
            member_id=self.member_id,
            contribution_history=[],
            fine_history=[initial_fine],
        )

        # Payment 1: Partial payment of $50.00 on Jan 5
        p1 = make_lumpsum(
            self.member_id,
            "50.00",
            contrib_month=date(2025, 1, 1),
            contrib_date=datetime(2025, 1, 5),
        )
        ledger.process_payment(p1)

        jan_fines = [
            f
            for f in ledger.fine_history
            if f["contribution_month_covered"] == date(2025, 1, 1)
        ]
        self.assertEqual(sum(f["amount_paid"] for f in jan_fines), Decimal("50.00"))
        self.assertFalse(any(f["is_paid"] for f in jan_fines))

        # Payment 2: Second partial payment of $50.00 on Jan 10
        p2 = make_lumpsum(
            self.member_id,
            "50.00",
            contrib_month=date(2025, 1, 1),
            contrib_date=datetime(2025, 1, 10),
        )
        ledger.process_payment(p2)

        jan_fines_after = [
            f
            for f in ledger.fine_history
            if f["contribution_month_covered"] == date(2025, 1, 1)
        ]
        self.assertEqual(
            sum(f["amount_paid"] for f in jan_fines_after), Decimal("100.00")
        )
        self.assertTrue(any(f["is_paid"] for f in jan_fines_after))

    # ---------- Fine logic corrections ----------
    def test_no_fine_within_grace_period(self):
        # Pay Sep contribution on Sep 15, 2024
        self.ledger.process_payment(
            make_lumpsum(
                self.member_id,
                "1500.00",
                contrib_month=date(2024, 9, 1),
                contrib_date=datetime(2024, 9, 15),
            )
        )
        # Check status on Oct 1, 2024 (Grace period applies)
        status_oct = self.ledger.get_contribution_status(date(2024, 10, 1))
        self.assertEqual(status_oct["total_fines"], Decimal("0.00"))

        # Pay Oct contribution on Oct 15, 2024 (Still within grace for Sep/Oct)
        result = self.ledger.process_payment(
            make_lumpsum(
                self.member_id,
                "1500.00",
                contrib_month=date(2024, 10, 1),
                contrib_date=datetime(2024, 10, 15),
            )
        )
        fine_records = [r for r in result if r.get("amount") is not None]
        self.assertEqual(fine_records, [])

    def test_fines_accumulate_across_months(self):
        # Pay Sep 2024 on time
        self.ledger.process_payment(
            make_lumpsum(
                self.member_id,
                "1500.00",
                contrib_month=date(2024, 9, 1),
                contrib_date=datetime(2024, 9, 15),
            )
        )

        # Skip Oct, Nov, Dec => by Jan 2025, grace is over
        status_jan = self.ledger.get_contribution_status(date(2025, 1, 1))
        # No pre-accrual expected (fines are only created at payment time)
        self.assertEqual(status_jan["total_fines"], Decimal("0.00"))

        # Since we do not pre-accrue fines, status as of Feb 1 prior to any payment should still show zero fines
        status_feb = self.ledger.get_contribution_status(date(2025, 2, 1))
        self.assertEqual(status_feb["total_fines"], Decimal("0.00"))

    def test_fine_resumes_from_last_fine_record_not_grace_period(self):
        # 1. Pay Sep 2024 contribution on Sep 15
        self.ledger.process_payment(
            make_lumpsum(
                self.member_id,
                "1500.00",
                contrib_month=date(2024, 9, 1),
                contrib_date=datetime(2024, 9, 15),
            )
        )

        # 2. Cover existing Jan 2025 fine with $100 on Jan 15
        self.ledger.process_payment(
            make_lumpsum(
                self.member_id,
                "100.00",
                contrib_month=date(2025, 1, 1),
                contrib_date=datetime(2025, 1, 15),
            )
        )

        # 3. Check status on Feb 1, 2025 => no new fine yet (no pre-accrual)
        status_feb = self.ledger.get_contribution_status(date(2025, 2, 1))
        self.assertEqual(status_feb["total_fines"], Decimal("0.00"))

    # ---------- Failure paths for process_payment ----------
    def test_process_payment_negative_amount_raises(self):
        with self.assertRaises(ValueError):
            self.ledger.process_payment(
                make_lumpsum(
                    self.member_id, "-100.00", contrib_date=datetime(2024, 9, 15)
                )
            )

    def test_process_payment_zero_amount_raises(self):
        with self.assertRaises(ValueError):
            self.ledger.process_payment(
                make_lumpsum(self.member_id, "0.00", contrib_date=datetime(2024, 9, 15))
            )

    def test_process_payment_is_distributed_true_raises(self):
        bad = make_lumpsum(
            self.member_id, "1500.00", contrib_date=datetime(2024, 9, 15)
        )
        bad["is_distributed"] = True
        with self.assertRaises(ValueError):
            self.ledger.process_payment(bad)

    def test_process_payment_mismatched_member_raises(self):
        with self.assertRaises(ValueError):
            self.ledger.process_payment(
                make_lumpsum("other", "1500.00", contrib_date=datetime(2024, 9, 15))
            )

    def test_process_payment_duplicate_reference_code_raises(self):
        ref = "DUP-REF"
        first = make_lumpsum(
            self.member_id, "1500.00", ref=ref, contrib_date=datetime(2024, 9, 15)
        )
        self.ledger.process_payment(first)
        dup = make_lumpsum(
            self.member_id, "1500.00", ref=ref, contrib_date=datetime(2024, 9, 15)
        )
        with self.assertRaises(ValueError):
            self.ledger.process_payment(dup)

    def test_process_payment_status_not_approved_raises(self):
        bad = make_lumpsum(
            self.member_id, "1500.00", contrib_date=datetime(2024, 9, 15)
        )
        bad["status"] = "pending"
        with self.assertRaises(ValueError):
            self.ledger.process_payment(bad)

    def test_process_payment_is_lumpsum_false_raises(self):
        bad = make_lumpsum(
            self.member_id, "1500.00", contrib_date=datetime(2024, 9, 15)
        )
        bad["is_lumpsum"] = False
        with self.assertRaises(ValueError):
            self.ledger.process_payment(bad)

    # ---------- Payment scenarios ----------
    def test_payment_less_than_total_fine_partial(self):
        # Pay Sep 2024 contribution on Sep 15, 2024
        self.ledger.process_payment(
            make_lumpsum(
                self.member_id,
                "1500.00",
                contrib_month=date(2024, 9, 1),
                contrib_date=datetime(2024, 9, 15),
            )
        )
        # Payment of $50.00 on Jan 15, 2025. Total fine is $100.00.
        small = make_lumpsum(
            self.member_id,
            "50.00",
            contrib_month=date(2025, 1, 1),
            contrib_date=datetime(2025, 1, 15),
        )
        self.ledger.process_payment(small)
        total_paid = sum(f["amount_paid"] for f in self.ledger.fine_history)
        # exact check: expect 50 paid across fines after single partial payment
        self.assertEqual(total_paid, Decimal("50.00"))

    def test_payment_equal_to_total_fine_only(self):
        # Pay Sep 2024 contribution on Sep 15, 2024
        self.ledger.process_payment(
            make_lumpsum(
                self.member_id,
                "1500.00",
                contrib_month=date(2024, 9, 1),
                contrib_date=datetime(2024, 9, 15),
            )
        )
        # Payment of $100.00 on Jan 15, 2025. Total fine is $100.00.
        exact = make_lumpsum(
            self.member_id,
            "100.00",
            contrib_month=date(2025, 1, 1),
            contrib_date=datetime(2025, 1, 15),
        )
        result = self.ledger.process_payment(exact)
        fine_records = [r for r in result if r.get("amount") is not None]
        self.assertEqual(len(fine_records), 1)
        self.assertEqual(fine_records[0]["amount_paid"], Decimal("100.00"))
        self.assertEqual(
            [r for r in result if r.get("contribution_month") is not None], []
        )

    def test_payment_more_than_fine_spills_to_contributions(self):
        # Pay Sep 2024 contribution on Sep 15, 2024
        self.ledger.process_payment(
            make_lumpsum(
                self.member_id,
                "1500.00",
                contrib_month=date(2024, 9, 1),
                contrib_date=datetime(2024, 9, 15),
            )
        )
        # Status check on Jan 1, 2025 -> in the new behavior fines are NOT pre-accrued
        # We explicitly provide the amount that covers one fine (100) and one monthly (1500) = 1600.00
        amount = Decimal("1600.00")  # explicit: fine(100) + monthly(1500)
        # Payment on Jan 15, 2025. Pays $100 fine and $1500 (covers Oct arrears).
        result = self.ledger.process_payment(
            make_lumpsum(
                self.member_id,
                str(amount),
                contrib_month=date(2025, 1, 1),
                ref="REF-SPILL",
                contrib_date=datetime(2025, 1, 15),
            )
        )
        monthly = [m for m in result if m.get("contribution_month") is not None]
        # precise expectation: only Oct 2024 should be covered by the spillover
        self.assertEqual(len(monthly), 1)
        self.assertEqual(monthly[0]["contribution_month"], date(2024, 10, 1))
        self.assertEqual(monthly[0]["amount_paid"], Decimal("1500.00"))
        self.assertEqual(monthly[0]["payment_Reference_Code"], "REF-SPILL")

    def test_partial_monthly_contribution(self):
        # Payment of $1000 on Sep 15, 2024
        result = self.ledger.process_payment(
            make_lumpsum(
                self.member_id,
                "1000.00",
                contrib_month=date(2024, 9, 1),
                contrib_date=datetime(2024, 9, 15),
            )
        )
        monthly = [r for r in result if r.get("contribution_month") is not None]
        self.assertEqual(len(monthly), 1)
        self.assertEqual(monthly[0]["amount_paid"], Decimal("1000.00"))

    # ---------- Post-processing checks ----------
    def test_original_lumpsum_marked_distributed_after_processing(self):
        lump = make_lumpsum(
            self.member_id,
            "1500.00",
            contrib_month=date(2024, 9, 1),
            contrib_date=datetime(2024, 9, 15),
        )
        cid = lump["contribution_id"]
        self.ledger.process_payment(lump)
        match = [
            c for c in self.ledger.contribution_history if c["contribution_id"] == cid
        ]
        self.assertTrue(match[0]["is_distributed"])

    def test_group_year_and_fine_contribution_month_populated(self):
        # Pay Sep 2024 contribution on Sep 15, 2024
        self.ledger.process_payment(
            make_lumpsum(
                self.member_id,
                "1500.00",
                contrib_month=date(2024, 9, 1),
                contrib_date=datetime(2024, 9, 15),
            )
        )
        status_jan = self.ledger.get_contribution_status(date(2025, 1, 1))
        total_fines = status_jan.get("total_fines", Decimal("0.00"))
        amount = total_fines + Decimal("1500.00")
        # Payment on Jan 15, 2025
        result = self.ledger.process_payment(
            make_lumpsum(
                self.member_id,
                str(amount),
                contrib_month=date(2025, 1, 1),
                ref="REF-GY",
                contrib_date=datetime(2025, 1, 15),
            )
        )
        monthly = [r for r in result if r.get("contribution_month") is not None]
        for m in monthly:
            self.assertIsInstance(m["group_year"], str)
        fines = [r for r in result if r.get("amount") is not None]
        if fines:
            self.assertIn("contribution_month_covered", fines[0])

    # ---------- Expected contributions ----------
    def test_calculate_expected_contributions_exact_set_within_fy(self):
        current = date(2024, 11, 15)
        expected = [date(2024, 9, 1), date(2024, 10, 1), date(2024, 11, 1)]
        self.assertEqual(
            self.ledger.calculate_expected_contributions(current), expected
        )

    def test_calculate_expected_contributions_cross_fiscal_boundary(self):
        current = date(2025, 2, 5)
        expected = [
            date(2024, 9, 1),
            date(2024, 10, 1),
            date(2024, 11, 1),
            date(2024, 12, 1),
            date(2025, 1, 1),
            date(2025, 2, 1),
        ]
        self.assertEqual(
            self.ledger.calculate_expected_contributions(current), expected
        )

    # ---------- Chronological backfill ----------
    def test_process_payment_backfills_and_copies_reference(self):
        self.ledger.process_payment(
            make_lumpsum(
                self.member_id,
                "1500.00",
                contrib_month=date(2024, 9, 1),
                contrib_date=datetime(2024, 9, 15),
            )
        )
        # Payment on Dec 15, 2024. Pays for Oct and Nov arrears.
        res = self.ledger.process_payment(
            make_lumpsum(
                self.member_id,
                "3000.00",
                contrib_month=date(2024, 12, 1),
                ref="REF-DEC",
                contrib_date=datetime(2024, 12, 15),
            )
        )
        months = [
            r["contribution_month"]
            for r in res
            if r.get("contribution_month") is not None
        ]
        self.assertEqual(months, [date(2024, 10, 1), date(2024, 11, 1)])
        for r in res:
            if r.get("contribution_month"):
                self.assertEqual(r["payment_Reference_Code"], "REF-DEC")

    # ---------- Anchor Month Allocation (CORRECTED for Spillover) ----------
    def test_anchor_month_allocation_after_arrears(self):
        """
        [CORRECTED TEST] Ensures arrears are cleared first, then the anchor month is funded,
        and finally, any surplus funds (residual) are allocated to subsequent months.
        """
        # 1) Pre-populate paid months up to Dec 2024 (so Jan+Feb 2025 are in arrears)
        paid_months = [
            date(2024, 9, 1),
            date(2024, 10, 1),
            date(2024, 11, 1),
            date(2024, 12, 1),
        ]
        for m in paid_months:
            self.ledger.contribution_history.append(
                make_monthly_record(self.member_id, "1500.00", m)
            )

        # 2) Lumpsum on Mar 15, 2025 anchored to March 2025.
        # Amount: 6000.00 (3000 arrears + 1500 anchor + 1500 residual)
        lump = make_lumpsum(
            self.member_id,
            "6000.00",
            contrib_month=date(2025, 3, 1),  # anchor month
            contrib_date=datetime(2025, 3, 15),
            ref="REF-ANCHOR",
        )
        result = self.ledger.process_payment(lump)

        monthly = [r for r in result if r.get("contribution_month") is not None]
        # EXPECTATION: Jan 2025, Feb 2025 (arrears), Mar 2025 (anchor), Apr 2025 (spillover).
        expected_months = [
            date(2025, 1, 1),
            date(2025, 2, 1),
            date(2025, 3, 1),
            date(2025, 4, 1),
        ]
        self.assertEqual(
            [m["contribution_month"] for m in monthly],
            expected_months,
            "Surplus must now spill over to the month following the anchor month.",
        )
        # Each monthly allocation should be the monthly amount from the lumpsum (1500.00)
        for m in monthly:
            self.assertEqual(m["amount_paid"], Decimal("1500.00"))
            self.assertEqual(m["payment_Reference_Code"], "REF-ANCHOR")

        # Ensure the original lumpsum is present in contribution_history and marked distributed
        matches = [
            c
            for c in self.ledger.contribution_history
            if c.get("contribution_id") == lump["contribution_id"]
        ]
        self.assertTrue(len(matches) >= 1)
        self.assertTrue(matches[0].get("is_distributed", False))
        # original lumpsum amount stays the same in the stored record
        self.assertEqual(matches[0]["amount_paid"], Decimal("6000.00"))

    # --- NEW TEST CASE FOR FULL SPILLOVER VALIDATION (Assertions Aligned with Specification) ---
    def test_payment_more_than_anchor_spills_to_subsequent_months(self):
        """
        Tests the spillover functionality: payment clears arrears, funds anchor,
        and remaining balance continues to fund subsequent contribution months.

        Assertions are aligned to check only specified keys in get_contribution_status.
        """
        # 1) Setup: Paid Sep 2024 only. Arrears: Oct, Nov (2 * 1500 = 3000.00).
        self.ledger.contribution_history.append(
            make_monthly_record(self.member_id, "1500.00", date(2024, 9, 1))
        )

        # 2) Lumpsum: 6000.00 anchored to Dec 2024.
        # Allocation breakdown (1500 each): Oct, Nov, Dec, Jan
        lump = make_lumpsum(
            self.member_id,
            "6000.00",
            contrib_month=date(2024, 12, 1),  # Anchor month
            contrib_date=datetime(2024, 12, 15),
            ref="REF-SPILL-MULTI",
        )
        result = self.ledger.process_payment(lump)

        monthly = [r for r in result if r.get("contribution_month") is not None]

        # Check that four months were covered
        self.assertEqual(
            len(monthly),
            4,
            "Expected 4 contribution months covered (2 arrears + Anchor + 1 spillover).",
        )

        # Check the months covered are Oct, Nov, Dec, Jan in correct chronological order
        expected_months = [
            date(2024, 10, 1),
            date(2024, 11, 1),
            date(2024, 12, 1),
            date(2025, 1, 1),
        ]
        actual_months = [m["contribution_month"] for m in monthly]
        self.assertEqual(actual_months, expected_months)

        # Check that the remaining status shows no arrears up to Jan 2025
        status_feb = self.ledger.get_contribution_status(date(2025, 2, 1))
        self.assertEqual(
            status_feb["arrears_months"],
            0,
            "All payments up to Jan 2025 should be cleared.",
        )
        self.assertEqual(
            status_feb["arrears_amount"],
            Decimal("0.00"),
            "Arrears amount must be 0.00.",
        )

    # ---------- NEW TESTS FOR RESIDUAL BALANCE AND FINE CREATION LOGIC (UPDATED) ----------

    def test_lumpsum_residual_balance_creates_partial_anchor(self):
        """
        A lumpsum payment clears arrears. If a residual balance remains,
        it is applied as a partial payment to the anchor month.

        Setup: Paid month DEC 2024 only; Sep/Oct are missing (they are arrears)
        Lumpsum: 3100 -> covers Sep + Oct (2*1500=3000) + residual 100 applied to anchor month Nov
        """
        # Setup: Paid month Dec 2024 only; Sep/Oct are missing (they are arrears)
        # Note: using Dec (not Nov) as an already-paid month so the anchor (Nov) is available for a partial.
        self.ledger.contribution_history.append(
            make_monthly_record(self.member_id, "1500.00", date(2024, 12, 1))
        )

        # Lumpsum: 3100 -> covers Sep + Oct (2*1500=3000) + residual 100 applied to anchor month Nov
        lump = make_lumpsum(
            self.member_id,
            "3100.00",
            contrib_month=date(2024, 11, 1),  # anchor is Nov 2024
            contrib_date=datetime(2024, 11, 15),
            ref="RESIDUAL",
        )
        result = self.ledger.process_payment(lump)

        monthly = [r for r in result if r.get("contribution_month") is not None]
        # Expect three records: Sep, Oct (full), Nov (partial with residual)
        self.assertEqual(len(monthly), 3)

        sep_record = next(r for r in monthly if r["contribution_month"] == date(2024, 9, 1))
        oct_record = next(r for r in monthly if r["contribution_month"] == date(2024, 10, 1))
        nov_record = next(
            r for r in monthly
            if r["contribution_month"] == date(2024, 11, 1) and r["is_lumpsum"] is False
        )

        self.assertEqual(sep_record["amount_paid"], Decimal("1500.00"))
        self.assertEqual(oct_record["amount_paid"], Decimal("1500.00"))
        self.assertEqual(nov_record["amount_paid"], Decimal("100.00"))  # partial anchor month

        # Ensure original lumpsum is marked distributed and original amount retained
        lump_record = next(
            c for c in self.ledger.contribution_history
            if c["contribution_id"] == lump["contribution_id"]
        )
        self.assertTrue(lump_record["is_distributed"])
        self.assertEqual(lump_record["amount_paid"], Decimal("3100.00"))


    def test_fine_creation_after_existing_fine_paid(self):
        """
        Process a payment that clears an existing unpaid fine and triggers a new fine.
        The existing fine must be updated (is_paid True), a new fine record must be created,
        and both affected entries must be included in the returned list.
        """
        # Existing fine for Jan 2025 (unpaid)
        existing_fine = make_fine_record(
            self.member_id,
            "100.00",
            "0.00",
            date(2025, 1, 1),
            fine_date=date(2025, 1, 2),
            is_paid=False,
        )
        self.ledger.fine_history.append(existing_fine)

        # Payment covers old fine + new fine (100 + 100 = 200)
        # Use a processing date in Feb 2025 to cause a new accrued fine for Feb 2025
        lump = make_lumpsum(
            self.member_id,
            "200.00",
            contrib_month=date(2025, 2, 1),
            contrib_date=datetime(2025, 2, 2),
            ref="FINE-TEST",
        )
        result = self.ledger.process_payment(lump)

        # Both modified and created fine records returned
        fines = [r for r in result if r.get("amount") is not None]
        # Expect two fine-related entries: the updated existing fine and the newly created fine for Feb 2025
        self.assertEqual(len(fines), 2)

        paid_existing = [
            f for f in fines if f["contribution_month_covered"] == date(2025, 1, 1)
        ]
        new_fine = [
            f for f in fines if f["contribution_month_covered"] == date(2025, 2, 1)
        ]

        self.assertTrue(
            paid_existing and new_fine,
            "Both existing and new fine records must be present in results.",
        )
        # Existing fine must be fully paid
        self.assertTrue(
            paid_existing[0]["is_paid"], "Existing fine should be marked paid."
        )
        self.assertEqual(paid_existing[0]["amount_paid"], Decimal("100.00"))
        # New fine is created and fully paid by the residual amount in this scenario
        self.assertEqual(new_fine[0]["amount_paid"], Decimal("100.00"))
        self.assertTrue(
            new_fine[0]["is_paid"],
            "New fine should be marked paid because payment covered it.",
        )

    def test_anchor_month_allocation_respects_distribution_limit(self):
        """
        Lumpsum payment should distribute to arrears first, then start at anchor month,
        but must stop once all funds are allocated (no spillover is expected here because the amount is exactly 3 months).
        """
        # Paid months up to Dec 2024
        for m in [
            date(2024, 9, 1),
            date(2024, 10, 1),
            date(2024, 11, 1),
            date(2024, 12, 1),
        ]:
            self.ledger.contribution_history.append(
                make_monthly_record(self.member_id, "1500.00", m)
            )

        # Lumpsum: 4500 -> covers Jan+Feb arrears (3000) + 1 extra monthly contribution (1500) for anchor Mar
        lump = make_lumpsum(
            self.member_id,
            "4500.00",
            contrib_month=date(2025, 3, 1),
            contrib_date=datetime(2025, 3, 15),
            ref="ANCHOR-LIMIT",
        )
        result = self.ledger.process_payment(lump)

        monthly = [r for r in result if r.get("contribution_month") is not None]
        # Expect exactly 3 months covered: Jan, Feb, Mar (4500.00 total)
        self.assertEqual(
            [m["contribution_month"] for m in monthly],
            [date(2025, 1, 1), date(2025, 2, 1), date(2025, 3, 1)],
        )
        self.assertEqual(sum(r["amount_paid"] for r in monthly), Decimal("4500.00"))


if __name__ == "__main__":
    unittest.main()
