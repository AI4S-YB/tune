"""Plan change applicator — apply structured changes to a plan_draft_json.

Supported change types:
  add_step      — add a new step to the plan
  remove_step   — remove a step by step_key
  reorder_steps — reorder steps by providing new ordering of step_keys
  modify_param  — change a param value within a step
"""
from __future__ import annotations

import copy
import logging

log = logging.getLogger(__name__)


class PlanChangeError(ValueError):
    pass


def apply_plan_change(plan_steps: list[dict], change: dict) -> list[dict]:
    """Apply a single structured change to plan_steps. Returns the modified list (copy).

    Raises PlanChangeError on invalid change.
    """
    change_type = change.get("type")
    steps = copy.deepcopy(plan_steps)

    if change_type == "add_step":
        new_step = change.get("step")
        if not new_step or not isinstance(new_step, dict):
            raise PlanChangeError("add_step requires a 'step' object")
        if not new_step.get("step_key"):
            raise PlanChangeError("add_step: step must have a step_key")
        existing_keys = {s.get("step_key") for s in steps}
        if new_step["step_key"] in existing_keys:
            raise PlanChangeError(f"add_step: step_key '{new_step['step_key']}' already exists")
        after = change.get("after_key")
        if after:
            idx = _find_step_index(steps, after)
            if idx is None:
                raise PlanChangeError(f"add_step: after_key '{after}' not found")
            steps.insert(idx + 1, new_step)
        else:
            steps.append(new_step)
        return steps

    elif change_type == "remove_step":
        key = change.get("step_key")
        if not key:
            raise PlanChangeError("remove_step requires a 'step_key'")
        idx = _find_step_index(steps, key)
        if idx is None:
            raise PlanChangeError(f"remove_step: step_key '{key}' not found")
        # Also remove from depends_on of downstream steps
        del steps[idx]
        for step in steps:
            deps = step.get("depends_on") or []
            step["depends_on"] = [d for d in deps if d != key]
        return steps

    elif change_type == "reorder_steps":
        new_order = change.get("step_keys")
        if not new_order or not isinstance(new_order, list):
            raise PlanChangeError("reorder_steps requires a 'step_keys' list")
        step_map = {s["step_key"]: s for s in steps if s.get("step_key")}
        for k in new_order:
            if k not in step_map:
                raise PlanChangeError(f"reorder_steps: step_key '{k}' not found")
        # Steps not mentioned in new_order are appended at the end
        remaining = [s for s in steps if s.get("step_key") not in new_order]
        return [step_map[k] for k in new_order] + remaining

    elif change_type == "modify_param":
        key = change.get("step_key")
        param = change.get("param")
        value = change.get("value")
        if not key or not param:
            raise PlanChangeError("modify_param requires 'step_key' and 'param'")
        idx = _find_step_index(steps, key)
        if idx is None:
            raise PlanChangeError(f"modify_param: step_key '{key}' not found")
        if "params" not in steps[idx] or steps[idx]["params"] is None:
            steps[idx]["params"] = {}
        steps[idx]["params"][param] = value
        return steps

    else:
        raise PlanChangeError(f"Unknown change type: {change_type!r}")


def _find_step_index(steps: list[dict], step_key: str) -> int | None:
    for i, s in enumerate(steps):
        if s.get("step_key") == step_key:
            return i
    return None
