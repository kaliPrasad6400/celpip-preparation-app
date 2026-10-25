"""separate AI provider/model for mock exams

Revision ID: 0002
Revises: 0001
"""
import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("user_settings") as b:
        b.add_column(sa.Column("mock_ai_provider", sa.String(20), nullable=False, server_default="anthropic"))
        b.add_column(sa.Column("mock_ai_model", sa.String(80), nullable=False, server_default="claude-opus-5-5"))


def downgrade() -> None:
    with op.batch_alter_table("user_settings") as b:
        b.drop_column("mock_ai_model")
        b.drop_column("mock_ai_provider")
