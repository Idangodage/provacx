/**
 * Data Module Index
 */

export {
  SYMBOL_LIBRARY,
  SYMBOL_CATEGORIES,
  getSymbolById,
  getSymbolsByCategory,
  searchSymbols,
  getCategoryLabel,
  type SymbolDefinition,
  type SymbolCategory,
} from './symbol-library';

export {
  ARCHITECTURAL_OBJECT_CATEGORIES,
  DEFAULT_ARCHITECTURAL_OBJECT_LIBRARY,
  groupArchitecturalObjectsByCategory,
  searchArchitecturalObjects,
  sortArchitecturalObjects,
  type ArchitecturalObjectDefinition,
  type ArchitecturalObjectCategory,
  type ObjectSortMode,
} from './architectural-object-library';
