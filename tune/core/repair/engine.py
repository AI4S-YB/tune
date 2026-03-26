"""Repair engine implementation: Level 1 (rules) → Level 2 (LLM) → Level 3 (human)."""
from __future__ import annotations

import logging
import os
import re
import shlex
import uuid
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Optional

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


class RepairAction(str, Enum):
    """What the repair engine decided to do."""
    MEMORY_RECALLED = "memory_recalled"        # Tier 0: matched a human repair memory
    APPLIED_RULE = "applied_rule"              # Level 1: rule modified the command
    LLM_REPAIRED = "llm_repaired"              # Level 2: LLM produced a safe repair
    ESCALATED = "escalated"                    # Level 3: human repair request created
    ALREADY_MAX_RETRIES = "max_retries"        # Retry limit hit — go to Level 3 immediately
    NO_ACTION = "no_action"                    # Nothing could be done (e.g. step skipped)


@dataclass
class RepairResult:
    """Outcome returned by attempt_repair()."""
    action: RepairAction
    repaired_command: Optional[str] = None          # non-None if command was modified
    rule_applied: Optional[str] = None              # description of Level-1 rule
    escalation_repair_request_id: Optional[str] = None  # non-None on Level 3
    memory_id: Optional[str] = None                 # non-None on Tier-0 memory hit
    notes: str = ""


# ---------------------------------------------------------------------------
# Level 1 — Deterministic rule set
# ---------------------------------------------------------------------------


def _rule_mkdir_output_dir(command: str, stderr: str, output_dir: str) -> Optional[str]:
    """If stderr mentions a missing directory, prepend mkdir -p."""
    if not re.search(r"No such file or directory|cannot create|mkdir|not found.*dir",
                     stderr, re.IGNORECASE):
        return None

    # Extract all paths that look like output targets from the command
    args = shlex.split(command)
    candidate_dirs: list[str] = []
    for i, arg in enumerate(args):
        # Flags typically followed by a path: -o, -O, --outDir, --outFileNamePrefix, etc.
        if arg in ("-o", "-O", "--outDir", "--outFileNamePrefix", "--output"):
            if i + 1 < len(args):
                p = args[i + 1]
                if p.startswith("/") or p.startswith("./"):
                    candidate_dirs.append(str(Path(p).parent))
        # Also try the output_dir itself
    if output_dir:
        candidate_dirs.append(output_dir)

    if not candidate_dirs:
        return None

    unique_dirs = list(dict.fromkeys(candidate_dirs))  # preserve order, deduplicate
    mkdir_cmd = "mkdir -p " + " ".join(f'"{d}"' for d in unique_dirs)
    return f"{mkdir_cmd} && {command}"


def _rule_samtools_oom(command: str, stderr: str) -> Optional[str]:
    """Reduce samtools thread count and memory-per-thread on OOM errors."""
    if not re.search(r"out of memory|OOM|cannot allocate|bad_alloc|Killed",
                     stderr, re.IGNORECASE):
        return None
    if "samtools" not in command:
        return None

    # Reduce -@ threads
    def _reduce_threads(m: re.Match) -> str:
        val = int(m.group(1))
        return f"-@ {max(1, val // 2)}"

    new_cmd = re.sub(r"-@\s+(\d+)", _reduce_threads, command)

    # Reduce -m memory
    def _reduce_mem(m: re.Match) -> str:
        val = int(m.group(1))
        unit = m.group(2)
        reduced = max(1, val // 2)
        return f"-m {reduced}{unit}"

    new_cmd = re.sub(r"-m\s+(\d+)([MmGg])", _reduce_mem, new_cmd)

    if new_cmd == command:
        return None
    return new_cmd


def _rule_missing_bam_index(command: str, stderr: str, output_dir: str = "") -> Optional[str]:
    """If a BAM index is missing, prepend samtools index to create it."""
    if not re.search(r"\.bai.*not found|index.*missing|no index|bam_index",
                     stderr, re.IGNORECASE):
        return None
    # Find the .bam file referenced in the command
    bam_match = re.search(r"(/[^\s\"']+\.bam)", command)
    if not bam_match:
        return None
    bam_path = bam_match.group(1)
    return f"samtools index {bam_path} && {command}"


_LEVEL1_RULES = [
    ("mkdir_output_dir", _rule_mkdir_output_dir),
    ("samtools_oom", _rule_samtools_oom),
    ("missing_bam_index", _rule_missing_bam_index),
]


def apply_level1_rules(
    command: str,
    stderr: str,
    output_dir: str = "",
) -> tuple[Optional[str], Optional[str]]:
    """Try all Level-1 rules in order.

    Returns (repaired_command, rule_name) or (None, None) if no rule matched.
    """
    for rule_name, rule_fn in _LEVEL1_RULES:
        try:
            if rule_name == "mkdir_output_dir":
                result = rule_fn(command, stderr, output_dir)
            else:
                result = rule_fn(command, stderr)
            if result is not None:
                return result, rule_name
        except Exception:
            log.exception("Level-1 rule '%s' raised an error", rule_name)
    return None, None


# ---------------------------------------------------------------------------
# Level 2 — Constrained LLM repair
# ---------------------------------------------------------------------------


_CONSTRAINED_SYSTEM = (
    "You are a bioinformatics command fixer. "
    "RULES:\n"
    "1. Only adjust numeric parameters (threads, memory, chunk sizes) or correct file paths.\n"
    "2. Do NOT change the main tool name (first token of the command).\n"
    "3. Do NOT add new sub-commands, pipes, or additional tools.\n"
    "4. Do NOT remove required flags.\n"
    "5. Return ONLY the corrected command — no explanation, no markdown.\n"
    "If you cannot fix the command within these constraints, return the original command unchanged."
)


def _is_safe_repair(original: str, repaired: str) -> bool:
    """Return True if the repaired command stays within allowed changes.

    Forbidden changes:
    - Different first token (tool name)
    - Introduces a pipe (|) or redirection (> / >>)
    - Adds a new subcommand (&&, ;, ||)
    """
    try:
        orig_parts = shlex.split(original.strip())
        repair_parts = shlex.split(repaired.strip())
    except ValueError:
        return False

    if not orig_parts or not repair_parts:
        return False

    # Tool name must stay the same
    if Path(orig_parts[0]).name.lower() != Path(repair_parts[0]).name.lower():
        log.warning(
            "Level-2 repair rejected: tool name changed from '%s' to '%s'",
            orig_parts[0], repair_parts[0],
        )
        return False

    # No new pipes or shell composition
    for char in ("|", "&&", "||", ";"):
        in_orig = char in original
        in_repair = char in repaired
        if in_repair and not in_orig:
            log.warning("Level-2 repair rejected: introduced '%s'", char)
            return False

    return True


async def apply_level2_repair(
    command: str,
    stderr: str,
    attempt_history: list[dict],
    project_id: str = "",
) -> Optional[str]:
    """Call LLM with constraints; validate output; return repaired command or None."""
    try:
        from tune.core.llm.gateway import LLMMessage, get_gateway
    except ImportError:
        log.warning("LLM gateway not available — skipping Level-2 repair")
        return None

    history_text = ""
    if attempt_history:
        lines = [
            f"Attempt {i + 1}: {a['command'][:200]}  →  {a.get('stderr', '')[:150]}"
            for i, a in enumerate(attempt_history)
        ]
        history_text = "\nPrevious attempts:\n" + "\n".join(lines)

    prompt = (
        f"Command that failed:\n{command}\n\n"
        f"stderr:\n{stderr[:600]}"
        f"{history_text}"
    )

    gw = get_gateway()
    try:
        resp = await gw.chat(
            [LLMMessage("user", prompt)],
            system=_CONSTRAINED_SYSTEM,
        )
    except Exception:
        log.exception("Level-2 LLM call failed")
        return None

    repaired = resp.content.strip().strip("`").strip()
    if not repaired or repaired == command:
        return None
    if not _is_safe_repair(command, repaired):
        return None
    return repaired


# ---------------------------------------------------------------------------
# Level 3 — Human escalation
# ---------------------------------------------------------------------------


async def escalate_to_human(
    job_id: str,
    step_id: Optional[str],
    command: str,
    stderr: str,
) -> str:
    """Create a RepairRequest record and transition statuses.

    Returns the new RepairRequest.id.
    This does NOT block — the caller (repair engine) returns immediately.
    """
    from tune.core.database import get_session_factory
    from tune.core.models import RepairRequest
    from tune.core.workflow import transition_job, transition_step

    req_id = str(uuid.uuid4())
    suggestion = {
        "choices": [
            {"action": "retry_original", "label": "Retry original command"},
            {"action": "modify_params",  "label": "Modify params",  "params": {}},
            {"action": "rebind_input",   "label": "Rebind input",   "slot_name": "", "new_path": ""},
            {"action": "skip_step",      "label": "Skip this step"},
            {"action": "cancel_job",     "label": "Cancel job"},
        ],
        "failed_command": command,
        "stderr_excerpt": stderr[:2000],
    }

    async with get_session_factory()() as session:
        req = RepairRequest(
            id=req_id,
            job_id=job_id,
            step_id=step_id,
            failed_command=command,
            stderr_excerpt=stderr[:2000],
            repair_level=3,
            status="pending",
            suggestion_json=suggestion,
        )
        session.add(req)
        if step_id:
            await transition_step(step_id, "waiting_for_human_repair", session)
        await transition_job(job_id, "waiting_for_repair", session)
        await session.commit()

    log.info("Level-3 escalation: RepairRequest %s created for job %s / step %s",
             req_id, job_id, step_id)
    return req_id


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


async def attempt_repair(
    job_id: str,
    step_id: Optional[str],
    command: str,
    stderr: str,
    output_dir: str,
    attempt_history: list[dict],
    step_type: Optional[str] = None,
    project_id: str = "",
) -> RepairResult:
    """Three-level repair attempt.

    1. Try Level-1 deterministic rules.
    2. If no rule matched, try Level-2 constrained LLM.
    3. If Level-2 failed / rejected, escalate to Level-3 human repair.

    Returns a RepairResult describing the outcome. Does NOT execute anything.
    """
    # Enforce retry limits and policy from step type registry
    from tune.core.registry import get_step_type
    from tune.core.registry.steps import RepairPolicy
    policy = RepairPolicy()   # default policy
    if step_type:
        defn = get_step_type(step_type)
        if defn:
            policy = defn.repair_policy

    l1_count = sum(1 for a in attempt_history if a.get("repair_level") == 1)
    l2_count = sum(1 for a in attempt_history if a.get("repair_level") == 2)

    # -----------------------------------------------------------------------
    # Tier 0 — RepairMemory: known human fix for this error class
    # -----------------------------------------------------------------------
    # Only try on the first repair attempt (not after L1/L2 already tried).
    # We skip Tier 0 if previous attempts already included a memory recall
    # to avoid re-applying the same fix that already failed once.
    _memory_retries = sum(1 for a in attempt_history if a.get("repair_level") == 0
                          and a.get("from_memory"))
    if step_type and l1_count == 0 and l2_count == 0 and _memory_retries == 0:
        try:
            from tune.core.repair.memory import query_repair_memory, _apply_memory_fix
        except ImportError:
            pass
        else:
            mem = await query_repair_memory(step_type, stderr, project_id)
            if mem:
                adapted = _apply_memory_fix(command, mem)
                if adapted and adapted != command and _is_safe_repair(command, adapted):
                    log.info(
                        "Tier-0 memory recall: memory=%s step_type=%s strategy=%s",
                        mem["id"], step_type, mem.get("normalized_strategy"),
                    )
                    return RepairResult(
                        action=RepairAction.MEMORY_RECALLED,
                        repaired_command=adapted,
                        memory_id=mem["id"],
                        notes=f"Applied repair from memory (strategy={mem.get('normalized_strategy')})",
                    )

    # Level 1 — rule-based
    if l1_count < policy.max_l1_retries:
        repaired, rule_name = apply_level1_rules(command, stderr, output_dir)
        if repaired is not None:
            log.info("Level-1 repair applied rule '%s' for job %s", rule_name, job_id)
            return RepairResult(
                action=RepairAction.APPLIED_RULE,
                repaired_command=repaired,
                rule_applied=rule_name,
            )

    # Level 2 — constrained LLM (skip if policy disallows it)
    if policy.allow_l2_llm and l2_count < policy.max_l2_retries:
        repaired = await apply_level2_repair(command, stderr, attempt_history, project_id)
        if repaired is not None:
            log.info("Level-2 LLM repair produced safe fix for job %s", job_id)
            return RepairResult(
                action=RepairAction.LLM_REPAIRED,
                repaired_command=repaired,
            )

    # Level 3 — human escalation (skip if policy disallows it → fail fast)
    if not policy.l3_escalate:
        log.warning(
            "Repair policy for step_type '%s' has l3_escalate=False; marking no_action.",
            step_type,
        )
        return RepairResult(
            action=RepairAction.NO_ACTION,
            notes="Step repair policy disables human escalation; step will be marked failed.",
        )

    req_id = await escalate_to_human(job_id, step_id, command, stderr)
    return RepairResult(
        action=RepairAction.ESCALATED,
        escalation_repair_request_id=req_id,
        notes="All automated repair options exhausted; awaiting human decision.",
    )
