"""Step type registry package."""
from __future__ import annotations

import importlib

_REQUIRED_STEP_TYPES = {
    "align.hisat2",
    "align.star",
    "qc.fastqc",
    "qc.multiqc",
    "quant.featurecounts",
    "stats.deseq2",
    "trim.fastp",
    "util.hisat2_build",
    "util.samtools_index",
    "util.samtools_sort",
    "util.star_genome_generate",
}


def _bind_exports(steps_module) -> None:
    globals().update(
        {
            "StepTypeDefinition": steps_module.StepTypeDefinition,
            "SlotDefinition": steps_module.SlotDefinition,
            "RepairPolicy": steps_module.RepairPolicy,
            "FanoutMode": steps_module.FanoutMode,
            "SafetyPolicy": steps_module.SafetyPolicy,
            "get_step_type": steps_module.get_step_type,
            "all_step_types": steps_module.all_step_types,
            "register": steps_module.register,
        }
    )


def ensure_registry_loaded() -> None:
    """Ensure built-in step types are present even after unusual import ordering."""
    steps_module = importlib.import_module("tune.core.registry.steps")
    if not _REQUIRED_STEP_TYPES.issubset(set(steps_module.all_step_types())):
        steps_module = importlib.reload(steps_module)
    _bind_exports(steps_module)


_bind_exports(importlib.import_module("tune.core.registry.steps"))

__all__ = [
    "StepTypeDefinition",
    "SlotDefinition",
    "RepairPolicy",
    "FanoutMode",
    "SafetyPolicy",
    "get_step_type",
    "all_step_types",
    "register",
    "ensure_registry_loaded",
]
