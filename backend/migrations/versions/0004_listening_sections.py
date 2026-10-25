"""assign Listening Part 1 items to their audio sections (starter content)

Revision ID: 0004
Revises: 0003
"""
import json

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None

SECTIONS = {
    "L1 · The Apartment with No Heat": [1, 1, 1, 2, 2, 2, 3, 3],
    "L1 · Storage Space for the Winter Coat Drive": [1, 1, 1, 2, 2, 2, 3, 3],
    "L1 · The Delayed Shipment to Saskatoon": [1, 1, 2, 2, 2, 2, 3, 3],
}


def upgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, title, items FROM practice_questions WHERE task_type = 'L1'")).fetchall()
    for qid, title, items in rows:
        plan = SECTIONS.get(title)
        if not plan:
            continue
        data = json.loads(items) if isinstance(items, str) else items
        for it, sec in zip(data, plan):
            it["section"] = sec
        conn.execute(sa.text("UPDATE practice_questions SET items = :i WHERE id = :id"), {"i": json.dumps(data), "id": qid})


def downgrade() -> None:
    pass
