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
## $(date +%Y-%m-%d) - Eliminate Array.map() O(N) allocation overhead for Map/Set initialization
**Learning:** Initializing a `Map` or `Set` using `.map()` on a large array (e.g., `new Map(arr.map(item => [item.id, item]))`) causes an O(N) temporary array of tuples to be allocated and immediately discarded, triggering garbage collection pauses.
**Action:** Replace `.map()` with a pre-instantiated `Map` or `Set` and populate it directly using a `for` loop to scale at O(1) intermediate memory.
## 2026-05-20 - Eliminate Array.map() O(N) allocation overhead for Map/Set initialization
**Learning:** Initializing a `Map` or `Set` using `.map()` on a large array (e.g., `new Map(arr.map(item => [item.id, item]))`) causes an O(N) temporary array of tuples to be allocated and immediately discarded, triggering garbage collection pauses.
**Action:** Replace `.map()` with a pre-instantiated `Map` or `Set` and populate it directly using a `for` loop to scale at O(1) intermediate memory.
## 2024-05-24 - Avoid temporary array allocations during Set/Map initialization
**Learning:** Using `.map()` inside `new Set()` or `new Map()` (e.g., `new Set(arr.map(x => x.id))`) causes JavaScript to allocate a temporary array of mapped values or tuples in memory, which is immediately discarded. This increases garbage collection pressure, especially for large datasets.
**Action:** Replace `new Set(arr.map(...))` or `new Map(arr.map(...))` with direct loops (e.g., `const s = new Set(); for (const x of arr) s.add(x.id);`). This executes slightly faster and skips intermediate array allocation entirely.
## 2026-05-26 - Eliminate Array.map() O(N) allocation overhead for Map/Set initialization
**Learning:** Initializing a `Map` or `Set` using `.map()` on a large array (e.g., `new Set(arr.map(item => item.id))`) causes an O(N) temporary array of elements to be allocated and immediately discarded, triggering garbage collection pauses.
**Action:** Replace `.map()` with a pre-instantiated `Map` or `Set` and populate it directly using a `for` loop to scale at O(1) intermediate memory.
## 2026-05-29 - Eliminate Object.entries() O(N) memory allocation in hot loops
**Learning:** Using `Object.entries(obj)` inside heavily accessed loops (like graph traversal in ComfyUI workflow parsing) creates intermediate array allocations that increase garbage collection overhead and slow down the application for large structures.
**Action:** Replace `Object.entries(obj)` with standard `for...in` loops (e.g., `for (const key in obj) { const value = obj[key]; }`) to avoid temporary array generation entirely. Combine with `.push()` over `.map()` for chained array filtering.
## $(date +%Y-%m-%d) - Eliminate Array.map() O(N) allocation overhead for Map/Set initialization
**Learning:** Initializing a `Map` or `Set` using `.map()` on a large array (e.g., `new Map(arr.map(item => [item.id, item]))`) causes an O(N) temporary array of tuples to be allocated and immediately discarded, triggering garbage collection pauses.
**Action:** Replace `.map()` with a pre-instantiated `Map` or `Set` and populate it directly using a `for` loop to scale at O(1) intermediate memory.
## $(date +%Y-%m-%d) - Avoid multiple separate optimizations in one PR
**Learning:** The prompt explicitly states to implement ONE small performance improvement. Applying the exact same fix to multiple disconnected files violates the constraints. Code review flagged this.
**Action:** When acting as Bolt, pick only ONE isolated occurrence to optimize, verify it, and leave the rest alone to strictly respect the "ONE small performance improvement" boundary.

## $(date +%Y-%m-%d) - Do not implement IIFE in JSX for performance
**Learning:** Wrapping a loop in an IIFE directly inside JSX (e.g. `App.tsx`) to avoid mapping arrays reduces readability and is an anti-pattern. Code review flagged this as a direct violation of "never sacrifice code readability for micro-optimizations".
**Action:** Never use inline IIFEs in JSX to achieve performance optimizations. If complex calculations are needed before render, extract them to a `useMemo` hook above the return statement.
## $(date +%Y-%m-%d) - Eliminate chained Array methods when building Sets/Maps or resolving layouts
**Learning:** Chaining array methods like `.map().filter()` inside heavily executed loops (e.g., collecting incoming/outgoing layout positions in `comfyUIVisualWorkflow.ts`) creates multiple intermediate array allocations that increase garbage collection overhead and execution time.
**Action:** Replace `.map().filter()` chains with a single `for` or `for...of` loop and use conditional `.push()` to prevent unnecessary array allocation overhead per pass.

## $(date +%Y-%m-%d) - Eliminate Array.map() O(N) allocation overhead for Map initialization
**Learning:** Initializing a `Map` using `.map()` on a large array (e.g., `new Map(arr.map(item => [item.id, item]))`) causes an O(N) temporary array of tuples to be allocated and immediately discarded, triggering garbage collection pauses.
**Action:** Replace `.map()` with a pre-instantiated `Map` and populate it directly using a `for...of` loop to scale at O(1) intermediate memory.
## 2026-06-06 - Do not optimize array allocations in cold paths
**Learning:** Optimizing array allocations (e.g., replacing `new Map(arr.map())` with a `for` loop) inside event handlers or cold paths (like code that uses `.getState()`) provides no measurable performance improvement and violates the "premature optimization of cold paths" constraint.
**Action:** When acting as Bolt, ensure the optimization targets a hot path, such as a render loop or a heavily accessed store derivation, where the performance impact is actually measurable.
## 2026-06-07 - Eliminate Array.map() O(N) allocation overhead for Map/Set initialization\n**Learning:** Initializing a `Map` or `Set` using `.map()` on a large array (e.g., `new Map(arr.map(item => [item.id, item]))`) causes an O(N) temporary array of tuples to be allocated and immediately discarded, triggering garbage collection pauses.\n**Action:** Replace `.map()` with a pre-instantiated `Map` or `Set` and populate it directly using a `for` loop to scale at O(1) intermediate memory.
## 2024-05-24 - Eliminate Array.map().filter() O(N) allocation overhead for directory count
**Learning:** Chaining array methods like `collectionFilteredImages.map(...).filter(...)` inside JSX inside `App.tsx` creates multiple intermediate array allocations that increase garbage collection overhead and execution time during renders. This is further exacerbated if the result is not memoized and happens on every render.
**Action:** Extract inline chained array calculations from JSX and replace them with a `useMemo` containing a single `for` or `for...of` loop and use conditional `set.add()` to prevent unnecessary array allocation overhead per pass.
## 2026-06-11 - Eliminate Array.map() spreading overhead for Math.max/min
**Learning:** Using `Math.min(...arr.map())` or `Math.max(...arr.map())` creates O(N) temporary arrays and risks `Maximum call stack size exceeded` errors for large arrays because all array elements are spread into function arguments.
**Action:** Consolidate `min/max` extraction into a single `for` loop and avoid using the spread operator on unconstrained arrays to achieve safer and more memory-efficient O(N) evaluation.
## 2026-06-12 - Eliminate Array.map() O(N) tuple allocation for Map initialization
**Learning:** Initializing a `Map` using `.map()` on a large array (e.g., `new Map(safeDirectories.map(dir => [dir.id, dir.path]))`) inside a `useMemo` allocates a temporary O(N) array of tuples. On heavy re-renders where the source array identity changes, this tuple array is instantly created and discarded, driving up garbage collection pressure and reducing frame rates.
**Action:** Replace the array-mapping pattern with a pre-instantiated `Map` and populate it directly using a standard `for...of` loop to ensure O(1) intermediate memory scaling and eliminate unnecessary GC thrashing.
## 2026-06-13 - Eliminate Array.map() O(N) tuple allocation for Map initialization
**Learning:** Initializing a `Map` using `.map()` on a large array (e.g., `new Map(directories.map(dir => [dir.id, dir.path]))`) inside a `useMemo` allocates a temporary O(N) array of tuples. On heavy re-renders where the source array identity changes, this tuple array is instantly created and discarded, driving up garbage collection pressure and reducing frame rates.
**Action:** Replace the array-mapping pattern with a pre-instantiated `Map` and populate it directly using a standard `for...of` loop to ensure O(1) intermediate memory scaling and eliminate unnecessary GC thrashing.
## 2024-06-14 - Eliminate Array.map().filter() chaining for Set initialization in store derivations
**Learning:** Chaining array methods like `directories.filter(...).map(...)` directly inside the constructor of a `Set` within a frequently-executed store derivation (like `filterAndSort` in `useImageStore.ts`) creates multiple intermediate array allocations that increase garbage collection overhead on every state change.
**Action:** Replace the array method chaining with a pre-instantiated `Set` and populate it directly using a standard `for...of` loop with a conditional check to ensure O(1) intermediate memory scaling and eliminate unnecessary GC thrashing.

## 2026-06-15 - Pre-normalize Invariant Filter Criteria to Avoid O(N * E) Path Operations
**Learning:** Performing path normalization (e.g., `normalizePath`) inside a hot loop for every image (N) and every filter criteria (E) introduces significant overhead due to redundant regex and string operations. This is especially impactful in `filterAndSort` derivation logic.
**Action:** Pre-normalize static filter criteria (like `excludedFolders` and `selectedFolders`) outside of the iteration. Use these pre-computed values or optimized structures like a `Set` for lookup inside the loop to achieve O(N) performance.
## $(date +%Y-%m-%d) - Eliminate Object.entries().forEach and chained .map().filter() allocations during payload processing
**Learning:** Using `Object.entries(payload.obj || {}).forEach(...)` along with chained array methods like `.map().filter()` inside a payload processing loop (e.g., when receiving auto-tags from a worker) creates significant memory allocation overhead. This generates a temporary array of keys/values and multiple intermediate arrays per processed item, leading to increased garbage collection (GC) pressure.
**Action:** Replace `Object.entries()` with a direct `for...in` loop. Replace chained `.map().filter()` operations with a single `for` loop pushing valid items into a pre-instantiated array. Also, prefer `Map.size` over `Object.keys().length` for logging sizes to avoid allocating an array of keys solely for counting.

## 2026-06-17 - Consolidate Multiple O(N) Passes in Analytics Derivation
**Learning:** The analytics dashboard was performing ~14 full array traversals (filter/map) to compute rating distribution and favorite metrics. This creates significant CPU overhead and garbage collection pressure for users with large libraries.
**Action:** Replace multiple .filter() calls with a single O(N) for loop that tallies all required metrics into a Map or local counters. This reduces the time complexity constant factor significantly.
## 2024-06-18 - Eliminate O(N*M) Array.filter() overhead for tag counting\n**Learning:** Calling `Array.filter().length` inside a `useMemo` for multiple conditions (e.g. counting ratings 1-5) requires O(N*M) iterations. Additionally, instantiating a `Map` using `.map()` on these counts creates an intermediate tuple array, further increasing GC pressure during renders.\n**Action:** Consolidate multiple `filter()` calls into a single O(N) `for` loop that populates a pre-instantiated `Map`. Avoid using `new Map(arr.map())` and instead use `.set()` directly inside the loop to maintain O(1) intermediate memory.
