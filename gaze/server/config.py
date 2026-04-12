import os
from dotenv import load_dotenv

# Load .env file if present (local dev). On Vercel, env vars are set in the dashboard.
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

HOST = os.getenv("GAZE_HOST", "0.0.0.0")
PORT = int(os.getenv("GAZE_PORT", "8000"))

# Default courts if none exist in DB (used by seed script only now)
DEFAULT_COURTS = [
    {"court_id": f"court-{i}", "name": f"Court {i}"} for i in range(1, 9)
]
