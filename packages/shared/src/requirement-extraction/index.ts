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
