"""Seed GlobalMemory entries for common bioinformatics errors."""
from __future__ import annotations

SEED_MEMORIES = [
    {
        "trigger_condition": "command not found",
        "approach": (
            "The tool binary is not installed in the Pixi environment. "
            "Extract the binary name from the error (e.g. 'hisat2-build: command not found' → 'hisat2-build'). "
            "Map the binary to its conda-forge or bioconda package "
            "(e.g. hisat2-build → hisat2, samtools → samtools, STAR → star). "
            "Use 'pixi add <package>' to install it, then retry the command."
        ),
        "source": "system",
    },
    {
        "trigger_condition": "low alignment rate below 30 percent",
        "approach": (
            "An alignment rate below 30% suggests: (1) rRNA contamination — consider a rRNA depletion step; "
            "(2) wrong aligner for the data type (RNA-Seq needs a splice-aware aligner like HISAT2 or STAR, "
            "not Bowtie2 or BWA); (3) reference genome / transcriptome version mismatch — verify organism and "
            "assembly version match the data. Check strandedness settings and paired-end flags."
        ),
        "source": "system",
    },
    {
        "trigger_condition": "out of memory, OOM killer, Killed, Cannot allocate memory",
        "approach": (
            "The process was killed due to insufficient RAM. Strategies: "
            "(1) Reduce thread count (--runThreadN 4, -p 4, --threads 4); "
            "(2) Split large input files into smaller chunks; "
            "(3) For STAR: use --genomeSAindexNbases for small genomes to lower index memory; "
            "(4) Free other memory-consuming processes on the machine before retrying."
        ),
        "source": "system",
    },
    {
        "trigger_condition": "gzip: not in gzip format, not a gzip file, stdin not in gzip format",
        "approach": (
            "The input file is not gzip-compressed despite a .gz extension, or the tool needs explicit "
            "decompression. For STAR: add '--readFilesCommand zcat' to stream-decompress on the fly. "
            "For other tools: decompress first with 'gunzip file.gz', then remove the .gz extension "
            "from the command argument."
        ),
        "source": "system",
    },
    {
        "trigger_condition": "permission denied, Operation not permitted",
        "approach": (
            "The process lacks read or write permission on a file or directory. Check: "
            "(1) Output directory writability — run 'ls -la <outdir>' to verify; "
            "(2) Input file ownership — the running user may not own the file; "
            "(3) On shared filesystems, verify quota and ACL settings. "
            "Use 'chmod u+w <path>' or choose a writable output directory."
        ),
        "source": "system",
    },
    {
        "trigger_condition": (
            "chromosome not in genome, sequence not found in reference, "
            "index out of range, contig not found"
        ),
        "approach": (
            "The annotation file (GTF/GFF) and the reference genome use different chromosome names "
            "or assembly versions. Common fixes: "
            "(1) Ensure both genome and annotation are from the same Ensembl/UCSC release; "
            "(2) Check chromosome naming (chr1 vs 1 — UCSC uses 'chr', Ensembl does not); "
            "(3) Rebuild the genome index with the matching annotation file; "
            "(4) Use a crossmap/liftover tool if assembly versions must differ."
        ),
        "source": "system",
    },
]


async def apply_memory_seeds(session) -> None:
    """Upsert seed GlobalMemory entries — idempotent, matches on trigger_condition + source=system."""
    from sqlalchemy import select

    from tune.core.memory.global_memory import embed_text
    from tune.core.models import GlobalMemory

    for seed in SEED_MEMORIES:
        existing = (
            await session.execute(
                select(GlobalMemory).where(
                    GlobalMemory.trigger_condition == seed["trigger_condition"],
                    GlobalMemory.source == "system",
                )
            )
        ).scalar_one_or_none()

        embedding = await embed_text(f"{seed['trigger_condition']}\n{seed['approach']}")

        if existing:
            existing.approach = seed["approach"]
            if embedding is not None:
                existing.embedding = embedding
            if existing.success_count < 10:
                existing.success_count = 10
        else:
            session.add(
                GlobalMemory(
                    trigger_condition=seed["trigger_condition"],
                    approach=seed["approach"],
                    source="system",
                    embedding=embedding,
                    success_count=10,  # Baseline rank so seeds surface in fallback ordering
                )
            )

    await session.commit()
