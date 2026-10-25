from __future__ import annotations

import json
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..services import backup

router = APIRouter(prefix="/api/data", tags=["data"])


@router.get("/backups")
def list_backups():
    return backup.list_backups()


@router.post("/backups")
def make_backup():
    p = backup.create_backup("manual")
    return {"name": p.name, "path": str(p)}


@router.get("/backups/{name}")
def download_backup(name: str):
    try:
        p = backup.backup_path(name)
    except FileNotFoundError:
        raise HTTPException(404, "backup not found")
    return FileResponse(p, filename=name, media_type="application/x-sqlite3")


@router.delete("/backups/{name}")
def delete_backup(name: str):
    try:
        backup.backup_path(name).unlink()
    except FileNotFoundError:
        raise HTTPException(404, "backup not found")
    return {"ok": True}


class RestoreIn(BaseModel):
    name: str
    confirm: str


@router.post("/restore")
def restore_named(body: RestoreIn):
    if body.confirm != "RESTORE":
        raise HTTPException(400, "Type RESTORE to confirm.")
    try:
        p = backup.backup_path(body.name)
        safety = backup.restore_from(p)
    except FileNotFoundError:
        raise HTTPException(404, "backup not found")
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True, "safety_backup": safety.name}


@router.post("/restore-upload")
async def restore_upload(file: UploadFile = File(...), confirm: str = ""):
    if confirm != "RESTORE":
        raise HTTPException(400, "Type RESTORE to confirm.")
    data = await file.read()
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tmp:
        tmp.write(data)
        tmp_path = Path(tmp.name)
    try:
        safety = backup.restore_from(tmp_path)
    except ValueError as e:
        raise HTTPException(400, str(e))
    finally:
        tmp_path.unlink(missing_ok=True)
    return {"ok": True, "safety_backup": safety.name}


@router.get("/export.json")
def export_json(db: Session = Depends(get_db)):
    data = backup.export_json(db)
    return Response(
        json.dumps(data, ensure_ascii=False, indent=1),
        media_type="application/json",
        headers={"Content-Disposition": 'attachment; filename="celpip-mastery-export.json"'},
    )


@router.get("/export/{name}.csv")
def export_csv(name: str, db: Session = Depends(get_db)):
    if name not in backup.EXPORTABLE:
        raise HTTPException(404, "unknown export")
    return Response(
        backup.export_csv(db, name),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{name}.csv"'},
    )


@router.get("/exports")
def export_names():
    return list(backup.EXPORTABLE)


class ClearIn(BaseModel):
    confirm: str


@router.post("/clear")
def clear(body: ClearIn):
    if body.confirm != "DELETE ALL MY DATA":
        raise HTTPException(400, "Type DELETE ALL MY DATA to confirm.")
    safety = backup.clear_all_data()
    return {"ok": True, "safety_backup": safety.name}
