## 2024-05-24 - Eliminate Array.shift() O(N^2) Overhead in BFS Queues
**Learning:** Using `Array.shift()` to dequeue items in Breadth-First Search (BFS) loops introduces an $O(N^2)$ complexity due to array re-indexing on every shift. This is a common performance anti-pattern in graph traversal code.
**Action:** Replace `const item = queue.shift()` with an index pointer: `let queueIndex = 0; while (queueIndex < queue.length) { const item = queue[queueIndex++]; }`. This reduces queue operations to $O(1)$ and speeds up graph analysis in ComfyUI workflows and cache eviction routines.
## 2024-05-24 - Eliminate Recursion Stack Overflow in Graph Topo/Depth Computations
**Learning:** Using recursion to compute node depth (e.g. `getDepth` memoization) in unconstrained workflow graphs causes `RangeError: Maximum call stack size exceeded` for large / linear graphs due to deep call stacks.
**Action:** Replace recursive topological computations with an iterative Queue-based Kahn's algorithm or iterative DFS to avoid stack overflow limits and improve baseline performance.

## 2024-05-24 - Prefer for...in Over Object.entries for Graph Object Iteration
**Learning:** Iterating over node property collections using `for (const [key, value] of Object.entries(obj))` introduces significant memory allocation and execution overhead in graph processing due to intermediate array creation.
**Action:** Use a direct `for (const key in obj)` loop and `obj[key]` access for performance-critical structural traversals where the objects are plain data dictionaries.
## 2026-05-17 - Eliminate Array.map() O(N) Allocation Overhead for new Set()
**Learning:** Initializing a `Set` with a mapped array, such as `new Set(images.map(img => img.id))`, creates an unnecessary intermediate array of strings that immediately gets garbage collected. This increases memory usage and GC pauses.
**Action:** Replace `new Set(array.map(item => item.prop))` with an explicit `for` loop that iterates over the original array and adds elements directly to the `Set`. This avoids the temporary array allocation and speeds up data operations.
## $(date +%Y-%m-%d) - Eliminate Array.map() O(N) allocation overhead for Map/Set initialization
**Learning:** Initializing a `Map` or `Set` using `.map()` on a large array (e.g., `new Map(arr.map(item => [item.id, item]))`) causes an O(N) temporary array of tuples to be allocated and immediately discarded, triggering garbage collection pauses.
**Action:** Replace `.map()` with a pre-instantiated `Map` or `Set` and populate it directly using a `for` loop to scale at O(1) intermediate memory.
