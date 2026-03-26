"""Repair engine — four-level escalation for failed analysis steps.

Tier 0: RepairMemory recall (known human fix for this error class)
  - Deterministic application of a previously successful human repair
  - Matched by (step_type, error_signature) hash

Level 1: Rule-based repair (deterministic, no LLM)
  - mkdir -p for missing output directories
  - Thread/memory reduction for OOM errors
  - Missing samtools index auto-generation

Level 2: Constrained LLM repair
  - Only adjusts numeric params or paths
  - Validates that response diff does not change tool name or add commands
  - Falls through to Level 3 on rejection

Level 3: Human escalation
  - Creates RepairRequest DB record with structured choices
  - Sets step to waiting_for_human_repair
  - Successful human fixes are written to RepairMemory for future Tier-0 reuse
"""
from tune.core.repair.engine import RepairResult, RepairAction, attempt_repair

__all__ = ["RepairResult", "RepairAction", "attempt_repair"]
