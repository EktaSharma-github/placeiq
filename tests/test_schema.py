"""Structural tests: the database contains what the design says it does."""

from conftest import scalar


def test_table_count(db):
    """TC-SCH-01 | Design | The schema contains exactly the 22 designed tables, plus the 2 analytics tables"""
    names = {r["table_name"] for r in db.execute("""SELECT table_name FROM information_schema.tables
                      WHERE table_schema = 'placeiq' AND table_type = 'BASE TABLE'""")}
    assert names >= {"segment", "student_segment"}
    assert len(names - {"segment", "student_segment"}) == 22


def test_every_table_has_primary_key(db):
    """TC-SCH-02 | Entity integrity | Every table has a primary key"""
    missing = db.execute("""
        SELECT c.relname FROM pg_class c
        WHERE c.relnamespace = 'placeiq'::regnamespace AND c.relkind = 'r'
          AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = c.oid AND k.contype = 'p')
    """).fetchall()
    assert missing == []


def test_foreign_keys_present(db):
    """TC-SCH-03 | Referential integrity | All 30 designed foreign keys exist, plus 2 on the analytics tables
    Includes the composite FKs used for disjointness, the sponsor category,
    the recruiter-company consistency rule and the interview aggregation."""
    n = scalar(db, "SELECT count(*) FROM pg_constraint WHERE contype = 'f' "
                   "AND connamespace = 'placeiq'::regnamespace "
                   "AND conrelid <> 'placeiq.student_segment'::regclass")
    assert n == 30
    assert scalar(db, "SELECT count(*) FROM pg_constraint WHERE contype = 'f' "
                      "AND conrelid = 'placeiq.student_segment'::regclass") == 2


def test_foreign_keys_are_indexed(db):
    """TC-SCH-04 | Physical design | Every foreign key is backed by an index that can find its rows
    PostgreSQL does not index FK columns automatically; an unindexed FK makes
    joins and ON DELETE checks scan the whole child table. Covered means: an
    index whose leading columns are exactly the FK columns, or a UNIQUE index
    on a leading subset of them (e.g. PK job_id covers FK (job_id, role_type))."""
    unindexed = db.execute("""
        SELECT c.conname
        FROM pg_constraint c
        WHERE c.contype = 'f' AND c.connamespace = 'placeiq'::regnamespace
          AND NOT EXISTS (
              SELECT 1 FROM pg_index i
              WHERE i.indrelid = c.conrelid
                AND (   ((i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] @> c.conkey
                     AND (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] <@ c.conkey)
                     OR (i.indisunique
                     AND (i.indkey::int2[])[0] = c.conkey[1]
                     AND (i.indkey::int2[])[0:i.indnkeyatts - 1] <@ c.conkey)))
    """).fetchall()
    assert unindexed == [], f"unindexed FKs: {unindexed}"


def test_check_constraints_present(db):
    """TC-SCH-05 | Domain integrity | At least 40 CHECK constraints guard attribute domains"""
    n = scalar(db, "SELECT count(*) FROM pg_constraint WHERE contype = 'c' "
                   "AND connamespace = 'placeiq'::regnamespace")
    assert n >= 40


def test_exclusion_constraint_present(db):
    """TC-SCH-06 | BR-8 | The interview double-booking EXCLUDE constraint exists"""
    n = scalar(db, "SELECT count(*) FROM pg_constraint WHERE contype = 'x' "
                   "AND conname = 'excl_student_double_booking'")
    assert n == 1


def test_identity_sequences_ahead_of_data(db):
    """TC-SCH-07 | Data load | Identity sequences were advanced past the explicitly inserted ids"""
    for table, column in [("program", "program_id"), ("placement_cycle", "cycle_id"), ("skill", "skill_id"),
                          ("sponsor", "sponsor_id"), ("company", "company_id"), ("person", "person_id"),
                          ("job_role", "job_id")]:
        seq = scalar(db, "SELECT pg_get_serial_sequence(%s, %s)", (f"placeiq.{table}", column))
        last = scalar(db, f"SELECT last_value FROM {seq}")
        max_id = scalar(db, f"SELECT max({column}) FROM {table}")
        assert last >= max_id, f"{table}: sequence {last} behind max id {max_id}"


def test_views_exist(db):
    """TC-SCH-08 | Views | The two operational views and the two analytics views exist"""
    names = {r["table_name"] for r in db.execute(
        "SELECT table_name FROM information_schema.views WHERE table_schema = 'placeiq'")}
    assert names == {"v_job_details", "v_placement_status", "v_student_features", "v_segment_profile"}


def test_triggers_installed(db):
    """TC-SCH-09 | Business logic | All 9 business-rule triggers are installed"""
    names = {r["tgname"] for r in db.execute("""
        SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        WHERE c.relnamespace = 'placeiq'::regnamespace AND NOT t.tgisinternal""")}
    assert names == {
        "trg_application_eligibility", "trg_offer_requires_open_app", "trg_offer_marks_app_offered",
        "trg_offer_accept_guard", "trg_offer_accept_cascade_upd", "trg_offer_accept_cascade_ins",
        "trg_job_total_on_insert", "trg_job_total_on_intern_delete", "trg_job_total_on_fulltime_delete",
    }


def test_routines_installed(db):
    """TC-SCH-10 | Business logic | The stored function and both procedures exist"""
    names = {r["proname"] for r in db.execute(
        "SELECT proname FROM pg_proc WHERE pronamespace = 'placeiq'::regnamespace")}
    assert {"fn_apply_for_job", "sp_accept_offer", "sp_expire_stale_offers"} <= names
