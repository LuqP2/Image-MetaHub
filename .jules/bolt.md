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
