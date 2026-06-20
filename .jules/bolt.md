## 2024-05-24 - Avoiding Array Spread and Chaining in Hot Loops
**Learning:** Chaining array methods like `.filter().map().filter()` or using array spread operators inside tight, repetitive loops (like evaluating hundreds or thousands of candidates for similar image searches) causes severe garbage collection pressure by allocating numerous intermediate arrays.
**Action:** When refactoring hot paths, manually flatten processing logic into a single `for...of` or standard `for` loop, conditionally pushing items into a single pre-allocated (if size is known) or newly created array. Use `continue` statements to skip items instead of a pre-filtering pass. This pattern provides significant memory and performance boosts for large datasets.

## 2025-01-24 - Optimized Jaccard Similarity via Direct Set Interrogation
**Learning:** Calculating set-based metrics like Jaccard similarity using array spreads and filters () creates significant garbage collection pressure due to multiple intermediate array and set allocations per call. This is particularly impactful in hot loops like image clustering or similarity search.
**Action:** Use direct  loops to count intersections and apply the inclusion-exclusion principle ($|A| + |B| - |A \cap B|$) to determine the union size. This approach avoids all intermediate allocations while maintaining (N)$ complexity, resulting in a ~75% performance boost in micro-benchmarks.

## 2025-01-24 - Optimized Jaccard Similarity via Direct Set Interrogation
**Learning:** Calculating set-based metrics like Jaccard similarity using array spreads and filters (`new Set([...a].filter(x => b.has(x)))`) creates significant garbage collection pressure due to multiple intermediate array and set allocations per call. This is particularly impactful in hot loops like image clustering or similarity search.
**Action:** Use direct `for...of` loops to count intersections and apply the inclusion-exclusion principle (|A| + |B| - |A \cap B|) to determine the union size. This approach avoids all intermediate allocations while maintaining O(N) complexity, resulting in a ~75% performance boost in micro-benchmarks.
