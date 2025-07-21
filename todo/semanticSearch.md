# Semantic Search for Ticket Duplicate Detection

## Overview

This document outlines the implementation plan for adding semantic search capabilities to the task manager MCP server. The primary goal is to help users identify potentially duplicate tickets before creating new ones, improving project organization and reducing redundancy.

## Problem Statement

### Current Issue
- Users may create duplicate tickets without realizing similar tickets already exist
- No mechanism to detect semantic similarity between tickets (e.g., "user login" vs "authentication system")
- Manual search through existing tickets is time-consuming and error-prone
- Duplicate tickets lead to fragmented work and poor project tracking

### Example Scenarios
1. **Direct Duplicates**: "Setup user authentication" vs "Setup user authentication"
2. **Semantic Duplicates**: "Create login system" vs "Implement user authentication"
3. **Partial Duplicates**: "User dashboard UI" vs "Build user interface for dashboard"
4. **Related Tickets**: "Database migration" vs "Update database schema"

## Proposed Solution

### New MCP Tool: `search_similar_tickets`

A semantic search tool that analyzes query text against existing tickets to find potential matches and related work.

#### Input Schema
```typescript
{
  query: string,              // Search text (title + description)
  projectId?: string,         // Optional: limit search to specific project
  maxResults?: number,        // Default: 5, max results to return
  minSimilarity?: number,     // Default: 0.3, threshold for relevance (0-1)
  includeStatus?: string[]    // Default: ['open', 'in-progress'], statuses to search
}
```

#### Output Schema
```typescript
{
  results: [{
    ticket: Ticket,           // Full ticket object
    similarity: number,       // 0-1 similarity score
    matchType: string,        // 'exact', 'semantic', 'keyword', 'fuzzy'
    reasons: string[],        // Explanation of why it matched
    matchedFields: string[]   // Which fields matched ('title', 'description')
  }],
  query: string,
  searchMetadata: {
    totalSearched: number,
    processingTime: number,
    algorithm: string
  }
}
```

## Implementation Approaches

### Phase 1: Text-Based Similarity (MVP)
**Approach**: Lightweight, dependency-free text analysis
- **TF-IDF Vectorization**: Convert text to numerical vectors
- **Cosine Similarity**: Calculate similarity between vectors
- **Keyword Matching**: Direct keyword overlaps
- **Fuzzy String Matching**: Handle typos and variations

**Pros**:
- No external dependencies
- Fast execution
- Works offline
- Deterministic results

**Cons**:
- Limited semantic understanding
- May miss conceptually similar but differently worded tickets

**Implementation Details**:
```typescript
class TextSimilarityEngine {
  // TF-IDF calculation for title and description
  // Keyword extraction and matching
  // Fuzzy string matching (Levenshtein distance)
  // Combined scoring algorithm
}
```

### Phase 2: Embedding-Based Semantic Search (Advanced)
**Approach**: True semantic understanding using embeddings
- **Sentence Transformers**: Local embedding models
- **OpenAI Embeddings**: Cloud-based semantic vectors
- **Vector Storage**: Cache embeddings for performance

**Pros**:
- True semantic understanding
- Handles synonyms and related concepts
- Better at finding conceptually similar tickets

**Cons**:
- External dependencies or API calls
- Larger memory footprint
- Potential cost (if using cloud APIs)

### Phase 3: Hybrid Approach (Optimal)
**Approach**: Combine both methods with weighted scoring
- Text similarity (40%) + Semantic similarity (60%)
- Fallback to text-only if embedding service unavailable
- Configurable weighting based on use case

## Technical Implementation Plan

### 1. Core Similarity Engine
Create `src/similarity/` directory with:
- `TextSimilarity.ts` - TF-IDF and keyword matching
- `SemanticSimilarity.ts` - Embedding-based search (Phase 2)
- `SimilarityEngine.ts` - Main orchestrator
- `types.ts` - Shared interfaces

### 2. Text Processing Pipeline
```typescript
interface TextProcessor {
  // Text normalization (lowercase, punctuation removal)
  // Stop word removal
  // Stemming/lemmatization
  // Keyword extraction
  // N-gram generation
}
```

### 3. Scoring Algorithm
```typescript
interface SimilarityScore {
  titleSimilarity: number;     // Title-to-title comparison
  descriptionSimilarity: number; // Description matching
  keywordOverlap: number;      // Common keywords
  fuzzyMatch: number;          // Typo tolerance
  combined: number;            // Final weighted score
}
```

### 4. Integration Points

#### A. Standalone Tool
- Add to existing MCP tool list
- Independent search capability
- Manual duplicate checking workflow

#### B. Create Ticket Integration
- Modify `create_ticket` tool to auto-check for duplicates
- Return warnings for high similarity scores
- Option to proceed or cancel creation

#### C. API Enhancement
```typescript
// Enhanced create_ticket response
{
  ticket?: Ticket,
  warnings?: {
    potentialDuplicates: SimilarityResult[],
    recommendations: string[]
  },
  action: 'created' | 'warning' | 'blocked'
}
```

## Performance Considerations

### Optimization Strategies
1. **Incremental Indexing**: Only process new/updated tickets
2. **Caching**: Store processed text vectors
3. **Batch Processing**: Group similarity calculations
4. **Lazy Loading**: Process on-demand vs pre-computed

### Scalability
- Current implementation targets 100-1000 tickets
- For larger datasets, consider:
  - External search engines (Elasticsearch)
  - Database full-text search
  - Distributed processing

## Configuration Options

### Similarity Thresholds
```typescript
interface SimilarityConfig {
  exactMatch: 0.95,           // Likely duplicate
  highSimilarity: 0.8,        // Strong match, review recommended
  moderateSimilarity: 0.6,    // Related, worth noting
  lowSimilarity: 0.3          // Minimum threshold to report
}
```

### Search Weights
```typescript
interface SearchWeights {
  titleWeight: 0.7,           // Title matches are more important
  descriptionWeight: 0.3,     // Description provides context
  projectBoost: 0.1,          // Same project tickets get bonus
  statusPenalty: 0.1          // Closed tickets get reduced weight
}
```

## Expected Benefits

### For Users
- **Reduced Duplicates**: Catch similar tickets before creation
- **Better Discovery**: Find related work and dependencies
- **Improved Planning**: Understand existing work scope
- **Time Savings**: Avoid recreating existing tickets

### For Projects
- **Better Organization**: Cleaner ticket structure
- **Accurate Tracking**: True progress visibility
- **Resource Efficiency**: Avoid duplicate work
- **Knowledge Management**: Better information discovery

## Success Metrics

### Quantitative
- Reduction in duplicate ticket creation (target: 50%)
- User adoption rate of search tool
- Average similarity scores of flagged tickets
- Processing time per search query

### Qualitative
- User feedback on search relevance
- False positive/negative rates
- Integration smoothness with existing workflow

## Implementation Timeline

### Phase 1 (1-2 days)
- [ ] Create similarity engine foundation
- [ ] Implement text-based TF-IDF similarity
- [ ] Add basic keyword matching
- [ ] Create MCP tool interface
- [ ] Basic testing with existing tickets

### Phase 2 (2-3 days)
- [ ] Add fuzzy string matching
- [ ] Implement weighted scoring
- [ ] Performance optimization
- [ ] Comprehensive testing
- [ ] Documentation and examples

### Phase 3 (Future)
- [ ] Embedding-based semantic search
- [ ] Integration with create_ticket workflow
- [ ] Advanced configuration options
- [ ] Analytics and monitoring

## Dependencies

### Required
- None (text-based approach is dependency-free)

### Optional (Future Phases)
- `sentence-transformers` (for local embeddings)
- `openai` (for cloud embeddings)
- `natural` or `compromise` (for advanced text processing)
- `fuse.js` (for fuzzy search enhancements)

## Testing Strategy

### Unit Tests
- Text processing functions
- Similarity calculation algorithms
- Edge cases (empty tickets, special characters)

### Integration Tests
- MCP tool functionality
- End-to-end search scenarios
- Performance benchmarks

### Test Data
- Use existing tickets in `data/tickets.json`
- Create synthetic test cases for edge scenarios
- Include various similarity levels for validation

## Future Enhancements

### Advanced Features
- **Machine Learning**: Learn from user feedback to improve scoring
- **Context Awareness**: Consider project phase, team assignments
- **Temporal Factors**: Weight recent tickets higher
- **Cross-Project Search**: Find similar work across projects

### Integration Possibilities
- **Notification System**: Alert on potential duplicates
- **Bulk Operations**: Merge duplicate tickets
- **Analytics Dashboard**: Duplicate detection statistics
- **API Extensions**: External system integration

---

*This document serves as the foundation for implementing semantic search capabilities in the task manager MCP system. Regular updates will be made as implementation progresses and requirements evolve.*
