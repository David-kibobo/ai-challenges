import unittest
from decimal import Decimal
from datetime import date, datetime
import uuid


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

    if m.month >= 9:
        return f"{m.year}/{m.year + 1}"
    else:
        return f"{m.year - 1}/{m.year}"


class TestSaccoLedgerManagerFinalized(unittest.TestCase):
    def setUp(self):
        self.member_id = str(uuid.uuid4())
        self.ledger = SaccoLedgerManager(member_id=self.member_id)

    def test_group_year_calculation_fiscal_rollover(self):
        lump_aug = make_lumpsum(
            self.member_id,
            "1500.00",
            contrib_month=date(2025, 8, 1),
            contrib_date=datetime(2025, 8, 15),
        )
        result_aug = self.ledger.process_payment(lump_aug)
        aug_monthly = [
            r for r in result_aug if r.get("contribution_month") == date(2025, 8, 1)
        ]
        self.assertTrue(
            aug_monthly,
        )
        self.assertEqual(
            aug_monthly[0]["group_year"],
            "2024/2025",
        )

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
        self.assertTrue(
            len(sep_monthly_records) >= 1,
        )
        for r in sep_monthly_records:
            m = r["contribution_month"]
            expected = expected_group_year_for_month(m)
            self.assertEqual(
                r["group_year"], expected, f"Group year for {m} should be {expected}."
            )

    def test_monetary_immutability_after_fee_change(self):

        original_fee = Decimal("1500.00")
        new_fee = Decimal("2000.00")

        p1_month = date(2024, 9, 1)
        p1 = make_lumpsum(
            self.member_id,
            "1500.00",
            contrib_date=datetime(2024, 9, 15),
            monthly_amount=str(original_fee),
        )
        self.ledger.process_payment(p1)

        p2_month = date(2024, 10, 1)
        p2 = make_lumpsum(
            self.member_id,
            "2000.00",
            contrib_month=p2_month,
            contrib_date=datetime(2024, 10, 15),
            monthly_amount=str(new_fee),
        )
        self.ledger.process_payment(p2)

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

        self.assertEqual(sep_record["monthly_contribution_amount"], original_fee)
        self.assertEqual(oct_record["monthly_contribution_amount"], new_fee)

    def test_undistributed_lumpsum_ignored_in_arrears(self):

        undistributed_lump = make_lumpsum(
            self.member_id,
            "1500.00",
            contrib_month=date(2024, 9, 1),
            contrib_date=datetime(2024, 9, 15),
            is_distributed=False,
        )
        self.ledger.contribution_history.append(undistributed_lump)

        status_nov = self.ledger.get_contribution_status(date(2024, 11, 15))
        self.assertEqual(status_nov["arrears_months"], 3)
        self.assertEqual(status_nov["arrears_amount"], Decimal("4500.00"))

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

        status_nov = ledger.get_contribution_status(date(2024, 11, 15))
        self.assertEqual(status_nov["arrears_months"], 1)
        self.assertEqual(status_nov["arrears_amount"], Decimal("1500.00"))
        self.assertEqual(len(ledger.fine_history), 1)
        self.assertEqual(
            ledger.fine_history[0]["contribution_month_covered"], date(2025, 1, 1)
        )

    def test_status_with_partial_payment(self):

        self.ledger.process_payment(
            make_lumpsum(
                self.member_id,
                "1500.00",
                contrib_month=date(2024, 9, 1),
                contrib_date=datetime(2024, 9, 15),
            )
        )
        self.ledger.process_payment(
            make_lumpsum(
                self.member_id,
                "1500.00",
                contrib_month=date(2024, 10, 1),
                contrib_date=datetime(2024, 10, 15),
            )
        )
        self.ledger.process_payment(
            make_lumpsum(
                self.member_id,
                "100.00",
                contrib_month=date(2024, 12, 1),
                contrib_date=datetime(2024, 12, 15),
            )
        )
        self.ledger.process_payment(
            make_lumpsum(
                self.member_id,
                "1500.00",
                contrib_month=date(2025, 1, 1),
                contrib_date=datetime(2025, 1, 15),
            )
        )
        self.ledger.process_payment(
            make_lumpsum(
                self.member_id,
                "1500.00",
                contrib_month=date(2025, 2, 1),
                contrib_date=datetime(2025, 2, 15),
            )
        )
        self.ledger.process_payment(
            make_lumpsum(
                self.member_id,
                "500.00",
                contrib_month=date(2025, 3, 1),
                contrib_date=datetime(2025, 3, 15),
            )
        )

        status = self.ledger.get_contribution_status(date(2025, 4, 15))

        expected_arrears_months = 4
        expected_arrears_amount = Decimal("5400.00")

        expected_total_paid = Decimal("6600.00")

        assert status["arrears_months"] == expected_arrears_months
        assert status["arrears_amount"] == expected_arrears_amount
        assert status["total_contribution_paid"] == expected_total_paid

    def test_status_ignores_distributed_lumpsums(self):

        self.ledger.contribution_history.append(
            make_monthly_record(self.member_id, "1500.00", date(2025, 1, 1))
        )
        self.ledger.contribution_history.append(
            make_monthly_record(self.member_id, "1500.00", date(2025, 2, 1))
        )
        self.ledger.contribution_history.append(
            make_monthly_record(self.member_id, "1500.00", date(2025, 3, 1))
        )

        processed_lumpsum = make_lumpsum(
            self.member_id,
            "4500.00",
            contrib_month=date(2025, 3, 1),
            contrib_date=datetime(2025, 3, 15),
            is_distributed=True,
        )
        self.ledger.contribution_history.append(processed_lumpsum)

        status = self.ledger.get_contribution_status(date(2025, 4, 1))

        self.assertEqual(status["arrears_months"], 0, "Arrears months should be 0.")
        self.assertEqual(
            status["arrears_amount"], Decimal("0.00"), "Arrears amount should be 0.00."
        )

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

    def test_no_fine_within_grace_period(self):

        self.ledger.process_payment(
            make_lumpsum(
                self.member_id,
                "1500.00",
                contrib_month=date(2024, 9, 1),
                contrib_date=datetime(2024, 9, 15),
            )
        )

        status_oct = self.ledger.get_contribution_status(date(2024, 10, 1))
        self.assertEqual(status_oct["total_fines"], Decimal("0.00"))

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

        self.ledger.process_payment(
            make_lumpsum(
                self.member_id,
                "1500.00",
                contrib_month=date(2024, 9, 1),
                contrib_date=datetime(2024, 9, 15),
            )
        )

        status_jan = self.ledger.get_contribution_status(date(2025, 1, 1))

        self.assertEqual(status_jan["total_fines"], Decimal("0.00"))

        status_feb = self.ledger.get_contribution_status(date(2025, 2, 1))
        self.assertEqual(status_feb["total_fines"], Decimal("0.00"))

    def test_fine_resumes_from_last_fine_record_not_grace_period(self):

        self.ledger.process_payment(
            make_lumpsum(
                self.member_id,
                "1500.00",
                contrib_month=date(2024, 9, 1),
                contrib_date=datetime(2024, 9, 15),
            )
        )

        self.ledger.process_payment(
            make_lumpsum(
                self.member_id,
                "100.00",
                contrib_month=date(2025, 1, 1),
                contrib_date=datetime(2025, 1, 15),
            )
        )

        status_feb = self.ledger.get_contribution_status(date(2025, 2, 1))
        self.assertEqual(status_feb["total_fines"], Decimal("0.00"))

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

    def test_payment_less_than_total_fine_partial(self):

        self.ledger.process_payment(
            make_lumpsum(
                self.member_id,
                "1500.00",
                contrib_month=date(2024, 9, 1),
                contrib_date=datetime(2024, 9, 15),
            )
        )

        small = make_lumpsum(
            self.member_id,
            "50.00",
            contrib_month=date(2025, 1, 1),
            contrib_date=datetime(2025, 1, 15),
        )
        self.ledger.process_payment(small)
        total_paid = sum(f["amount_paid"] for f in self.ledger.fine_history)

        self.assertEqual(total_paid, Decimal("50.00"))

    def test_payment_equal_to_total_fine_only(self):

        self.ledger.process_payment(
            make_lumpsum(
                self.member_id,
                "1500.00",
                contrib_month=date(2024, 9, 1),
                contrib_date=datetime(2024, 9, 15),
            )
        )

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

        self.ledger.process_payment(
            make_lumpsum(
                self.member_id,
                "1500.00",
                contrib_month=date(2024, 9, 1),
                contrib_date=datetime(2024, 9, 15),
            )
        )

        amount = Decimal("1600.00")

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

        self.assertEqual(len(monthly), 1)
        self.assertEqual(monthly[0]["contribution_month"], date(2024, 10, 1))
        self.assertEqual(monthly[0]["amount_paid"], Decimal("1500.00"))
        self.assertEqual(monthly[0]["payment_Reference_Code"], "REF-SPILL")

    def test_partial_monthly_contribution(self):

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

    def test_process_payment_backfills_and_copies_reference(self):
        self.ledger.process_payment(
            make_lumpsum(
                self.member_id,
                "1500.00",
                contrib_month=date(2024, 9, 1),
                contrib_date=datetime(2024, 9, 15),
            )
        )

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

    def test_anchor_month_allocation_after_arrears(self):

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

        lump = make_lumpsum(
            self.member_id,
            "6000.00",
            contrib_month=date(2025, 3, 1),
            contrib_date=datetime(2025, 3, 15),
            ref="REF-ANCHOR",
        )
        result = self.ledger.process_payment(lump)

        monthly = [r for r in result if r.get("contribution_month") is not None]

        expected_months = [
            date(2025, 1, 1),
            date(2025, 2, 1),
            date(2025, 3, 1),
            date(2025, 4, 1),
        ]
        self.assertEqual(
            [m["contribution_month"] for m in monthly],
            expected_months,
        )

        for m in monthly:
            self.assertEqual(m["amount_paid"], Decimal("1500.00"))
            self.assertEqual(m["payment_Reference_Code"], "REF-ANCHOR")

        matches = [
            c
            for c in self.ledger.contribution_history
            if c.get("contribution_id") == lump["contribution_id"]
        ]
        self.assertTrue(len(matches) >= 1)
        self.assertTrue(matches[0].get("is_distributed", False))

        self.assertEqual(matches[0]["amount_paid"], Decimal("6000.00"))

    def test_payment_more_than_anchor_spills_to_subsequent_months(self):

        self.ledger.contribution_history.append(
            make_monthly_record(self.member_id, "1500.00", date(2024, 9, 1))
        )

        lump = make_lumpsum(
            self.member_id,
            "6000.00",
            contrib_month=date(2024, 12, 1),
            contrib_date=datetime(2024, 12, 15),
            ref="REF-SPILL-MULTI",
        )
        result = self.ledger.process_payment(lump)

        monthly = [r for r in result if r.get("contribution_month") is not None]

        self.assertEqual(
            len(monthly),
            4,
        )

        expected_months = [
            date(2024, 10, 1),
            date(2024, 11, 1),
            date(2024, 12, 1),
            date(2025, 1, 1),
        ]
        actual_months = [m["contribution_month"] for m in monthly]
        self.assertEqual(actual_months, expected_months)

        status_feb = self.ledger.get_contribution_status(date(2025, 2, 1))
        self.assertEqual(
            status_feb["arrears_months"],
            0,
        )
        self.assertEqual(
            status_feb["arrears_amount"],
            Decimal("0.00"),
        )

    def test_lumpsum_residual_balance_creates_partial_anchor(self):

        self.ledger.contribution_history.append(
            make_monthly_record(self.member_id, "1500.00", date(2024, 12, 1))
        )

        lump = make_lumpsum(
            self.member_id,
            "3100.00",
            contrib_month=date(2024, 11, 1),
            contrib_date=datetime(2024, 11, 15),
            ref="RESIDUAL",
        )
        result = self.ledger.process_payment(lump)

        monthly = [r for r in result if r.get("contribution_month") is not None]

        self.assertEqual(len(monthly), 3)

        sep_record = next(
            r for r in monthly if r["contribution_month"] == date(2024, 9, 1)
        )
        oct_record = next(
            r for r in monthly if r["contribution_month"] == date(2024, 10, 1)
        )
        nov_record = next(
            r
            for r in monthly
            if r["contribution_month"] == date(2024, 11, 1) and r["is_lumpsum"] is False
        )

        self.assertEqual(sep_record["amount_paid"], Decimal("1500.00"))
        self.assertEqual(oct_record["amount_paid"], Decimal("1500.00"))
        self.assertEqual(nov_record["amount_paid"], Decimal("100.00"))

        lump_record = next(
            c
            for c in self.ledger.contribution_history
            if c["contribution_id"] == lump["contribution_id"]
        )
        self.assertTrue(lump_record["is_distributed"])
        self.assertEqual(lump_record["amount_paid"], Decimal("3100.00"))

    def test_fine_creation_after_existing_fine_paid(self):

        existing_fine = make_fine_record(
            self.member_id,
            "100.00",
            "0.00",
            date(2025, 1, 1),
            fine_date=date(2025, 1, 2),
            is_paid=False,
        )
        self.ledger.fine_history.append(existing_fine)

        lump = make_lumpsum(
            self.member_id,
            "200.00",
            contrib_month=date(2025, 2, 1),
            contrib_date=datetime(2025, 2, 2),
            ref="FINE-TEST",
        )
        result = self.ledger.process_payment(lump)

        fines = [r for r in result if r.get("amount") is not None]

        self.assertEqual(len(fines), 2)

        paid_existing = [
            f for f in fines if f["contribution_month_covered"] == date(2025, 1, 1)
        ]
        new_fine = [
            f for f in fines if f["contribution_month_covered"] == date(2025, 2, 1)
        ]

        self.assertTrue(
            paid_existing and new_fine,
        )

        self.assertTrue(
            paid_existing[0]["is_paid"],
        )
        self.assertEqual(paid_existing[0]["amount_paid"], Decimal("100.00"))

        self.assertEqual(new_fine[0]["amount_paid"], Decimal("100.00"))
        self.assertTrue(
            new_fine[0]["is_paid"],
        )

    def test_anchor_month_allocation_respects_distribution_limit(self):

        for m in [
            date(2024, 9, 1),
            date(2024, 10, 1),
            date(2024, 11, 1),
            date(2024, 12, 1),
        ]:
            self.ledger.contribution_history.append(
                make_monthly_record(self.member_id, "1500.00", m)
            )

        lump = make_lumpsum(
            self.member_id,
            "4500.00",
            contrib_month=date(2025, 3, 1),
            contrib_date=datetime(2025, 3, 15),
            ref="ANCHOR-LIMIT",
        )
        result = self.ledger.process_payment(lump)

        monthly = [r for r in result if r.get("contribution_month") is not None]

        self.assertEqual(
            [m["contribution_month"] for m in monthly],
            [date(2025, 1, 1), date(2025, 2, 1), date(2025, 3, 1)],
        )
        self.assertEqual(sum(r["amount_paid"] for r in monthly), Decimal("4500.00"))


if __name__ == "__main__":
    unittest.main()
