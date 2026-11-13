"""FinMLOps model pipeline."""

import os

# Apple Silicon: run the few PyTorch operations the Mac GPU (mps) doesn't support on the CPU instead of crashing.
# It has to be set before torch is imported, which is why it lives here; it does nothing on other machines.
os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
