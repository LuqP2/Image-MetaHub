## 2024-05-24 - Avoiding Array Spread and Chaining in Hot Loops
**Learning:** Chaining array methods like `.filter().map().filter()` or using array spread operators inside tight, repetitive loops (like evaluating hundreds or thousands of candidates for similar image searches) causes severe garbage collection pressure by allocating numerous intermediate arrays.
**Action:** When refactoring hot paths, manually flatten processing logic into a single `for...of` or standard `for` loop, conditionally pushing items into a single pre-allocated (if size is known) or newly created array. Use `continue` statements to skip items instead of a pre-filtering pass. This pattern provides significant memory and performance boosts for large datasets.

## 2025-01-24 - Optimized Jaccard Similarity via Direct Set Interrogation
**Learning:** Calculating set-based metrics like Jaccard similarity using array spreads and filters () creates significant garbage collection pressure due to multiple intermediate array and set allocations per call. This is particularly impactful in hot loops like image clustering or similarity search.
**Action:** Use direct  loops to count intersections and apply the inclusion-exclusion principle ($|A| + |B| - |A \cap B|$) to determine the union size. This approach avoids all intermediate allocations while maintaining (N)$ complexity, resulting in a ~75% performance boost in micro-benchmarks.

## 2025-01-24 - Optimized Jaccard Similarity via Direct Set Interrogation
**Learning:** Calculating set-based metrics like Jaccard similarity using array spreads and filters (`new Set([...a].filter(x => b.has(x)))`) creates significant garbage collection pressure due to multiple intermediate array and set allocations per call. This is particularly impactful in hot loops like image clustering or similarity search.
**Action:** Use direct `for...of` loops to count intersections and apply the inclusion-exclusion principle (|A| + |B| - |A \cap B|) to determine the union size. This approach avoids all intermediate allocations while maintaining O(N) complexity, resulting in a ~75% performance boost in micro-benchmarks.

## 2025-01-24 - Keyword Memoization in Clustering Engine
**Learning:** Performing keyword extraction (normalization + tokenization + filtering) multiple times for the same prompt during bucketing and pair comparisons is a significant performance bottleneck in large-scale clustering.
**Action:** Pre-calculate and store expensive derived metadata (like keyword sets) in internal builder objects during initial O(N) passes. This reduces redundant regex-based processing from O(N * B) to O(N) where B is the average bucket size, significantly speeding up the bucketing phase.
## 2024-05-25 - Optimizing Cohort Analytics
**Learning:** Computing cohort aggregates using chained `.filter()` or `.reduce()` for each property (favorites, ratings, telemetry) creates multiple $O(N)$ passes and redundant intermediate arrays.
**Action:** When calculating cohort statistics, consolidate all property aggregations into a single $O(N)$ `for` loop that updates local variables, significantly reducing array allocations and improving speed for large datasets.
## 2024-05-25 - Avoid Spread Syntax in Min/Max Calculations
**Learning:** Using `Math.min(...array.map())` and `Math.max(...array.map())` with large arrays causes two issues: First, the spread syntax pushes every array element onto the call stack, leading to a `RangeError: Maximum call stack size exceeded` crash for arrays larger than ~10,000 elements. Second, the `map` call allocates an unnecessary intermediate array, adding GC pressure.
**Action:** Replace `Math.min(...array)` and `Math.max(...array)` with a standard $O(N)$ `for` loop that iterates over the collection and updates a local min/max tracker. This prevents stack overflows and removes intermediate array allocations.

## 2024-05-26 - Reusing Derived Facets in Analytics
**Learning:** In the analytics dashboard, the same datasets (models, loras) are often displayed in multiple places (e.g., top resources list and curation summary). Calculating these facets multiple times via (N)$ scans of the entire image library is wasteful.
**Action:** Pre-calculate facets once at the beginning of the analytics generation process and pass or reuse the results for subsequent summary or curation sections. This reduces the number of full-library traversals from  + N$ to just $, where $ is the number of summary sections requiring those same facets.

## 2025-01-24 - Efficient Temporal Analytics via Date Reuse and TypedArrays
**Learning:** Performing temporal analysis on large datasets often involves thousands of ephemeral `Date` object allocations and `Map` lookups for fixed-range keys (e.g., hours of day, days of week).
**Action:** Use a single `Date` object and update it via `.setTime(timestamp)` inside the loop to avoid GC pressure. For fixed-range categorical counts, replace `Map` with `Uint32Array` for faster lookups and reduced memory footprint. Additionally, ensure expensive analytics functions are called once and their results cached when needed multiple times in the same derivation block.

## 2025-05-27 - Reducing GC Pressure via Object Reuse and Standard For Loops
**Learning:** High-frequency analytics functions (e.g., timeline generation, facet collection) can trigger significant GC pressure by allocating thousands of ephemeral `Date` and `Set` objects inside (N)$ loops. Standard `for` loops also provide better performance than `.forEach()` by eliminating callback overhead and allowing for better JIT optimizations.
**Action:** In performance-critical iteration blocks, initialize `Date` or `Set` objects outside the loop and reuse them inside using `.setTime()` or `.clear()` respectively. Prefer standard `for` loops over `.forEach()` in hot paths to minimize function call overhead and improve execution speed.

## 2025-01-24 - Redundant Normalization and Tokenization in Clustering
**Learning:** The clustering engine and similarity metrics previously performed redundant prompt normalization and tokenization in hot loops. For example, `addImageToClusters` would tokenize the same input prompt $ times when comparing against $ clusters, and Phase 1 of clustering would normalize the same string three times.
**Action:** Update similarity utilities to accept an `isAlreadyNormalized` flag and pre-tokenized `Set<string>`. Refactor clustering logic to normalize and tokenize exactly once per prompt, passing the results through the comparison chain. This eliminates (N)$ redundant processing during incremental updates and significantly reduces regex overhead in batch clustering.
## 2025-05-28 - Consolidating Filter and Facet Passes in Search Workers
**Learning:** Performing dataset filtering via chained `.filter()` calls followed by a separate $O(N)$ pass for facet collection creates significant GC pressure and redundant CPU cycles. Each `.filter()` call allocates a new array, and the subsequent facet collection traverses the filtered results again.
**Action:** In search or filtering workers, consolidate all matching logic and facet accumulation into a single `for` loop traversal. Use early `continue` statements to skip non-matching items and update facet counters/sets directly for matching items. This reduces the work from $K \cdot O(N) + O(M)$ to a single $O(N)$ pass, where $K$ is the number of filters and $M$ is the result size.
## 2026-06-25 - Lifting Max Calculations from Render Loops
**Learning:** Calculating distribution maximums (for scaling bar charts) inside a JSX `.map()` using `Math.max(...list.map())` creates an $O(N^2)$ bottleneck and high GC pressure due to redundant array allocations and traversals on every item.
**Action:** Pre-calculate maximums once using a single $O(N)$ `for` loop inside `useMemo`. This ensures that rendering $N$ items only requires $O(N)$ total work to determine the scale, rather than $O(N^2)$, which is critical for large datasets like timeline or rating distributions.

## 2025-06-25 - Reusing Sorted Arrays in Analytics Generation
**Learning:** Performing multiple $O(N \log N)$ sorts on the same dataset (e.g., for "latest samples" and "recent sessions") in a single derivation path is wasteful and increases CPU pressure.
**Action:** In analytics or data-heavy views, perform a single canonical sort at the beginning of the processing block and reuse the sorted array for all downstream components. Use `.slice()` and `.reverse()` to extract different perspectives (e.g., oldest vs newest) from the same base sorted collection.

## 2025-06-25 - Slicing Before Mapping in Large Collection Processing
**Learning:** Performing expensive mapping (e.g., date formatting, facet collection) on an entire collection before slicing to a small limit is a significant source of wasted CPU cycles and GC pressure, especially when the number of items (like user sessions) can grow indefinitely.
**Action:** Always reorder processing pipelines to perform filtering, reversing, and slicing *before* mapping to complex derived objects. This ensures that expensive transformations only occur for the items that will actually be displayed or consumed.

## 2025-06-30 - Optimizing Stacking Loops via Inlining and State Caching
**Learning:** Generating "keys" via string concatenation (e.g., `pos + "|" + neg`) for every item in an (N)$ loop to find consecutive matches (stacking) creates unnecessary GC pressure. Accessing the "first item" of the current stack in every iteration also adds redundant property access.
**Action:** Inline the extraction of comparison fields and cache the "current stack" criteria in local variables. This avoids (N)$ string allocations and reduces the loop body to simple primitive comparisons, which is significantly faster for large collections.

## 2026-07-01 - Efficient Path Resolution in Hot Loops
**Learning:** Path manipulation using array-based approaches (`split`, `filter`, `join`) inside hot loops (like filtering thousands of images) creates significant garbage collection pressure due to numerous intermediate array and string allocations.
**Action:** Use direct string methods (`indexOf`, `lastIndexOf`, `slice`) for path resolution and directory extraction. Combined with short-circuiting expensive path calculations when no relevant filters are active, this can improve library-wide filtering performance by ~7x-8x in path-heavy paths.

## 2025-07-02 - Caching Folder Filtering Decisions in Scoped Library Iteration
**Learning:** In applications with deep directory structures and multiple folder selection/exclusion rules, evaluating visibility for every image individually in an O(N) loop creates an (N \cdot K)$ bottleneck (where K is the number of active filters). Thousands of images in the same directory were triggering identical, expensive path joining and prefix-matching logic.
**Action:** Implement a lightweight local Map cache inside library scoping functions, keyed by a combination of directory ID and sub-path. This ensures that the expensive (K)$ filter check and path resolution occur only once per unique folder, reducing the effective complexity of the pass towards (N)$.
