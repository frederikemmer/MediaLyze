from datetime import datetime

from pydantic import BaseModel, ConfigDict

from backend.app.models.entities import JobStatus


class ScanRequest(BaseModel):
    scan_type: str = "incremental"


class ScanJobRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    library_id: int
    library_name: str | None = None
    status: JobStatus
    job_type: str
    files_total: int
    files_scanned: int
    errors: int
    started_at: datetime | None
    finished_at: datetime | None
    progress_percent: float = 0.0
    phase_label: str = "queued"
    phase_detail: str | None = None


class ScanCancelResponse(BaseModel):
    canceled_jobs: int
