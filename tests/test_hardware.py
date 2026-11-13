from contextlib import nullcontext

import pytest
import torch

from scripts import hardware


@pytest.fixture
def machine(monkeypatch):
    """machine(cuda=..., mps=..., gpu_generation=...) fakes the hardware; TORCH_DEVICE is unset"""
    monkeypatch.delenv("TORCH_DEVICE", raising=False)

    def fake(cuda=False, mps=False, gpu_generation=8):
        monkeypatch.setattr(hardware.torch.cuda, "is_available", lambda: cuda)
        monkeypatch.setattr(hardware.torch.backends.mps, "is_available", lambda: mps)
        monkeypatch.setattr(hardware.torch.cuda, "get_device_capability", lambda: (gpu_generation, 0))
    return fake


def test_device_prefers_nvidia_then_apple_then_cpu(machine):
    machine(cuda=True, mps=True)
    assert hardware.device() == "cuda"
    machine(mps=True)
    assert hardware.device() == "mps"
    machine()
    assert hardware.device() == "cpu"


def test_torch_device_forces_a_device(machine, monkeypatch):
    machine(cuda=True)
    monkeypatch.setenv("TORCH_DEVICE", " CPU ")
    assert hardware.device() == "cpu"
    monkeypatch.setenv("TORCH_DEVICE", "mps")
    with pytest.raises(RuntimeError, match="no mps device"):
        hardware.device()
    monkeypatch.setenv("TORCH_DEVICE", "tpu")
    with pytest.raises(ValueError, match="must be one of"):
        hardware.device()


def test_mixed_precision_only_on_nvidia(machine, monkeypatch):
    machine(cuda=True, gpu_generation=8)  # RTX 30xx / A100 and newer
    assert hardware.amp_dtype("cuda") == torch.bfloat16
    machine(cuda=True, gpu_generation=7)  # e.g. a T4 or an RTX 20xx
    assert hardware.amp_dtype("cuda") == torch.float16
    assert hardware.precision("cuda") == "fp16"
    assert hardware.amp_dtype("mps") is None and hardware.amp_dtype("cpu") is None
    assert hardware.precision("cpu") == "fp32"
    monkeypatch.setattr(hardware, "MIXED_PRECISION", False)
    assert hardware.amp_dtype("cuda") is None


def test_autocast_is_a_no_op_without_a_dtype():
    assert isinstance(hardware.autocast("cpu", None), nullcontext)
    assert hardware.info("cpu")["device"] == "cpu"
