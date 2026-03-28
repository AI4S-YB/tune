from __future__ import annotations

import argparse
import re
import shutil
from pathlib import Path

import psycopg
import yaml

from tune.core.config import derive_workspace_dirs, load_config


def _move_tree(src: Path, dst: Path) -> None:
    if not src.exists():
        return
    if dst.exists():
        if any(dst.iterdir()):
            raise RuntimeError(f"Target already exists and is not empty: {dst}")
        dst.rmdir()
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(src), str(dst))


def _update_service_env(service_env: Path, new_root: Path) -> None:
    if not service_env.exists():
        return
    lines = []
    found = False
    for raw_line in service_env.read_text().splitlines():
        if raw_line.startswith("WORKSPACE_ROOT="):
            lines.append(f"WORKSPACE_ROOT={new_root}")
            found = True
        elif raw_line.startswith("ANALYSIS_DIR="):
            continue
        else:
            lines.append(raw_line)
    if not found:
        lines.append(f"WORKSPACE_ROOT={new_root}")
    service_env.write_text("\n".join(lines) + "\n")


def _update_prefix_in_column(cur, table: str, column: str, old_prefix: str, new_prefix: str) -> int:
    old_regex = "^" + re.escape(old_prefix)
    cur.execute(
        f"""
        UPDATE {table}
        SET {column} = regexp_replace({column}, %s, %s)
        WHERE {column} LIKE %s
        """,
        (old_regex, new_prefix, old_prefix + "%"),
    )
    return cur.rowcount or 0


def _merge_duplicate_file_records(cur, old_data_prefix: str, new_data_prefix: str) -> int:
    cur.execute(
        """
        SELECT old.id, new.id
        FROM files AS old
        JOIN files AS new
          ON regexp_replace(old.path, %s, %s) = new.path
        WHERE old.path LIKE %s
        """,
        ("^" + re.escape(old_data_prefix), new_data_prefix, old_data_prefix + "%"),
    )
    pairs = cur.fetchall()
    merged = 0
    for old_id, new_id in pairs:
        cur.execute(
            """
            UPDATE enhanced_metadata AS em
            SET file_id = %s
            WHERE em.file_id = %s
              AND NOT EXISTS (
                  SELECT 1
                  FROM enhanced_metadata AS keep
                  WHERE keep.file_id = %s
                    AND keep.field_key = em.field_key
              )
            """,
            (new_id, old_id, new_id),
        )
        cur.execute("DELETE FROM enhanced_metadata WHERE file_id = %s", (old_id,))
        cur.execute("UPDATE file_runs SET file_id = %s WHERE file_id = %s", (new_id, old_id))
        cur.execute(
            """
            UPDATE resource_files AS rf
            SET file_id = %s
            WHERE rf.file_id = %s
              AND NOT EXISTS (
                  SELECT 1
                  FROM resource_files AS keep
                  WHERE keep.resource_entity_id = rf.resource_entity_id
                    AND keep.file_id = %s
                    AND keep.file_role = rf.file_role
              )
            """,
            (new_id, old_id, new_id),
        )
        cur.execute("DELETE FROM resource_files WHERE file_id = %s", (old_id,))
        cur.execute("UPDATE files SET duplicate_of = %s WHERE duplicate_of = %s", (new_id, old_id))
        cur.execute("DELETE FROM files WHERE id = %s", (old_id,))
        merged += 1
    return merged


def _update_database_paths(
    database_url: str,
    old_data_dir: Path,
    new_data_dir: Path,
    old_output_dir: Path,
    new_output_dir: Path,
) -> dict[str, int]:
    conninfo = database_url.replace("postgresql+psycopg://", "postgresql://")
    old_data_prefix = str(old_data_dir.resolve())
    new_data_prefix = str(new_data_dir.resolve())
    old_prefix = str(old_output_dir.resolve())
    new_prefix = str(new_output_dir.resolve())
    updates: dict[str, int] = {}
    with psycopg.connect(conninfo) as conn:
        with conn.cursor() as cur:
            duplicate_merges = _merge_duplicate_file_records(cur, old_data_prefix, new_data_prefix)
            if duplicate_merges:
                updates["files.duplicate_merge"] = duplicate_merges
            for table, column, source_prefix, target_prefix in [
                ("analysis_jobs", "output_dir", old_prefix, new_prefix),
                ("artifact_records", "file_path", old_prefix, new_prefix),
                ("derived_resources", "path", old_prefix, new_prefix),
                ("input_bindings", "resolved_path", old_prefix, new_prefix),
                ("derived_resources", "derived_from_path", old_data_prefix, new_data_prefix),
                ("files", "path", old_data_prefix, new_data_prefix),
                ("input_bindings", "resolved_path", old_data_prefix, new_data_prefix),
                ("known_paths", "path", old_data_prefix, new_data_prefix),
                ("projects", "dir_path", old_data_prefix, new_data_prefix),
                ("scan_state", "last_scanned_path", old_data_prefix, new_data_prefix),
            ]:
                key = f"{table}.{column}"
                updates[key] = updates.get(key, 0) + _update_prefix_in_column(
                    cur, table, column, source_prefix, target_prefix
                )
        conn.commit()
    return updates


def migrate(repo_root: Path) -> None:
    old_root = repo_root / "analysis"
    new_root = repo_root / "workspace"
    old_data = old_root / "data"
    old_output = old_root / "workspace"
    new_data, new_output = derive_workspace_dirs(new_root)
    legacy_dirs_exist = old_data.exists() or old_output.exists()

    if not legacy_dirs_exist and not new_root.exists():
        raise RuntimeError("Legacy runtime layout not found under analysis/")

    cfg = load_config(old_root if legacy_dirs_exist else new_root)

    if legacy_dirs_exist:
        _move_tree(old_data, new_data)
        _move_tree(old_output, new_output)

    new_config_path = new_root / ".tune" / "config.yaml"
    if legacy_dirs_exist:
        migrated_config_path = new_output / ".tune" / "config.yaml"
        if migrated_config_path.exists():
            new_config_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(migrated_config_path), str(new_config_path))
            leftover_tune_dir = migrated_config_path.parent
            if leftover_tune_dir.exists() and not any(leftover_tune_dir.iterdir()):
                leftover_tune_dir.rmdir()
    if not new_config_path.exists():
        raise RuntimeError(f"Migrated config not found at {new_config_path}")

    config_data = yaml.safe_load(new_config_path.read_text()) or {}
    config_data["workspace_root"] = str(new_root.resolve())
    config_data["data_dir"] = str(new_data.resolve())
    config_data["analysis_dir"] = str(new_output.resolve())
    new_config_path.write_text(yaml.safe_dump(config_data, sort_keys=False, allow_unicode=True))

    updates = _update_database_paths(cfg.database_url, old_data, new_data, old_output, new_output)
    _update_service_env(repo_root / ".run" / "service.env", new_root.resolve())

    print(f"workspace_root: {new_root.resolve()}")
    print(f"data_dir: {new_data.resolve()}")
    print(f"analysis_dir: {new_output.resolve()}")
    for key in sorted(updates):
        if updates[key]:
            print(f"{key} updated: {updates[key]}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Migrate Tune runtime workspace from analysis/ to workspace/")
    parser.add_argument("--repo-root", default=str(Path(__file__).resolve().parents[1]), help="Repository root")
    args = parser.parse_args()
    migrate(Path(args.repo_root).resolve())
