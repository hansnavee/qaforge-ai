export {
  parseRequirementDocument,
  type DocumentElement,
  type ParsedDocument,
} from './document-parser.js';

export {
  extractRequirementsFromSource,
  extractFromParsedDocument,
  semanticExtractRequirements,
  filterExtractedRequirements,
  isMeaningfulRequirement,
  type RequirementType,
  type SemanticExtractedRequirement,
  type ExtractionResult,
} from './semantic-extract.js';

export {
  isRequirementCandidate,
  isHeadingText,
  isTableText,
  isFormattingFragment,
  type RejectReason,
  type RequirementCandidate,
} from './quality-gate.js';

export {
  finalizeExtraction,
  type ExtractionDecision,
  type FinalizeResult,
} from './finalize-extraction.js';

export {
  normalizeRequirements,
  generateSemanticTitle,
  isTruncatedTitle,
  classifyRequirementType,
  capabilityFingerprint,
  type TempCandidate,
  type NormalizationStats,
} from './normalize-requirements.js';
