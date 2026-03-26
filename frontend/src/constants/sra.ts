// SRA controlled vocabulary constants — NCBI SRA / BioSample standard values

export const LIBRARY_STRATEGY = [
  'RNA-Seq', 'WGS', 'WXS', 'AMPLICON', 'ChIP-Seq', 'ATAC-seq',
  'Bisulfite-Seq', 'Hi-C', 'miRNA-Seq', 'ncRNA-Seq', 'RAD-Seq',
  'ssRNA-seq', 'EST', 'FL-cDNA', 'CTS', 'MRE-Seq', 'MeDIP-Seq',
  'MBD-Seq', 'Tn-Seq', 'VALIDATION', 'FAIRE-seq', 'SELEX',
  'RIP-Seq', 'ChIA-PET', 'Synthetic-Long-Read', 'Targeted-Capture',
  'Tethered Chromatin Conformation Capture', 'OTHER',
] as const

export const LIBRARY_SOURCE = [
  'TRANSCRIPTOMIC',
  'TRANSCRIPTOMIC SINGLE CELL',
  'GENOMIC',
  'GENOMIC SINGLE CELL',
  'METAGENOMIC',
  'METATRANSCRIPTOMIC',
  'SYNTHETIC',
  'VIRAL RNA',
  'OTHER',
] as const

export const LIBRARY_SELECTION = [
  'RANDOM',
  'PCR',
  'RANDOM PCR',
  'RT-PCR',
  'cDNA',
  'cDNA_randomPriming',
  'cDNA_oligo_dT',
  'ChIP',
  'ChIP-Seq',
  'MNase',
  'DNase',
  'Hybrid Selection',
  'Reduced Representation',
  'Repeat Fractionation',
  'size fractionation',
  'Padlock probes capture method',
  'other',
  'unspecified',
] as const

export const LIBRARY_LAYOUT = ['SINGLE', 'PAIRED'] as const

export const PLATFORM = [
  'ILLUMINA',
  'OXFORD_NANOPORE',
  'PACBIO_SMRT',
  'ION_TORRENT',
  'ABI_SOLID',
  'HELICOS',
  'COMPLETE_GENOMICS',
  'BGI',
  'LS454',
  'CAPILLARY',
] as const

export const INSTRUMENT_MODELS: Record<string, string[]> = {
  ILLUMINA: [
    'NovaSeq 6000',
    'NovaSeq X',
    'NovaSeq X Plus',
    'HiSeq X Ten',
    'HiSeq X Five',
    'HiSeq 4000',
    'HiSeq 3000',
    'HiSeq 2500',
    'HiSeq 2000',
    'HiSeq 1500',
    'HiSeq 1000',
    'NextSeq 2000',
    'NextSeq 550',
    'NextSeq 500',
    'MiSeq',
    'MiniSeq',
    'iSeq 100',
    'Genome Analyzer IIx',
    'unspecified',
  ],
  OXFORD_NANOPORE: [
    'MinION',
    'GridION',
    'PromethION',
    'Flongle',
    'unspecified',
  ],
  PACBIO_SMRT: [
    'Revio',
    'Sequel IIe',
    'Sequel II',
    'Sequel',
    'PacBio RS II',
    'PacBio RS',
    'unspecified',
  ],
  ION_TORRENT: [
    'Ion GeneStudio S5 XL',
    'Ion GeneStudio S5 Plus',
    'Ion GeneStudio S5',
    'Ion Torrent Genexus',
    'Ion Torrent Proton',
    'Ion Torrent PGM',
    'Ion Torrent S5 XL',
    'Ion Torrent S5',
    'unspecified',
  ],
  ABI_SOLID: ['AB SOLiD 5500xl W', 'AB SOLiD 5500xl', 'AB SOLiD 5500', 'unspecified'],
  HELICOS: ['Helicos HeliScope', 'unspecified'],
  COMPLETE_GENOMICS: ['Complete Genomics', 'unspecified'],
  BGI: ['BGISEQ-500', 'DNBSEQ-G400', 'DNBSEQ-T7', 'DNBSEQ-G50', 'unspecified'],
  LS454: ['454 GS FLX+', '454 GS FLX Titanium', '454 GS FLX', '454 GS Junior', 'unspecified'],
  CAPILLARY: ['AB 3730xL Genetic Analyzer', 'AB 3730 Genetic Analyzer', 'unspecified'],
}

export const NULL_TERMS = [
  'missing',
  'not applicable',
  'not collected',
  'not provided',
  'restricted access',
] as const

export type NullTerm = typeof NULL_TERMS[number]

export function isNullTerm(v: string): boolean {
  return (NULL_TERMS as readonly string[]).includes(v)
}

// BioSample packages and their package-specific fields
// Base fields are always shown regardless of package
export const BASE_SAMPLE_FIELDS = [
  { key: 'sample_title', label: 'Sample Title' },
  { key: 'description', label: 'Description' },
  { key: 'collection_date', label: 'Collection Date' },
  { key: 'geo_loc_name', label: 'Geographic Location' },
] as const

export const SAMPLE_PACKAGES = {
  Plant: {
    label: 'Plant',
    fields: [
      { key: 'cultivar', label: 'Cultivar' },
      { key: 'ecotype', label: 'Ecotype' },
      { key: 'strain', label: 'Strain' },
      { key: 'tissue', label: 'Tissue' },
      { key: 'developmental_stage', label: 'Developmental Stage' },
      { key: 'genotype', label: 'Genotype' },
      { key: 'treatment', label: 'Treatment' },
    ],
  },
  Animal: {
    label: 'Animal',
    fields: [
      { key: 'strain', label: 'Strain' },
      { key: 'sex', label: 'Sex' },
      { key: 'age', label: 'Age' },
      { key: 'tissue', label: 'Tissue' },
      { key: 'developmental_stage', label: 'Developmental Stage' },
      { key: 'host', label: 'Host' },
      { key: 'isolation_source', label: 'Isolation Source' },
    ],
  },
  Human: {
    label: 'Human',
    fields: [
      { key: 'tissue', label: 'Tissue' },
      { key: 'sex', label: 'Sex' },
      { key: 'age', label: 'Age' },
      { key: 'treatment', label: 'Treatment' },
      { key: 'isolation_source', label: 'Isolation Source' },
    ],
  },
  Microorganism: {
    label: 'Microorganism',
    fields: [
      { key: 'strain', label: 'Strain' },
      { key: 'isolate', label: 'Isolate' },
      { key: 'host', label: 'Host' },
      { key: 'isolation_source', label: 'Isolation Source' },
      { key: 'collection_date', label: 'Collection Date' },
      { key: 'geo_loc_name', label: 'Geographic Location' },
    ],
  },
} as const

export type PackageName = keyof typeof SAMPLE_PACKAGES

export const PACKAGE_NAMES = Object.keys(SAMPLE_PACKAGES) as PackageName[]
