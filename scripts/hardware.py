"""Hardware: the same code runs on an NVIDIA GPU, an Apple Silicon Mac or a plain CPU.

The device is picked automatically (NVIDIA GPU, then Apple Silicon GPU, then CPU). Set TORCH_DEVICE=cpu (or mps,
cuda) in the shell or in .env to force one, for example when the Mac GPU misbehaves.
"""

import gc
import os
from contextlib import nullcontext

import torch

from scripts.config import MIXED_PRECISION

DEVICES = ["cuda", "mps", "cpu"]  # in order of preference


def available(name):
    if name == "cuda":
        return torch.cuda.is_available()
    if name == "mps":
        return torch.backends.mps.is_available()
    return name == "cpu"


def device():
    """cuda (NVIDIA GPU), else mps (Apple Silicon GPU), else cpu; TORCH_DEVICE overrides the choice"""
    forced = os.getenv("TORCH_DEVICE", "").strip().lower()
    if not forced:
        return next(name for name in DEVICES if available(name))
    if forced not in DEVICES:
        raise ValueError(f"TORCH_DEVICE must be one of {DEVICES}, not {forced!r}")
    if not available(forced):
        raise RuntimeError(f"TORCH_DEVICE={forced}, but this machine has no {forced} device")
    return forced


def amp_dtype(device):
    """the mixed-precision type for training, or None for plain fp32.

    bf16 on NVIDIA GPUs from the Ampere generation on (RTX 30xx, A100 and newer): as fast as fp16 and needs no loss
    scaling. fp16 on older NVIDIA GPUs. None on Apple Silicon and CPU, where it is less reliable and barely faster.
    """
    if device != "cuda" or not MIXED_PRECISION:
        return None
    # torch.cuda.is_bf16_supported() also says yes to older GPUs that only emulate bf16 (slowly), so ask directly
    return torch.bfloat16 if torch.cuda.get_device_capability()[0] >= 8 else torch.float16


def precision(device):
    return {torch.bfloat16: "bf16", torch.float16: "fp16", None: "fp32"}[amp_dtype(device)]


def autocast(device, dtype):
    """mixed precision for the forward pass when dtype is set, otherwise a no-op"""
    return torch.autocast(device_type=device, dtype=dtype) if dtype else nullcontext()


def info(device):
    """which hardware a run used, logged as MLflow params"""
    out = {"device": device, "precision": precision(device), "torch_version": torch.__version__}
    if device == "cuda":
        out["gpu"] = torch.cuda.get_device_name(0)
    return out


def free_memory():
    """give cached GPU memory back between models (Optuna trials, champion vs challenger)"""
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    if torch.backends.mps.is_available():
        torch.mps.empty_cache()
