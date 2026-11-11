"""
Earth Engine authentication.

Tries a service account (production / FastAPI backend) first, falls back
to locally cached interactive credentials (dev). This lets the same
pipeline code run unchanged on a laptop and in a server environment.
"""

import os
import ee


def initialize_earth_engine() -> None:
    """Initialize the Earth Engine client. Call once at process start.

    As of recent earthengine-api versions, Google requires every
    Initialize() call — interactive or service account — to be
    associated with a GCP project that has the Earth Engine API enabled.
    Set GEE_PROJECT_ID (or pass one through) or calls will fail with
    'no project found'.
    """
    key_path = os.environ.get("GEE_SERVICE_ACCOUNT_KEY")
    account_email = os.environ.get("GEE_SERVICE_ACCOUNT_EMAIL")
    project_id = os.environ.get("GEE_PROJECT_ID")

    if not project_id:
        raise RuntimeError(
            "GEE_PROJECT_ID is not set. Earth Engine now requires a GCP "
            "project id on every Initialize() call. Set it with:\n"
            "  PowerShell:  $env:GEE_PROJECT_ID='your-gcp-project-id'\n"
            "  bash:        export GEE_PROJECT_ID=your-gcp-project-id\n"
            "Find your project id at https://console.cloud.google.com/ "
            "(top-left project dropdown) — it must have the Earth Engine "
            "API enabled."
        )

    if key_path and account_email:
        credentials = ee.ServiceAccountCredentials(account_email, key_path)
        ee.Initialize(credentials, project=project_id)
        print(f"[gee_auth] Initialized with service account: {account_email} "
              f"(project={project_id})")
        return

    try:
        ee.Initialize(project=project_id)
        print(f"[gee_auth] Initialized with cached interactive credentials "
              f"(project={project_id}).")
    except Exception as exc:
        raise RuntimeError(
            "Earth Engine initialization failed. Run `earthengine authenticate` "
            "for local dev, or set GEE_SERVICE_ACCOUNT_KEY and "
            "GEE_SERVICE_ACCOUNT_EMAIL for production use. Also confirm "
            f"GEE_PROJECT_ID='{project_id}' has the Earth Engine API enabled "
            "in Google Cloud Console."
        ) from exc