推荐：

  - bash scripts/service.sh start --workspace-root workspace
  - bash scripts/dev.sh --workspace-root workspace
  - bash scripts/service.sh status
  - bash scripts/service.sh restart
  - bash scripts/service.sh stop

兼容旧参数：

  - `--analysis-dir` 仍可使用，但仅建议用于迁移旧环境
  - 兼容路径包括 `workspace/analysis`、`analysis/workspace` 和工作区根目录
