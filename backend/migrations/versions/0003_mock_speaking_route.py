"""mock-exam speaking can use the practice model

Revision ID: 0003
Revises: 0002
"""
import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("user_settings") as b:
        b.add_column(sa.Column("mock_model_for_speaking", sa.Boolean(), nullable=False, server_default="0"))


def downgrade() -> None:
    with op.batch_alter_table("user_settings") as b:
        b.drop_column("mock_model_for_speaking")
